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

export function isSuperApp() {
  return typeof window !== "undefined" && typeof window.WindVane !== "undefined";
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
    if (isSuperApp()) return resolve(true);
    if (!url) return resolve(false);
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      resolve(ok && isSuperApp());
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
  Promisified WindVane.call. Resolves with the result, or null on any failure -
  a missing bridge, an unsupported method, a native error, or a call that never
  calls either callback back. That last case is why there is a timeout: a
  native bridge that silently drops a call would otherwise leave this pending
  forever, and anything awaiting it would hang.
*/
export function call(namespace, method, params, timeoutMs) {
  return new Promise(resolve => {
    if (!isSuperApp()) return resolve(null);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs || 5000);
    try {
      window.WindVane.call(
        namespace,
        method,
        params || {},
        result => {
          clearTimeout(timer);
          finish(result);
        },
        error => {
          clearTimeout(timer);
          console.warn("[windvane] " + namespace + "." + method + " failed", error);
          finish(null);
        }
      );
    } catch (e) {
      clearTimeout(timer);
      console.warn("[windvane] " + namespace + "." + method + " threw", e);
      finish(null);
    }
  });
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
  const result = await call("wv", "getAuthCode", {
    scopes: ["USER_ID", "USER_NAME"]
  });
  const parsed = parseAuthCode(result);
  if (parsed) isdn.value = parsed.isdn;
  return parsed;
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
  const result = await call("WVNetwork", "getNetworkType");
  const parsed = parseNetworkType(result);
  if (parsed) networkType.value = parsed;
  return parsed;
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
  await Promise.all([fetchSubscriber(), fetchNetworkType()]);
  return true;
}

/**
 * Exit/close the MiniApp and return to the SuperApp host screen.
 * Implements a cascading fallback sequence as established in miniapp-predict-worldcup.
 */
export function exitApp() {
  console.log('[WindVane] Close app requested');
  if (typeof window === 'undefined') return;

  if (window.WindVane) {
    window.WindVane.call('WVMiniApp', 'close', {},
      () => console.log('[WindVane] Closed via WVMiniApp.close'),
      () => {
        window.WindVane.call('WVNavigator', 'pop', {},
          () => console.log('[WindVane] Closed via WVNavigator.pop'),
          () => {
            window.WindVane.call('WVUINavigator', 'pop', {},
              () => console.log('[WindVane] Closed via WVUINavigator.pop'),
              () => {
                window.WindVane.call('WVApplication', 'close', {},
                  () => console.log('[WindVane] Closed via WVApplication.close'),
                  (e) => {
                    console.error('[WindVane] All close methods failed, fallback to window.close', e);
                    try { window.close(); } catch (err) {}
                  }
                );
              }
            );
          }
        );
      }
    );
  } else if (window.AlipayJSBridge) {
    try {
      window.AlipayJSBridge.call('exitApp');
    } catch (e) {
      try { window.close(); } catch (err) {}
    }
  } else {
    try {
      window.close();
    } catch (e) {}
  }
}
