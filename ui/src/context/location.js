import { call, isSuperApp } from "../bridge/windvane.js";
import { locateArea } from "./geo.js";

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

  console.log("[location] raw result:", JSON.stringify(result));

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

  const lat = Number(
    payload.latitude !== undefined
      ? payload.latitude
      : payload.lat !== undefined
      ? payload.lat
      : payload.coords && payload.coords.latitude
  );
  const lng = Number(
    payload.longitude !== undefined
      ? payload.longitude
      : payload.lng !== undefined
      ? payload.lng
      : payload.long !== undefined
      ? payload.long
      : payload.coords && payload.coords.longitude
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inRange(lat, lng)) return null;
  /* (0, 0) is the null-island no-fix sentinel a failed locate returns, not a
     place anyone in Laos is standing. Treat it as no fix. */
  if (lat === 0 && lng === 0) return null;

  const accuracy = Number(payload.accuracy || (payload.coords && payload.coords.accuracy));
  const addressObj = payload.address && typeof payload.address === "object" ? payload.address : null;
  const addressStr = typeof payload.address === "string" ? payload.address : null;
  const city = payload.city || (addressObj && addressObj.city) || payload.province || (addressObj && addressObj.province) || null;
  const district = payload.district || (addressObj && addressObj.district) || null;
  const country = payload.country || (addressObj && addressObj.country) || null;
  const fullAddress = addressStr || (addressObj && (addressObj.address || addressObj.street)) || null;

  const res = { lat, lng };
  if (Number.isFinite(accuracy)) res.accuracy = accuracy;
  if (city) res.city = city;
  if (district) res.district = district;
  if (country) res.country = country;
  if (fullAddress) res.fullAddress = fullAddress;
  return res;
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
 * Reverse geocodes coordinates (lat, lng) to province, district, locality, and full address.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{aal1: string|null, aal2: string|null, locality: string|null, fullAddress: string|null, country: string|null}|null>}
 */
export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;

  // 1. Try OpenStreetMap Nominatim for rich address structure (street, village, district, province)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en`,
      {
        signal: ctrl.signal,
        headers: { "User-Agent": "UnitelSpeedtest/6.2.1" }
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const d = await res.json();
      const addr = d.address || {};
      const aal1 = addr.state || addr.province || addr.city || null;
      const aal2 = addr.county || addr.district || null;
      const locality = addr.village || addr.suburb || addr.neighbourhood || addr.town || addr.city_district || null;
      const country = addr.country || "Laos";
      const fullAddress = d.display_name || [locality, aal2, aal1, country].filter(Boolean).join(", ");
      return { aal1, aal2, locality, fullAddress, country };
    }
  } catch (e) {
    // ignore
  }

  // 2. Try BigDataCloud (fast, CORS-friendly client-side fallback)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const d = await res.json();
      const admin = (d.localityInfo && d.localityInfo.administrative) || [];
      const admin4 = admin.find((a) => a.adminLevel === 4);
      const admin6 = admin.find((a) => a.adminLevel === 6);
      const aal1 = (admin4 && admin4.name) || d.principalSubdivision || d.city || null;
      const aal2 = (admin6 && admin6.name) || (d.city !== aal1 ? d.city : null) || null;
      const locality = d.locality || (admin[admin.length - 1] && admin[admin.length - 1].name) || null;
      const country = d.countryName === "Lao People's Democratic Republic" ? "Laos" : (d.countryName || "Laos");
      const parts = [locality, aal2, aal1, country].filter((v, idx, arr) => v && arr.indexOf(v) === idx);
      const fullAddress = parts.join(", ");
      return { aal1, aal2, locality, fullAddress, country };
    }
  } catch (e) {
    // ignore
  }

  return null;
}

/*
  Attach the administrative area and full address to a fix.
*/
export async function withArea(fix) {
  if (!fix) return null;
  const area = locateArea(fix.lat, fix.lng);

  let geo = null;
  if (!fix.fullAddress || !fix.locality || !fix.aal1) {
    try {
      geo = await reverseGeocode(fix.lat, fix.lng);
    } catch (e) {}
  }

  const aal1 = (area && area.aal1) || (geo && geo.aal1) || fix.city || null;
  const aal2 = (area && area.aal2) || (geo && geo.aal2) || fix.district || null;
  const locality = (geo && geo.locality) || fix.locality || fix.city || null;
  const country = (area && area.country) || (geo && geo.country) || fix.country || "Laos";
  const fullAddress =
    (geo && geo.fullAddress) ||
    fix.fullAddress ||
    [locality, aal2, aal1, country].filter(Boolean).join(", ") ||
    null;

  return {
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy === undefined ? null : fix.accuracy,
    aal1,
    aal2,
    locality,
    fullAddress,
    country
  };
}

/**
 * The device's current position, or null if none can be had.
 *
 * Resolves - never rejects. Accuracy is a number only when it came from
 * navigator.geolocation; the bridge does not report one, so a bridge fix
 * carries accuracy: null rather than a fabricated zero.
 *
 * @param {number} [timeoutMs] give up after this long
 * @returns {Promise<null|{lat: number, lng: number, accuracy: number|null,
 *          aal1: string|null, aal2: string|null, locality: string|null, country: string|null, fullAddress: string|null}>}
 */
export async function fetchLocation(timeoutMs) {
  const t = timeoutMs || 10000;
  if (isSuperApp()) {
    // 1. Primary Ali SuperApp / WindVane location API (WVLocation.getLocation)
    const wvResult = await call(
      "WVLocation",
      "getLocation",
      { enableHighAccuracy: true, address: true },
      t
    );
    const parsedWv = parseUserLocation(wvResult);
    if (parsedWv) {
      console.log("[location] resolved via WVLocation.getLocation:", parsedWv);
      return await withArea(parsedWv);
    }

    // 2. Fallback for custom Unitel SuperApp bridges
    const csResult = await call("CustomServiceJs", "getUserLocation", {}, Math.min(t, 4000));
    const parsedCs = parseUserLocation(csResult);
    if (parsedCs) {
      console.log("[location] resolved via CustomServiceJs.getUserLocation:", parsedCs);
      return await withArea(parsedCs);
    }

    // 3. Alipay / mPaaS mini program API: my.getLocation
    const win = typeof window !== "undefined" ? window : globalThis;
    if (win && win.my && typeof win.my.getLocation === "function") {
      try {
        const myResult = await new Promise((resolve) => {
          win.my.getLocation({
            type: 2,
            success: (res) => resolve(parseUserLocation(res)),
            fail: () => resolve(null)
          });
        });
        if (myResult) {
          console.log("[location] resolved via my.getLocation:", myResult);
          return await withArea(myResult);
        }
      } catch (e) {}
    }
  }

  const webLoc = await geolocate(t);
  if (webLoc) {
    console.log("[location] resolved via navigator.geolocation:", webLoc);
  }
  return await withArea(webLoc);
}
