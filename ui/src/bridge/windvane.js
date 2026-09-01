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
const SUPER_APP_UA = /WindVane|AlipayClient|AliApp/i;

export function isSuperApp() {
  const win = typeof window !== "undefined" ? window : globalThis;
  if (typeof win === "undefined") return false;
  const ua = win.navigator && win.navigator.userAgent;
  if (ua && SUPER_APP_UA.test(ua)) return true;
  return (
    typeof win.WindVane !== "undefined" ||
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
  Promisified WindVane.call. Resolves with the result, or null on any failure -
  a missing bridge, an unsupported method, a native error, or a call that never
  calls either callback back. That last case is why there is a timeout: a
  native bridge that silently drops a call would otherwise leave this pending
  forever, and anything awaiting it would hang.
*/
export async function call(namespace, method, params, timeoutMs) {
  if (!isSuperApp()) return null;
  if (!(await whenBridgeReady())) {
    console.warn(
      "[windvane] " + namespace + "." + method + " skipped: no bridge after " +
        BRIDGE_WAIT_MS + "ms"
    );
    return null;
  }
  return new Promise(resolve => {
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
  if (typeof window !== "undefined" && window.WindVane) {
    const result = await call("WVNetwork", "getNetworkType");
    const parsed = parseNetworkType(result);
    if (parsed) {
      networkType.value = parsed;
      return parsed;
    }
  }

  if (
    typeof window !== "undefined" &&
    window.MiniappSDK &&
    typeof window.MiniappSDK.getNetworkInfo === "function"
  ) {
    try {
      const info = await window.MiniappSDK.getNetworkInfo();
      const parsed = parseNetworkType(info);
      if (parsed) {
        networkType.value = parsed;
        return parsed;
      }
    } catch (e) {
      console.warn("[MiniappSDK] getNetworkInfo failed", e);
    }
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




