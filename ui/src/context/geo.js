/*
  Coordinates -> province and district, offline.

  The report every measurement feeds into is grouped by province, and the
  partner's export carries LOCATION_AAL1 (province) and LOCATION_AAL2 (district)
  as real columns. A fix from context/location.js is only a pair of numbers, so
  something has to turn it into an administrative area. This is that something.

  ── WHY NOT AN ONLINE GEOCODER ──────────────────────────────────────────────

  Nominatim, Google, Mapbox: all of them answer this better than a table ever
  will, and all of them are the wrong dependency here.

  - This app measures mobile networks in the field. The measurements that matter
    most are the ones taken where coverage is bad - which is exactly where an
    extra HTTP round trip fails. The province would go missing from precisely
    the rows the survey exists to produce.
  - Storage is offline-first on purpose (sync/outbox.js): a run is written down
    before anything is sent. A province that only exists after a successful
    network call breaks that.
  - It would send the GPS position of Unitel staff to a third party on every
    run, which is a decision for the operator to make, not for this file.

  So: a lookup that runs on the device, with no network and no third party.

  ── WHY THE TABLE SHIPS EMPTY ───────────────────────────────────────────────

  The engine below is exact. The data it needs - the boundary polygons of the
  Lao provinces and districts - is NOT in this repository, and writing plausible
  coordinates from memory would be the worst possible bug: every row would carry
  a province, they would look entirely ordinary, and some fraction of them would
  be filed under the wrong one in the breakdown the whole report is grouped by.
  A wrong province is undetectable downstream; a missing one is obvious.

  So area_table_url is empty by default, exactly like video_url: unset, the
  lookup returns null and LOCATION_AAL1/AAL2 stay null - the same honest gap as
  before this file existed. Point it at an authoritative boundary file and every
  run resolves. Sourcing that file (and clearing its licence for commercial use)
  is a decision for the operator - GADM forbids commercial use, OSM-derived data
  carries ODbL obligations, and Unitel's own GIS team may simply have the
  official set.

  ── TABLE FORMAT ────────────────────────────────────────────────────────────

  {
    "version": "2026-08",              // free text, echoed in warnings
    "source":  "...",                  // provenance: where these polygons came from
    "licence": "...",                  // so nobody has to guess later
    "country": "Laos",                 // used for LOCATION_COUNTRY on a match
    "areas": [
      {
        "aal1": "Vientiane Capital",   // province, required
        "aal2": "Chanthabuly",         // district, optional
        "rings": [ [ [lng, lat], [lng, lat], ... ] ]
      }
    ]
  }

  Coordinates are [longitude, latitude], GeoJSON order, so a GeoJSON export can
  be reshaped into this without renumbering anything. "rings" is a list of outer
  rings, which is how a province made of several disconnected pieces is
  expressed. Holes are not modelled.
*/

/*
  The loaded table, or null. Module state rather than a ref: nothing renders it,
  and every reader wants the value at the moment it asks, not a subscription.
*/
let table = null;

function isRing(ring) {
  /* Three points is the fewest that can enclose anything. */
  if (!Array.isArray(ring) || ring.length < 3) return false;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) return false;
    if (!Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) {
      return false;
    }
  }
  return true;
}

/*
  The bounding box is DERIVED, never read from the file, even when the file
  offers one. A bbox that disagrees with its own polygon is silent and total: the
  province is skipped before the polygon test ever runs, and that province simply
  never appears in the report. Computing it costs one pass at load and removes
  the whole failure mode.
*/
function boundsOf(rings) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Accept a table object, keeping only the areas that are actually usable.
 *
 * Malformed areas are dropped rather than failing the whole load: a boundary
 * file with one bad polygon should still resolve the other seventeen provinces,
 * and the count is warned about so the gap is visible rather than silent.
 *
 * @param {object} raw the parsed table file
 * @returns {number} how many areas were accepted
 */
export function setAreaTable(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.areas)) {
    table = null;
    return 0;
  }

  const areas = [];
  let dropped = 0;
  for (const area of raw.areas) {
    const aal1 = area && typeof area.aal1 === "string" ? area.aal1.trim() : "";
    const rings = area && Array.isArray(area.rings) ? area.rings.filter(isRing) : [];
    if (!aal1 || rings.length === 0) {
      dropped++;
      continue;
    }
    const aal2 = typeof area.aal2 === "string" && area.aal2.trim() ? area.aal2.trim() : null;
    areas.push({ aal1, aal2, rings, bounds: boundsOf(rings) });
  }

  if (dropped > 0) {
    console.warn(
      "[geo] " + dropped + " area(s) in the boundary table were unusable and skipped"
    );
  }
  if (areas.length === 0) {
    table = null;
    return 0;
  }

  table = {
    country: typeof raw.country === "string" && raw.country.trim() ? raw.country.trim() : null,
    version: typeof raw.version === "string" ? raw.version : "",
    areas
  };
  return areas.length;
}

/** True once a usable boundary table is loaded. */
export function hasAreaTable() {
  return table !== null;
}

/**
 * Fetch and install the boundary table.
 *
 * Resolves to how many areas were loaded - 0 for "no table configured" and for
 * every failure alike, because to everything upstream those are the same thing:
 * coordinates will not resolve to a province, and a run is stored without one
 * rather than not stored at all.
 *
 * @param {string} url from settings.json; "" means no table
 * @returns {Promise<number>}
 */
export async function loadAreaTable(url) {
  if (!url) return 0;
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const count = setAreaTable(await response.json());
    if (count === 0) console.warn("[geo] boundary table at " + url + " had no usable areas");
    return count;
  } catch (e) {
    console.warn("[geo] boundary table not loaded, province stays null", e);
    return 0;
  }
}

/*
  Ray casting: count how often a ray from the point crosses the ring's edges. An
  odd number means inside. Standard, exact in the arithmetic sense, and needs no
  projection - at province scale the difference between treating lat/lng as a
  plane and doing it on the sphere is far below the width of any boundary.

  A point exactly ON an edge or vertex is genuinely ambiguous; this returns a
  deterministic answer for it, but which side that is is not something to rely
  on. It does not matter here: two adjacent districts both being defensible for
  a point standing precisely on the line between them is not an error worth
  engineering away.
*/
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const straddles = yi > lat !== yj > lat;
    if (straddles && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function contains(area, lng, lat) {
  const b = area.bounds;
  /* Cheap rejection first: most of the table is nowhere near the point. */
  if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) return false;
  for (const ring of area.rings) {
    if (pointInRing(lng, lat, ring)) return true;
  }
  return false;
}

/**
 * Which administrative area is this position in?
 *
 * A table may hold provinces, districts, or both. Every match contributes:
 * the province comes from whichever match names one, and the district from the
 * most specific match - so a province-only table still resolves AAL1, and a
 * district-level table resolves both without needing a second lookup.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {null|{aal1: string, aal2: string|null, country: string|null}}
 */
export function locateArea(lat, lng) {
  if (!table) return null;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;

  const y = Number(lat);
  const x = Number(lng);

  let aal1 = null;
  let aal2 = null;
  for (const area of table.areas) {
    if (!contains(area, x, y)) continue;
    if (!aal1) aal1 = area.aal1;
    if (!aal2 && area.aal2) {
      aal2 = area.aal2;
      /* A district entry names its province too; prefer that one, since a
         point inside a district is inside its province by construction. */
      aal1 = area.aal1;
    }
  }

  if (!aal1) return null;
  return { aal1, aal2, country: table.country };
}
