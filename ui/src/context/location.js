import { call, isSuperApp } from "../bridge/windvane.js";

/*
  Where a measurement was taken.

  A field-survey record is worth far less without a position: the whole report
  is grouped by province, and the province is meant to be derived from the
  coordinates rather than typed in (see CHANGE-012). This module gets the
  coordinates; turning them into a province/district is reverse geocoding that
  is not built yet, so LOCATION_AAL1/AAL2 stay null for now.

  Two sources, in order of trust:

  - CustomServiceJs.getUserLocation, the super-app bridge. This is what runs in
    production. Confirmed against a real Unitel mini-app: it returns latitude and
    longitude and NOTHING else - no accuracy, no address. Its response shape is
    also not consistent across platforms (one wraps the coordinates in a
    {ret,status,data} envelope with data as a JSON *string*, another returns the
    bare object), which is why the parser below is defensive rather than trusting
    one shape.
  - navigator.geolocation, the plain-web fallback. It DOES report accuracy, so a
    reading from here carries one while a bridge reading does not. In a WebView
    it is often blocked outright, which is fine: a blocked call resolves to null
    and the run is stored without a position rather than failing.

  Like the WindVane bridge, everything here degrades to "no location" instead of
  throwing. A run with no fix is a run with a null position, never an error.
*/

/* Laos sits near 14-22N, 100-108E; these are the whole-globe bounds, kept wide
   on purpose so a legitimate reading is never discarded for being unexpected. */
function inRange(lat, lng) {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Pull coordinates out of a getUserLocation result, whatever shape it arrived
 * in. Pure and defensive so it can be reasoned about and tested without a
 * super-app in the loop.
 *
 * Accepts: the bare {latitude, longitude} object, the {ret, status, data}
 * envelope where data is that object, and the same envelope where data is a
 * JSON string that still needs parsing. Reads by field name, never by position,
 * because the two platforms order the keys differently.
 *
 * @returns {null|{lat: number, lng: number}} null when there is no usable fix
 */
export function parseUserLocation(result) {
  if (!result || typeof result !== "object") return null;

  /* Unwrap the envelope some platforms use; data may be an object or a string. */
  let payload = result.data !== undefined ? result.data : result;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;

  const lat = Number(payload.latitude);
  const lng = Number(payload.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inRange(lat, lng)) return null;
  /* (0, 0) is the null-island no-fix sentinel a failed locate returns, not a
     place anyone in Laos is standing. Treat it as no fix. */
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}

function geolocate(timeoutMs) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve(null);
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    /* getCurrentPosition has its own timeout, but a native implementation that
       never calls back at all would leave this pending; the outer timer is the
       backstop for that, matching the bridge call() in windvane.js. */
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          const coords = pos && pos.coords;
          const lat = Number(coords && coords.latitude);
          const lng = Number(coords && coords.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inRange(lat, lng)) {
            return finish(null);
          }
          if (lat === 0 && lng === 0) return finish(null);
          const accuracy = Number(coords.accuracy);
          finish({ lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null });
        },
        () => {
          clearTimeout(timer);
          finish(null);
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
      );
    } catch (e) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * The device's current position, or null if none can be had.
 *
 * Resolves - never rejects. Accuracy is a number only when it came from
 * navigator.geolocation; the bridge does not report one, so a bridge fix
 * carries accuracy: null rather than a fabricated zero.
 *
 * @param {number} [timeoutMs] give up after this long
 * @returns {Promise<null|{lat: number, lng: number, accuracy: number|null}>}
 */
export async function fetchLocation(timeoutMs) {
  const t = timeoutMs || 8000;
  if (isSuperApp()) {
    const result = await call("CustomServiceJs", "getUserLocation", {}, t);
    const parsed = parseUserLocation(result);
    if (parsed) return { lat: parsed.lat, lng: parsed.lng, accuracy: null };
    /* The bridge did not answer usably. Fall through and try the web API, which
       inside the super-app WebView is usually blocked and resolves null - no
       worse than the null we already have. */
  }
  return geolocate(t);
}
