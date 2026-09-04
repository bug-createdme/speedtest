import { call, isSuperApp } from "../bridge/windvane.js";
import { locateArea } from "./geo.js";

/*
  Where a measurement was taken.

  A field-survey record is worth far less without a position: the whole report
  is grouped by province, and the province is meant to be derived from the
  coordinates rather than typed in (see CHANGE-012).

  This module obtains real-time coordinates directly from the device's GPS /
  sensors for every test.

  Sources in order of priority:
  1. WVLocation.getLocation (WindVane native location plugin, verified on Android EMAS)
  2. CustomServiceJs.getUserLocation (Unitel SuperApp custom bridge)
  3. MiniappSDK.getCurrentLocation (LaoApp native SDK)
  4. my.getLocation (Alipay / mPaaS mini app container)
  5. HTML5 Geolocation API (navigator.geolocation with highAccuracy and cellular fallback)
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
  let payload = result;
  if (result.data !== undefined) payload = result.data;
  else if (result.value !== undefined) payload = result.value;
  else if (result.location !== undefined) payload = result.location;
  else if (result.userLocation !== undefined) payload = result.userLocation;
  else if (result.coords !== undefined) payload = result.coords;
  else if (result.result !== undefined) payload = result.result;

  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return null;
    }
  }
  if (Array.isArray(payload) && payload.length > 0) {
    payload = payload[0];
  }
  if (!payload || typeof payload !== "object") return null;

  const lat = Number(
    payload.latitude !== undefined
      ? payload.latitude
      : payload.lat !== undefined
      ? payload.lat
      : (payload.coords && (payload.coords.latitude !== undefined ? payload.coords.latitude : payload.coords.lat)) !== undefined
      ? (payload.coords.latitude !== undefined ? payload.coords.latitude : payload.coords.lat)
      : (payload.location && (payload.location.latitude !== undefined ? payload.location.latitude : payload.location.lat))
  );
  const lng = Number(
    payload.longitude !== undefined
      ? payload.longitude
      : payload.lng !== undefined
      ? payload.lng
      : payload.long !== undefined
      ? payload.long
      : (payload.coords && (payload.coords.longitude !== undefined ? payload.coords.longitude : payload.coords.lng)) !== undefined
      ? (payload.coords.longitude !== undefined ? payload.coords.longitude : payload.coords.lng)
      : (payload.location && (payload.location.longitude !== undefined ? payload.location.longitude : payload.location.lng))
  );

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!inRange(lat, lng)) return null;
  /* (0, 0) is the null-island no-fix sentinel a failed locate returns, not a
     place anyone in Laos is standing. Treat it as no fix. */
  if (lat === 0 && lng === 0) return null;

  const accuracy = Number(
    payload.accuracy ||
    (payload.coords && payload.coords.accuracy) ||
    (payload.location && payload.location.accuracy)
  );
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

/**
 * Detect OS platform
 */
export function getPlatform() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform && /iPhone|iPad|iPod/i.test(navigator.platform))) {
    return "ios";
  }
  if (/Android/i.test(ua)) {
    return "android";
  }
  return "web";
}

/**
 * Pre-authorizes location access via WindVane / native containers
 */
export async function requestLocationPermission() {
  if (!isSuperApp()) return;
  try {
    // 1. WindVane wv.authorize (standard EMAS scope: location)
    await call("wv", "authorize", { scope: "location" }, 2000);
  } catch (e) {}
  try {
    // 2. CustomServiceJs requestPermission if supported
    await call("CustomServiceJs", "requestPermission", { permission: "location" }, 1500);
  } catch (e) {}
  try {
    // 3. Alipay / mPaaS my.authorize
    const win = typeof window !== "undefined" ? window : globalThis;
    if (win && win.my && typeof win.my.authorize === "function") {
      win.my.authorize({ scope: "scope.userLocation" });
    }
  } catch (e) {}
}

/**
 * Real-time geolocation via HTML5 Geolocation API with high-accuracy GPS and cellular fallback.
 */
function geolocate(timeoutMs) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve(null);
    }
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(value);
    };

    /*
      The two attempts SPLIT the budget; they do not share it.

      Giving the high-accuracy attempt a timeout equal to the whole budget made
      it expire at the same instant the backstop below fired, so finish(null)
      won the race every time and the coarse attempt that follows was started
      only to have its answer thrown away - the cellular fallback was dead code
      dressed as a fallback. Indoors and inside a WebView the coarse fix is
      usually the ONLY one that ever arrives, so it gets a slice of its own.

      Both slices have a floor, which is why this can outrun a very small
      budget: below ~4.5s in total there is no point attempting at all.
    */
    const fineMs = Math.max(2000, Math.round(timeoutMs * 0.6));
    const coarseMs = Math.max(2000, timeoutMs - fineMs);
    /* The backstop for a native implementation that never calls back at all,
       which neither getCurrentPosition timeout would catch. */
    timer = setTimeout(() => finish(null), fineMs + coarseMs + 500);

    function tryGet(highAccuracy) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = pos && pos.coords;
            const lat = Number(coords && coords.latitude);
            const lng = Number(coords && coords.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inRange(lat, lng)) {
              return finish(null);
            }
            if (lat === 0 && lng === 0) return finish(null);
            const accuracy = Number(coords.accuracy);
            console.log("[location] HTML5 geolocate success (highAccuracy=" + highAccuracy + "):", lat, lng, "accuracy:", accuracy);
            finish({ lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null });
          },
          (err) => {
            console.warn("[location] geolocate attempt error (highAccuracy=" + highAccuracy + "):", err && err.message);
            if (highAccuracy) {
              tryGet(false);
            } else {
              finish(null);
            }
          },
          {
            enableHighAccuracy: highAccuracy,
            timeout: highAccuracy ? fineMs : coarseMs,
            maximumAge: 30000
          }
        );
      } catch (e) {
        if (highAccuracy) {
          tryGet(false);
        } else {
          finish(null);
        }
      }
    }

    tryGet(true);
  });
}

/*
  A district is not a locality.

  BigDataCloud answers Laos with a flat list of administrative units and no
  reliable depth, so taking the LAST entry as the locality picked whatever
  happened to be last - which for a point in Xaysetha came back as "Muang
  Sisattanak", the district next door. The stored row then read

    LOCALITY = Muang Sisattanak, AAL2 = Muang Xaisettha

  two sibling districts stacked as if one contained the other. The survey is
  grouped by district, so that is worse than an empty field: it is wrong and it
  looks right.

  Lao administrative names carry their own level - "Muang X" is a district -
  so a "locality" shaped like a district while the district is ALSO shaped like
  one, and different, is a neighbour rather than a village inside it. Dropped
  rather than guessed which of the two is correct.
*/
const DISTRICT_SHAPED = /^(muang|mueang|muong)\s+/i;

function sameName(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function sanitizeLocality(locality, aal2, aal1) {
  if (!locality) return null;
  if (sameName(locality, aal2) || sameName(locality, aal1)) return null;
  if (DISTRICT_SHAPED.test(locality) && aal2 && DISTRICT_SHAPED.test(aal2)) return null;
  return locality;
}

/**
 * Reverse geocodes coordinates (lat, lng) to province, district, locality, and full address.
 *
 * Nominatim first, BigDataCloud second. The order is not arbitrary and not a
 * preference: from this handset Nominatim returns street-level results that
 * name the right district ("Nongbone Path, Naxay, Xaysetha District"), while
 * BigDataCloud returns a coarse hierarchy that has been observed naming the
 * wrong one. Speed is worth less here than being right - the coordinates are
 * already stored either way, and it is the district that the report groups by.
 */
export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;

  // 1. OpenStreetMap Nominatim - richest and, on this data, the accurate one
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
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
      const locality = sanitizeLocality(
        addr.village || addr.suburb || addr.neighbourhood || addr.town || addr.city_district || null,
        aal2,
        aal1
      );
      const country = addr.country || "Laos";
      const fullAddress = d.display_name || [locality, aal2, aal1, country].filter(Boolean).join(", ");
      if (aal1 || aal2 || locality) {
        return { aal1, aal2, locality, fullAddress, country };
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. BigDataCloud - fallback when Nominatim is slow, rate-limited or blocked
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
      const admin4 = admin.find((a) => Number(a.adminLevel) === 4);
      const admin6 = admin.find((a) => Number(a.adminLevel) === 6);
      const aal1 = (admin4 && admin4.name) || d.principalSubdivision || d.city || null;
      const aal2 = (admin6 && admin6.name) || (d.city !== aal1 ? d.city : null) || null;
      /* Only a unit DEEPER than the district can be a locality - the shallowest
         such entry, not simply the last one in the list. */
      const deeper = admin
        .filter((a) => Number(a.adminLevel) > 6)
        .sort((a, b) => Number(a.adminLevel) - Number(b.adminLevel))[0];
      const locality = sanitizeLocality(d.locality || (deeper && deeper.name) || null, aal2, aal1);
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
  Attach the administrative area and full address to a real-time fix.
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
  /*
    Checked again here, not just inside reverseGeocode: the province and
    district may come from the local area table while the locality comes from
    the geocoder, and two sources that never saw each other's answer are
    exactly how a district ends up nested inside a different district.
  */
  const locality = sanitizeLocality((geo && geo.locality) || fix.locality || fix.city || null, aal2, aal1);
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

/*
  The most recent fix this page obtained, and when.

  resetRun() clears test.location on purpose: a surveyor moves between
  measurements, and carrying the previous spot into a run whose own locate
  failed is exactly the plausible-but-wrong data this app avoids. That
  reasoning does not reach a fix taken on the start screen seconds before Start
  was pressed, which was being thrown away with it. Kept here WITH its age so
  the tracker can seed from it and a genuinely old one is never reused.
*/
let lastFix = null;
let lastFixAt = 0;

/** The last fix, if it is younger than maxAgeMs (default 2 minutes). */
export function recentFix(maxAgeMs) {
  if (!lastFix) return null;
  if (Date.now() - lastFixAt >= (maxAgeMs === undefined ? 120000 : maxAgeMs)) return null;
  return lastFix;
}

function noteFix(fix) {
  if (fix) {
    lastFix = fix;
    lastFixAt = Date.now();
  }
  return fix;
}

/**
 * Obtain raw position without waiting for reverse-geocoding.
 * Platform-aware priority to ensure zero wasted seconds.
 */
export async function fetchLocationRaw(timeoutMs) {
  const t = timeoutMs || 10000;
  const platform = getPlatform();

  /*
    Each source gets a SHARE of the budget, never a fixed cap.

    Capping every source at 2-2.5s regardless of what the caller asked for is
    what stopped LOCATION_LAT/LNG being recorded at all: a cold native locate
    is routinely 3-8s on iOS, so every attempt was abandoned just before the OS
    answered - and no amount of retrying fixes that, because each retry starts
    the same slow call over from zero. The floors keep a short refresh poll
    from degenerating into no attempt at all.
  */
  const primaryMs = Math.max(3000, Math.round(t * 0.45));
  const secondaryMs = Math.max(2500, Math.round(t * 0.3));
  const webMs = Math.max(4500, Math.round(t * 0.5));

  if (isSuperApp()) {
    if (platform === "ios") {
      // 1. iOS Primary: CustomServiceJs.getUserLocation
      const csResult = await call(
        "CustomServiceJs",
        "getUserLocation",
        { enableHighAccuracy: true },
        primaryMs
      );
      const parsedCs = parseUserLocation(csResult);
      if (parsedCs) {
        console.log("[location] iOS resolved via CustomServiceJs.getUserLocation:", parsedCs);
        return noteFix(parsedCs);
      }

      // 2. iOS Secondary: WVLocation.getLocation (without address to avoid hangs)
      const wvResult = await call(
        "WVLocation",
        "getLocation",
        { enableHighAccuracy: true, address: false },
        secondaryMs
      );
      const parsedWv = parseUserLocation(wvResult);
      if (parsedWv) {
        console.log("[location] iOS resolved via WVLocation.getLocation:", parsedWv);
        return noteFix(parsedWv);
      }
    } else {
      // Android / generic
      // 1. Android Primary: WVLocation.getLocation
      const wvResult = await call(
        "WVLocation",
        "getLocation",
        { enableHighAccuracy: true, address: true },
        primaryMs
      );
      const parsedWv = parseUserLocation(wvResult);
      if (parsedWv) {
        console.log("[location] Android resolved via WVLocation.getLocation:", parsedWv);
        return noteFix(parsedWv);
      }

      // 2. Android Secondary: CustomServiceJs.getUserLocation
      const csResult = await call(
        "CustomServiceJs",
        "getUserLocation",
        { enableHighAccuracy: true },
        secondaryMs
      );
      const parsedCs = parseUserLocation(csResult);
      if (parsedCs) {
        console.log("[location] Android resolved via CustomServiceJs.getUserLocation:", parsedCs);
        return noteFix(parsedCs);
      }
    }

    // 3. Fallbacks: MiniappSDK & my.getLocation
    const win = typeof window !== "undefined" ? window : globalThis;
    if (win && win.MiniappSDK && typeof win.MiniappSDK.getCurrentLocation === "function") {
      try {
        const sdkResult = await Promise.race([
          win.MiniappSDK.getCurrentLocation(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500))
        ]);
        const parsedSdk = parseUserLocation(sdkResult);
        if (parsedSdk) {
          console.log("[location] resolved via MiniappSDK.getCurrentLocation:", parsedSdk);
          return noteFix(parsedSdk);
        }
      } catch (e) {}
    }

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
          return noteFix(myResult);
        }
      } catch (e) {}
    }
  }

  // 4. HTML5 Geolocation API
  const webLoc = await geolocate(webMs);
  if (webLoc) {
    console.log("[location] resolved via HTML5 geolocate:", webLoc);
    return noteFix(webLoc);
  }

  return null;
}

/**
 * Obtain the device's real-time position with reverse-geocoded address.
 * Resolves to the fresh fix, or null if GPS unavailable.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<null|{lat: number, lng: number, accuracy: number|null,
 *          aal1: string|null, aal2: string|null, locality: string|null, country: string|null, fullAddress: string|null}>}
 */
export async function fetchLocation(timeoutMs) {
  const fix = await fetchLocationRaw(timeoutMs);
  if (fix) {
    return await withArea(fix);
  }
  return null;
}

let activeTracker = null;

/*
  How long each attempt of a run gets.

  The FIRST attempt is the one that matters and it is given a real budget: a
  cold native locate needs seconds, and the whole point of starting at Start is
  that the run lasts long enough to wait for one. Only the refreshes that
  follow are kept short, and they are spaced far enough apart that a slow
  native call is never cut off by the next poll rather than by its own timeout.
*/
const FIRST_ATTEMPT_MS = 20000;
const REFRESH_ATTEMPT_MS = 10000;
const POLL_GAP_MS = 5000;

/**
 * Starts continuous location polling and watching during a test run.
 * Seeds from a recent start-screen fix, then polls the native bridges and
 * registers HTML5 watchPosition. Calls onFix(fix, fromSeed) as fixes arrive.
 *
 * @param {Function} onFix callback with (fix, fromSeed)
 * @returns {{stop: Function}} tracker controller
 */
export function startLocationTracker(onFix) {
  if (activeTracker) {
    activeTracker.stop();
  }

  let running = true;
  let watchId = null;

  // 1. Register HTML5 watchPosition if available
  if (typeof navigator !== "undefined" && navigator.geolocation && typeof navigator.geolocation.watchPosition === "function") {
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!running) return;
          const coords = pos && pos.coords;
          const lat = Number(coords && coords.latitude);
          const lng = Number(coords && coords.longitude);
          if (Number.isFinite(lat) && Number.isFinite(lng) && inRange(lat, lng) && !(lat === 0 && lng === 0)) {
            const accuracy = Number(coords.accuracy);
            console.log("[location tracker] watchPosition fix:", lat, lng, "accuracy:", accuracy);
            onFix(noteFix({ lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null }), false);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    } catch (e) {}
  }

  // 2. Seed from the start-screen fix, so a run is never position-less while
  //    the first real attempt is still in flight.
  const seed = recentFix();
  if (seed) {
    console.log("[location tracker] seeded from recent fix:", seed);
    onFix(seed, true);
  }

  // 3. Active bridge polling loop
  let firstAttempt = true;
  const poll = async () => {
    if (!running) return;
    const budget = firstAttempt ? FIRST_ATTEMPT_MS : REFRESH_ATTEMPT_MS;
    firstAttempt = false;
    try {
      const fix = await fetchLocationRaw(budget);
      if (fix && running) {
        onFix(fix, false);
      }
    } catch (e) {}
    if (running) {
      setTimeout(poll, POLL_GAP_MS);
    }
  };

  requestLocationPermission().finally(() => {
    if (running) poll();
  });

  activeTracker = {
    stop: () => {
      running = false;
      if (watchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch (e) {}
      }
      activeTracker = null;
    }
  };

  return activeTracker;
}

export function stopLocationTracker() {
  if (activeTracker) {
    activeTracker.stop();
    activeTracker = null;
  }
}
