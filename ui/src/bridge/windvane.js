import { ref } from "vue";

/*
  WindVane bridge — the only file in this app that touches window.WindVane.

  Everything here degrades to "not available" rather than throwing. The same
  build runs as a plain web page, where none of this exists, and inside the
  Unitel super-app, where it does. Nothing above this module may branch on
  which one it is in.

  Contract source, and how much to trust it:

  - WVNetwork.getNetworkType is in the official WindVane JSAPI documentation
    (docs/bridge.md). The *shape* of its response is not, so it is parsed
    defensively below.
  - wv.getAuthCode is NOT in the public documentation. It is almost certainly
    an extension the Unitel super-app team added. What is implemented here is
    the response shape observed working in a real Unitel mini-app, supplied by
    the project owner. That is stronger evidence than a guess and weaker than a
    spec: if the super-app team ever changes it, nothing here will warn us, so
    every field access is optional and a failure to read it is not an error.
*/

/* The subscriber number, once the super-app has told us. "" until then, and
   forever on the plain web. */
export const isdn = ref("");
/* Network type as the platform reports it - "WIFI", "4G", "5G". Preferred over
   navigator.connection, which does not exist at all on iOS. */
export const networkType = ref("");

/*
  Whether this build is running inside the super-app.

  Decided from the User-Agent FIRST, and only then from the bridge objects.
  That order is the whole point.

  window.WindVane does not exist when this document finishes parsing. It is
  created by a script fetched from a CDN in China, and that fetch is not
  dependable from a handset here - it has been seen failing outright, with
  nothing in the console but

    GET <script> error: https://g.alicdn.com/.../windvane.js

  and seen succeeding minutes later from the same phone on the same network.

  Deciding on the object alone turns one slow or failed fetch into a permanent
  verdict: the app concludes it is a plain web page, call() returns null before
  touching anything, and the bridge is never used again even after the script
  finally lands. That is what made the logout button appear dead while the
  super-app around it was working fine.

  The User-Agent is present the moment the document parses and owes nothing to
  the network, so it is the signal that can be trusted. The reference mini-app
  that does close correctly in this super-app decides the same way, then waits
  for the object - see whenBridgeReady below.
*/
const SUPER_APP_UA = /WindVane|AlipayClient|AliApp|LaoApp|SuperApp|Unitel|MiniApp/i;

export function isSuperApp() {
  const win = typeof window !== "undefined" ? window : globalThis;
  if (typeof win === "undefined") return false;
  const ua = win.navigator && win.navigator.userAgent;
  if (ua && SUPER_APP_UA.test(ua)) return true;
  /*
    window.WindVane is deliberately NOT in this list. The app now ships the
    JSAPI bootstrap itself (ui/index.html), and that script creates
    window.WindVane on every platform it runs on, plain web included - so its
    presence stopped being evidence of anything the moment it was vendored.
    The globals below are still injected by a host or not at all.
  */
  return (
    typeof win.MiniappSDK !== "undefined" ||
    typeof win.AlipayJSBridge !== "undefined" ||
    typeof win.my !== "undefined"
  );
}

/* How long a call() waits for the bridge to show up, and how often it looks.
   Both match the reference mini-app that works. */
const BRIDGE_WAIT_MS = 4000;
const BRIDGE_POLL_MS = 200;

/*
  Resolve true once window.WindVane exists, false if it has not appeared within
  timeoutMs. Every call() goes through here, so one issued while the SDK script
  is still in flight still reaches the bridge instead of quietly doing nothing.

  Giving up is not an error. The plain web build has no bridge and must never
  wait for one; that is why isSuperApp() is checked before this is.
*/
export function whenBridgeReady(timeoutMs) {
  const win = typeof window !== "undefined" ? window : globalThis;
  const present = () => typeof win !== "undefined" && typeof win.WindVane !== "undefined";
  if (present()) return Promise.resolve(true);
  return new Promise(resolve => {
    let waited = 0;
    const limit = timeoutMs || BRIDGE_WAIT_MS;
    const tick = () => {
      if (present()) return resolve(true);
      waited += BRIDGE_POLL_MS;
      if (waited >= limit) return resolve(false);
      setTimeout(tick, BRIDGE_POLL_MS);
    };
    setTimeout(tick, BRIDGE_POLL_MS);
  });
}

/*
  The SDK is not bundled and not loaded unconditionally.

  The reference project hard-codes the alicdn.com <script> tag into index.html.
  Doing that here would make the plain web deployment fetch a third-party
  script from a CDN on every page load - on a page whose entire job is to
  measure how slow the user's connection is, and in a market where that CDN is
  not necessarily fast or reachable. So the URL is configuration
  (windvane_sdk_url in settings.json), empty by default: the web build makes no
  such request, and the mini-app deployment sets it.
*/
export function loadSdk(url, timeoutMs) {
  return new Promise(resolve => {
    if (typeof window !== "undefined" && typeof window.WindVane !== "undefined") {
      return resolve(true);
    }
    if (!url) return resolve(false);
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      resolve(ok && typeof window !== "undefined" && typeof window.WindVane !== "undefined");
    };
    const timer = setTimeout(() => finish(false), timeoutMs || 4000);
    try {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => {
        clearTimeout(timer);
        finish(true);
      };
      script.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      document.head.appendChild(script);
    } catch (e) {
      clearTimeout(timer);
      finish(false);
    }
  });
}

/*
  Promisified WindVane.call, keeping the failure.

  call() below answers null for everything that went wrong, which is the right
  shape for a caller that only wants the value. It is the wrong shape for one
  that has to tell a user WHY, because the container's own words are the only
  place a refusal is explained - "Please apply for JSAPI authorization" is not
  something any amount of client code can deduce.

  The timeout is here because a native bridge that silently drops a call would
  otherwise leave this pending forever, and anything awaiting it would hang.

  @returns {Promise<{ok: boolean, value?: *, error?: *}>}
*/
export async function callDetailed(namespace, method, params, timeoutMs) {
  if (!isSuperApp()) return { ok: false, error: { reason: "no-bridge" } };
  if (!(await whenBridgeReady())) {
    console.warn(
      "[windvane] " + namespace + "." + method + " skipped: no bridge after " +
        BRIDGE_WAIT_MS + "ms"
    );
    return { ok: false, error: { reason: "no-bridge-timeout" } };
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = outcome => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: { reason: "timeout" } }),
      timeoutMs || 5000
    );
    try {
      window.WindVane.call(
        namespace,
        method,
        params || {},
        result => {
          clearTimeout(timer);
          finish({ ok: true, value: result });
        },
        error => {
          clearTimeout(timer);
          console.warn("[windvane] " + namespace + "." + method + " failed", error);
          finish({ ok: false, error });
        }
      );
    } catch (e) {
      clearTimeout(timer);
      console.warn("[windvane] " + namespace + "." + method + " threw", e);
      finish({ ok: false, error: { reason: "threw", message: String((e && e.message) || e) } });
    }
  });
}

/*
  The same call for everyone who only wants the value: the result, or null on
  any failure - a missing bridge, an unsupported method, a native error, or a
  call that never came back.
*/
export async function call(namespace, method, params, timeoutMs) {
  const outcome = await callDetailed(namespace, method, params, timeoutMs);
  return outcome.ok ? outcome.value : null;
}

/*
  Parse the getAuthCode result.

  Observed shape: authSuccessScopes is an array whose entries are EITHER objects
  or JSON strings that still need parsing - the reference handles both, so both
  are handled here. Each entry is keyed by scope name:

    [ '{"USER_ID":{"isdn":"20XXXXXXXX", ...}}', {"USER_NAME":{"name":"..."}} ]

  Pulled out separately so it can be reasoned about (and later tested) without
  a super-app in the loop.
*/
export function parseAuthCode(result) {
  if (!result || !Array.isArray(result.authSuccessScopes)) return null;
  const scopes = result.authSuccessScopes.map(entry => {
    if (typeof entry !== "string") return entry;
    try {
      return JSON.parse(entry);
    } catch (e) {
      return null;
    }
  });
  const userId = scopes.find(s => s && s.USER_ID);
  const value = userId ? userId.USER_ID : null;
  const number = value && value.isdn ? String(value.isdn) : "";
  return number ? { isdn: number } : null;
}

/*
  Ask the super-app who the subscriber is.

  Only the ISDN is kept. The reference also reads USER_NAME and stores a
  display name; this app has nowhere to show one, and network operations
  correlates a result to a line by number, not by name. Carrying the name would
  be extra personal data in the results database for no operational gain.

  The number is held in memory for the life of the page and deliberately NOT
  written to localStorage. The reference persists it because its bootstrap
  needs it across module boundaries; here a ref covers that, and not persisting
  a subscriber identifier on the device is the safer default.
*/
export async function fetchSubscriber() {
  if (typeof window !== "undefined" && window.WindVane) {
    const result = await call("wv", "getAuthCode", {
      scopes: ["USER_ID", "USER_NAME"]
    });
    const parsed = parseAuthCode(result);
    if (parsed) {
      isdn.value = parsed.isdn;
      return parsed;
    }
  }

  if (
    typeof window !== "undefined" &&
    window.MiniappSDK &&
    typeof window.MiniappSDK.getUserInfo === "function"
  ) {
    try {
      const user = await window.MiniappSDK.getUserInfo();
      const num = user?.phone || user?.isdn || user?.id || "";
      if (num) {
        isdn.value = String(num);
        return { isdn: String(num) };
      }
    } catch (e) {
      console.warn("[MiniappSDK] getUserInfo failed", e);
    }
  }

  return null;
}

/*
  Normalize whatever getNetworkType returns. The documentation confirms the
  method exists but not its response shape, so accept the three plausible ones
  rather than guessing at one.
*/
export function parseNetworkType(result) {
  if (!result) return "";
  const raw =
    typeof result === "string"
      ? result
      : result.type || result.networkType || result.network || "";
  return raw ? String(raw).toUpperCase() : "";
}

export async function fetchNetworkType() {
  const win = typeof window !== "undefined" ? window : globalThis;
  if (!win) return "";

  if (
    win.MiniappSDK &&
    typeof win.MiniappSDK.getNetworkInfo === "function"
  ) {
    try {
      const info = await win.MiniappSDK.getNetworkInfo();
      const parsed = parseNetworkType(info);
      if (parsed) {
        networkType.value = parsed;
        return parsed;
      }
    } catch (e) {
      console.warn("[MiniappSDK] getNetworkInfo failed", e);
    }
  }

  if (typeof win !== "undefined" && win.WindVane) {
    const result = await call("WVNetwork", "getNetworkType");
    const parsed = parseNetworkType(result);
    if (parsed) {
      networkType.value = parsed;
      return parsed;
    }
  }

  if (typeof win !== "undefined" && win.my && typeof win.my.getNetworkType === "function") {
    try {
      const myResult = await new Promise((resolve) => {
        win.my.getNetworkType({
          success: (res) => resolve(parseNetworkType(res)),
          fail: () => resolve("")
        });
      });
      if (myResult) {
        networkType.value = myResult;
        return myResult;
      }
    } catch (e) {}
  }

  if (typeof win !== "undefined" && win.AlipayJSBridge && typeof win.AlipayJSBridge.call === "function") {
    try {
      const bridgeResult = await new Promise((resolve) => {
        win.AlipayJSBridge.call("getNetworkType", {}, (res) => resolve(parseNetworkType(res)));
      });
      if (bridgeResult) {
        networkType.value = bridgeResult;
        return bridgeResult;
      }
    } catch (e) {}
  }

  return "";
}

/**
 * Normalizes language codes for the SuperApp bridge.
 * Maps:
 * - Lao: "la", "lo", "lao", "la-LA", "lo-LA" -> "la"
 * - Vietnamese: "vi", "vie", "vi-VN" -> "vi"
 * - English: "en", "eng", "en-US" -> "en"
 *
 * @param {string} raw
 * @returns {string} Normalized locale ("la" | "vi" | "en") or empty string.
 */
export function normalizeAppLocale(raw) {
  if (!raw || typeof raw !== "string") return "";
  const clean = raw.toLowerCase().trim().replace(/_/g, "-");
  if (clean.startsWith("la") || clean.startsWith("lo")) return "la";
  if (clean.startsWith("vi")) return "vi";
  if (clean.startsWith("en")) return "en";
  return "";
}

/**
 * Parse the result from CustomServiceJs.getAppSetting to extract language.
 *
 * Observed in Unitel SuperApp / WindVane mini-apps (e.g. miniapp-predict-worldcup):
 * - Plain object: { language: "la" } or { lang: "lo" } or { locale: "vi" }
 * - Object with JSON string in data: { data: '{"language":"la",...}' }
 * - Object with parsed object in data: { data: { language: "la" } }
 * - Bare JSON string: '{"language":"la"}'
 * - Or raw code string: "la", "lo", "vi", "en"
 *
 * @param {*} result
 * @returns {string} Normalized locale ("la" | "vi" | "en") or empty string.
 */
export function parseAppLanguage(result) {
  if (!result) return "";
  let data = result;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return normalizeAppLocale(data);
    }
  }
  if (data && typeof data === "object") {
    if (data.data) {
      let inner = data.data;
      if (typeof inner === "string") {
        try {
          inner = JSON.parse(inner);
        } catch (e) {}
      }
      if (inner && typeof inner === "object") {
        data = inner;
      }
    }
    const raw = data.language || data.lang || data.locale || "";
    return normalizeAppLocale(raw);
  }
  return "";
}

/**
 * Fetch the current SuperApp system/app language setting via WindVane.
 *
 * Uses CustomServiceJs.getAppSetting, the JSAPI provided by Unitel SuperApp.
 *
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<string>} Normalized locale code ("la" | "vi" | "en") or empty string.
 */
export async function fetchAppLanguage(timeoutMs) {
  const win = typeof window !== "undefined" ? window : globalThis;
  if (!win) return "";

  if (typeof win !== "undefined" && win.WindVane) {
    const result = await call("CustomServiceJs", "getAppSetting", {}, timeoutMs || 3000);
    const parsed = parseAppLanguage(result);
    if (parsed) return parsed;
  }

  return "";
}


/*
  Did a share actually open the sheet?

  The documented response is {code: 200, message: "...", success: true}, but
  getUserLocation taught us not to trust one shape from this bridge: the same
  super-app wraps some replies in {ret, status, data} with data as a JSON
  string. So every plausible marker of success is accepted, and anything else -
  including a reply that arrived but says nothing - counts as "did not share",
  which is the answer that makes the caller fall back rather than claim it
  worked.

  Pulled out so it can be tested without a super-app in the loop.
*/
export function parseShareResult(result) {
  if (!result) return false;

  let payload = result;
  if (typeof payload === "object" && payload.data !== undefined) {
    payload = payload.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        payload = result;
      }
    }
  }

  const ret = String(result.ret || "").toUpperCase();
  const status = String(result.status || "").toUpperCase();
  if (ret === "HY_SUCCESS" || status === "SUCCESS") return true;

  if (payload && typeof payload === "object") {
    if (payload.success === true) return true;
    if (Number(payload.code) === 200) return true;
  }
  return false;
}

/**
 * Hand text or a URL to the platform's share sheet.
 *
 * @param {string} content what to share
 * @returns {Promise<boolean>} whether the sheet opened
 */
export async function shareContent(content) {
  if (!content) return false;
  const result = await call("CustomServiceJs", "shareContent", { content: String(content) });
  return parseShareResult(result);
}

/**
 * Hand an image to the platform's share sheet.
 *
 * @param {string} base64Image the image, base64 encoded
 * @returns {Promise<boolean>} whether the sheet opened
 */
export async function shareBase64Image(base64Image) {
  if (!base64Image) return false;
  const result = await call("CustomServiceJs", "shareBase64Image", {
    base64Image: String(base64Image)
  });
  return parseShareResult(result);
}

/* ── Files ───────────────────────────────────────────────────────────────── */

/**
 * Convert a Uint8Array to a Base64 string efficiently.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ArrayToBase64(bytes) {
  if (!bytes || !bytes.byteLength) return "";
  let binary = "";
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, len));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/*
  ── WHY WRITING A FILE IS A DIFFERENT PROBLEM ON ANDROID ────────────────────

  On iOS none of this is used. WKWebView has navigator.share, it accepts a real
  File, and report/share.js hands it one - which is why the iOS build already
  exports a correct .csv and .xlsx. Android WebView has no Web Share API at all
  (it is a Chrome feature, not a WebView one) and the container refuses blob:
  downloads, so the only route left there is a JSAPI.

  That JSAPI has to survive the legacy Android branch of the vendored
  bootstrap. From windvane.js, callMethod():

      } else if (m) {                                   // Android
        var g = "hybrid://" + ns + ":" + sid + "/" + method + "?" + params;
        window.prompt(g, "wv_hybrid:");

  and three lines above it, iOS:

        var g = "hybrid://" + ns + ":" + sid + "/" + method + "?"
                + encodeURIComponent(params);

  Android interpolates the params JSON into a URL RAW. A CSV carries newlines,
  commas, quotes, "#", "%" and Lao/Vietnamese UTF-8; a base64 blob carries "+"
  and "/". All of it reaches the native URL parser unescaped, and a single "#"
  truncates everything after it. Then the whole file goes through one
  synchronous window.prompt.

  Hence: small chunks, and a caller that only ever sends text. A base64 .xlsx
  does NOT come this way - see the note on writeDiskFile's data parameter.
*/

/* Characters per WVFile.write call. Small on purpose: on Android the payload
   rides inside a window.prompt argument, and nothing tells us where the
   container stops accepting one. */
const FILE_CHUNK_CHARS = 2000;

/**
 * Ask the container whether a JSAPI exists, before calling it.
 *
 * @param {string} namespace
 * @param {string} method
 * @returns {Promise<boolean|null>} null when the question itself could not be
 *          asked, which is NOT the same answer as "no": plenty of hosts
 *          implement WVFile without implementing WVBase.canIUse.
 */
export async function canIUse(namespace, method) {
  const result = await call("WVBase", "canIUse", { name: namespace + "." + method }, 2500);
  if (!result || typeof result !== "object") return null;
  for (const key of ["value", "result", "support", "isSupport", "data"]) {
    const v = result[key];
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "false") return v === "true";
  }
  return null;
}

/**
 * Did a WVFile.write actually write?
 *
 * Strict on purpose. The previous version accepted any object without an
 * `error` field, so a host answering "{}" produced "saved successfully" over a
 * file that was never created. A write that cannot be confirmed is reported as
 * a failure, because that is the answer a user can act on.
 *
 * Pulled out so it can be tested without a super-app in the loop.
 *
 * @param {*} result
 * @returns {boolean}
 */
export function parseWriteResult(result) {
  if (!result || typeof result !== "object") return false;
  const ret = Array.isArray(result.ret)
    ? result.ret.map(String)
    : result.ret
      ? [String(result.ret)]
      : [];
  if (ret.some(r => /FAIL|ERROR|NOT_|NO_/i.test(r))) return false;
  if (ret.some(r => /SUCCESS/i.test(r))) return true;
  if (result.success === true) return true;
  if (String(result.status || "").toUpperCase() === "SUCCESS") return true;
  return false;
}

/**
 * Is this refusal the container saying the mini-app was never granted the API?
 *
 * Observed on a Samsung SM-A576B, Android 16, WindVane/8.5.0 EmasMiniApp/1.0.0:
 *
 *     [windvane] WVFile.write failed
 *     {msg: "Please apply for JSAPI authorization"}
 *
 * That is not a bug in anything on this side. The method exists, the bridge is
 * up, and the container declines because this mini-app's appId is not on the
 * allowlist for WVFile. It has exactly one fix and it is not a code change, so
 * it is worth telling apart from every other failure.
 *
 * @param {*} error
 * @returns {boolean}
 */
export function isAuthError(error) {
  if (!error) return false;
  let text;
  try {
    text = typeof error === "string" ? error : JSON.stringify(error);
  } catch (e) {
    text = String(error);
  }
  return /authoriz|authoris|authority|permission|forbidden|HY_NO_PERMISSION/i.test(text || "");
}

/**
 * Write a TEXT file to the container's storage, in chunks.
 *
 * @param {string} fileName
 * @param {string} data Text, and only text. WVFile.write stores the string it
 *        is handed; it does not base64-decode. Sending base64 produces a text
 *        file full of base64, which is exactly what made the exported .xlsx
 *        unreadable on Android.
 * @returns {Promise<{ok: boolean, reason: string, detail?: *, chunks?: number}>}
 */
export async function writeDiskFile(fileName, data) {
  if (!fileName || !data) return { ok: false, reason: "empty" };
  if (!isSuperApp()) return { ok: false, reason: "no-bridge" };

  const supported = await canIUse("WVFile", "write");
  if (supported === false) return { ok: false, reason: "unsupported" };

  const text = String(data);
  const total = Math.max(1, Math.ceil(text.length / FILE_CHUNK_CHARS));
  let detail = null;

  for (let i = 0; i < total; i++) {
    const params = {
      mode: i === 0 ? "write" : "append",
      fileName,
      data: text.slice(i * FILE_CHUNK_CHARS, (i + 1) * FILE_CHUNK_CHARS)
    };
    let outcome = await callDetailed("WVFile", "write", params, 8000);

    if (!outcome.ok || !parseWriteResult(outcome.value)) {
      /* One retry on the first chunk under the mode name the previous build
         sent. "write"/"append" is what the JSAPI documents; "overwrite" is
         what was here before, and a host accepting only the latter would
         otherwise be indistinguishable from a host without the API. Not worth
         a second round trip once the container has said "unauthorized",
         because the mode is not what it is objecting to. */
      if (i === 0 && !isAuthError(outcome.error)) {
        outcome = await callDetailed("WVFile", "write", { ...params, mode: "overwrite" }, 8000);
        if (outcome.ok && parseWriteResult(outcome.value)) {
          detail = outcome.value;
          continue;
        }
      }
      detail = outcome.ok ? outcome.value : outcome.error;
      if (isAuthError(outcome.error)) {
        return { ok: false, reason: "unauthorized", detail, chunks: i };
      }
      return { ok: false, reason: i === 0 ? "refused" : "truncated", detail, chunks: i };
    }
    detail = outcome.value;
  }

  return { ok: true, reason: "written", detail, chunks: total };
}

/*
  ── WHAT THE EXPORT ROUTES ACTUALLY ARE ON THIS HANDSET ─────────────────────

  Written because the Android failure is invisible from a desk. call() answers
  null for "no bridge", for "no such method" and for "the native side dropped
  it", and those three need completely different fixes. This runs on the device
  with vConsole open and tells them apart.

  The round trip is the part that matters. It writes a payload made of exactly
  the characters the Android bridge does not escape - newline, comma, quote,
  "#", "+", "/" - and reads it back. What comes back says both whether
  WVFile.write exists and whether the URL transport mangles the payload on the
  way through.
*/
const PROBE_FILE = "speedtest-probe.txt";
const PROBE_TEXT = "PROBE-1\n\"a,b\"#c+d/e=f";

/**
 * Write a known payload and read it back.
 *
 * @returns {Promise<object>}
 */
export async function probeFileRoundTrip() {
  const written = await writeDiskFile(PROBE_FILE, PROBE_TEXT);
  if (!written.ok) {
    /* Lifted out of the detail object because this is the line worth reading:
       vConsole truncates a nested object to "Object {msg: "Please apply for
       JSAPI author..." and the end of that sentence is the whole answer. */
    const d = written.detail;
    const message = d && typeof d === "object" ? d.msg || d.message || d.ret : d;
    return {
      wrote: false,
      reason: written.reason,
      message: message === undefined ? null : String(message),
      detail: d
    };
  }
  const read = await call("WVFile", "read", { fileName: PROBE_FILE }, 5000);
  let got = null;
  if (read && typeof read === "object") {
    got = read.data !== undefined ? read.data : read.value !== undefined ? read.value : null;
  }
  return {
    wrote: true,
    readBack: got === null ? null : String(got),
    matches: got !== null && String(got) === PROBE_TEXT,
    detail: read
  };
}

/**
 * Everything that decides which export route this device can take.
 *
 * Logged as well as returned: the log is what a surveyor can screenshot out of
 * vConsole, the return value is what the export sheet renders.
 *
 * @returns {Promise<object>}
 */
export async function probeExportRoutes() {
  const win = typeof window !== "undefined" ? window : globalThis;
  const ua = (win.navigator && win.navigator.userAgent) || "";
  const wv = win.WindVane;

  const report = {
    userAgent: ua,
    /* The bootstrap parses this out of the UA, and refuses every call with
       HY_NOT_IN_WINDVANE when it is absent - so a null here explains a total
       bridge failure on its own. */
    windVaneUaVersion: (ua.match(/WindVane[/\s](\d+[._]\d+[._]\d+)/) || [])[1] || null,
    isSuperApp: isSuperApp(),
    windVane: typeof wv !== "undefined",
    windVaneIsAvailable: wv ? wv.isAvailable : null,
    windVaneNewBridge: wv ? wv.isNewBridgeAvailable : null,
    nativeBridge: typeof win.__windvane__ !== "undefined",
    nativeBridgeCall: !!(win.__windvane__ && win.__windvane__.call),
    webShare: !!(win.navigator && typeof win.navigator.share === "function"),
    webShareFiles: null,
    canIUse: {},
    roundTrip: null
  };

  try {
    if (typeof File === "function" && win.navigator && win.navigator.canShare) {
      const probe = new File([new Blob(["a"])], "probe.csv", { type: "text/csv" });
      report.webShareFiles = win.navigator.canShare({ files: [probe] });
    } else if (report.webShare) {
      /* share() without canShare(): whether files are accepted cannot be known
         without opening a sheet at the user, so it stays unanswered. */
      report.webShareFiles = null;
    } else {
      report.webShareFiles = false;
    }
  } catch (e) {
    report.webShareFiles = false;
  }

  const probes = [
    ["WVFile", "write"],
    ["WVFile", "read"],
    ["CustomServiceJs", "shareContent"],
    ["CustomServiceJs", "shareBase64Image"]
  ];
  for (const [ns, method] of probes) {
    report.canIUse[ns + "." + method] = await canIUse(ns, method);
  }

  report.roundTrip = await probeFileRoundTrip();

  console.log("[export] route probe", report);
  return report;
}


/*
  Start the bridge. Fire-and-forget by design.

  Nothing waits on this. The reference blocks its app mount behind the auth
  call and then polls localStorage for up to four seconds; doing the same here
  would reintroduce exactly the defect this project set out to remove - a user
  staring at a disabled UI while a network call they never asked for finishes
  (docs/analysis-phase1.md §13 #15).

  The cost of not waiting: a test started in the first moments after load can
  send its telemetry before the ISDN arrives, because telemetry_extra is fixed
  when the run starts and the engine refuses setting changes mid-run. That run
  is recorded without a subscriber number. Given the alternative is delaying
  every user to rescue the rare instant-tapper, that is the right trade.
*/
export async function initBridge(sdkUrl) {
  await loadSdk(sdkUrl);
  if (!isSuperApp()) return false;
  await Promise.all([fetchSubscriber(), fetchNetworkType(), fetchAppLanguage()]);
  return true;
}

/**
 * Close the mini-app and hand control back to the super-app.
 *
 * WHAT WAS WRONG
 *
 * This used to finish with history.back(), and its WindVane list led with
 * WVNavigator.pop. Both mean "go back one page". On a host where none of the
 * close methods are implemented they were the only calls with a visible
 * effect, so logging out behaved as Back: the session was cleared and the
 * screen that appeared belonged to somebody no longer signed in.
 *
 * Neither is coming back. A logout control that quietly degrades into Back is
 * worse than one that appears to do nothing, because doing nothing leaves the
 * caller free to show the login screen - which is what logout() already does.
 *
 * WHY EVERY CANDIDATE IS STILL TRIED, RATHER THAN STOPPING AT THE FIRST
 *
 * Because none of them reports success in a way worth trusting. WindVane's
 * call() answers null both for a failure and for a method that succeeded
 * without returning anything, and a host bridge that is simply absent looks
 * the same as one that declined.
 *
 * So the list is fired in full. Every entry means "close"; none navigates.
 *
 * FINDING THE ONE THAT WORKS
 *
 * Which bridge this host implements is not documented anywhere we have. The
 * environment line below is how to find out: open vConsole on the device, tap
 * logout, and read what is present. Then add the method that is really there.
 */
export async function exitApp() {
  const win = typeof window !== "undefined" ? window : globalThis;
  if (typeof win === "undefined") return;

  console.log("[bridge] exitApp: bridges present", {
    MiniappSDK: typeof win.MiniappSDK !== "undefined",
    WindVane: typeof win.WindVane !== "undefined",
    AlipayJSBridge: typeof win.AlipayJSBridge !== "undefined",
    my: typeof win.my !== "undefined",
    webkitHandlers:
      win.webkit && win.webkit.messageHandlers
        ? Object.keys(win.webkit.messageHandlers)
        : null,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null
  });

  /* 1. LaoApp MiniappSDK, injected by that host - never imported from npm. */
  if (win.MiniappSDK && typeof win.MiniappSDK.closeApp === "function") {
    try {
      await win.MiniappSDK.closeApp();
    } catch (e) {
      console.warn("[bridge] MiniappSDK.closeApp rejected", e);
    }
  }

  /* 2. Ali WindVane. Close only - the pop variants are what turned this
     button into Back. */
  if (win.WindVane && typeof win.WindVane.call === "function") {
    const methods = [
      /*
        WVBase.closePage first, and not by guesswork: it is the single call the
        Unitel reference mini-app makes to close itself on this same Ali host
        (ui/src/plugins/windvane.js there, reached from AppHeader's exit
        button). Nothing else is tried around it in that project.
      */
      ["WVBase", "closePage"],
      ["WVMiniApp", "close"],
      ["WVApplication", "close"],
      ["CustomServiceJs", "close"],
      ["CustomServiceJs", "exitApp"]
    ];
    for (const [ns, method] of methods) {
      const result = await call(ns, method, {}, 1500);
      if (result !== null) {
        console.log("[bridge] exitApp: " + ns + "." + method + " answered", result);
      }
    }
  }

  /* 3. AlipayJSBridge. exitApp only: closeWebview and popWindow are both
     back-navigations. */
  if (win.AlipayJSBridge && typeof win.AlipayJSBridge.call === "function") {
    try {
      win.AlipayJSBridge.call("exitApp");
    } catch (e) {
      console.warn("[bridge] AlipayJSBridge.exitApp threw", e);
    }
  }

  /* 4. Alipay mini program API. navigateBack is not called here, for the same
     reason as the pop variants. */
  if (win.my && typeof win.my.exitMiniProgram === "function") {
    try {
      win.my.exitMiniProgram();
    } catch (e) {
      console.warn("[bridge] my.exitMiniProgram threw", e);
    }
  }

  /* 5. iOS message handlers, if the host installed one under a name we know. */
  if (win.webkit && win.webkit.messageHandlers) {
    const handlers = [
      "closeApp",
      "closeMiniApp",
      "exitApp",
      "closePage",
      "MiniappSDK"
    ];
    for (const name of handlers) {
      const handler = win.webkit.messageHandlers[name];
      if (handler && typeof handler.postMessage === "function") {
        try {
          handler.postMessage({ action: "closeApp" });
          console.log("[bridge] exitApp: posted to webkit handler " + name);
        } catch (e) {
          console.warn("[bridge] webkit handler " + name + " threw", e);
        }
      }
    }
  }

  /* 6. Plain web. Does nothing inside a WebView, but it is not a
     back-navigation either, so it costs nothing to ask. */
  if (typeof win.close === "function") {
    try {
      win.close();
    } catch (e) {}
  }
}




