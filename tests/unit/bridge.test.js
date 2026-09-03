import { describe, expect, it } from "vitest";

import {
  normalizeAppLocale,
  parseAppLanguage,
  parseAuthCode,
  parseNetworkType
} from "../../ui/src/bridge/windvane.js";
import { compareNetwork } from "../../ui/src/context/network.js";

/*
  The bridge parsers, and the network-change check.

  Both were deliberately written as pure functions so they could be reasoned
  about without a super-app in the loop. This is that payoff: the response
  shapes below are the ones the bridge is documented or observed to produce,
  plus the malformed ones it will eventually be handed, and none of them needs
  a device to exercise.
*/

describe("parseAuthCode", () => {
  /*
    wv.getAuthCode is not in the public WindVane documentation - it is an
    extension the Unitel super-app team added, and the shape below is what was
    observed working in a real mini-app. Observed is stronger than guessed and
    weaker than specified, so every access is optional and every failure
    returns null rather than throwing.
  */
  it("reads the subscriber number from a JSON-string scope", () => {
    const result = parseAuthCode({
      authSuccessScopes: ['{"USER_ID":{"isdn":"2091234567"}}']
    });
    expect(result).toEqual({ isdn: "2091234567" });
  });

  it("reads it from an already-parsed object scope", () => {
    const result = parseAuthCode({
      authSuccessScopes: [{ USER_ID: { isdn: "3095551234" } }]
    });
    expect(result).toEqual({ isdn: "3095551234" });
  });

  it("finds USER_ID among several scopes", () => {
    const result = parseAuthCode({
      authSuccessScopes: [
        { USER_NAME: { name: "Somchai" } },
        '{"USER_ID":{"isdn":"2099998888"}}'
      ]
    });
    expect(result.isdn).toBe("2099998888");
  });

  it("coerces a numeric isdn to a string", () => {
    const result = parseAuthCode({ authSuccessScopes: [{ USER_ID: { isdn: 2091234567 } }] });
    expect(result.isdn).toBe("2091234567");
  });

  /* Everything below is a shape the super-app team could ship tomorrow
     without telling us. None of it may throw. */
  it("returns null for anything it does not recognise", () => {
    expect(parseAuthCode(null)).toBeNull();
    expect(parseAuthCode({})).toBeNull();
    expect(parseAuthCode({ authSuccessScopes: "not an array" })).toBeNull();
    expect(parseAuthCode({ authSuccessScopes: [] })).toBeNull();
    expect(parseAuthCode({ authSuccessScopes: ["{ broken json"] })).toBeNull();
    expect(parseAuthCode({ authSuccessScopes: [{ USER_NAME: { name: "x" } }] })).toBeNull();
    expect(parseAuthCode({ authSuccessScopes: [{ USER_ID: {} }] })).toBeNull();
    expect(parseAuthCode({ authSuccessScopes: [{ USER_ID: { isdn: "" } }] })).toBeNull();
  });
});

describe("parseNetworkType", () => {
  /*
    The documentation confirms WVNetwork.getNetworkType exists but not what it
    answers with, so three plausible shapes are accepted rather than one being
    guessed at.
  */
  it("accepts a bare string", () => {
    expect(parseNetworkType("4g")).toBe("4G");
  });

  it("accepts the three documented-ish object shapes", () => {
    expect(parseNetworkType({ type: "wifi" })).toBe("WIFI");
    expect(parseNetworkType({ networkType: "5g" })).toBe("5G");
    expect(parseNetworkType({ network: "3g" })).toBe("3G");
  });

  it("returns an empty string when there is nothing to read", () => {
    expect(parseNetworkType(null)).toBe("");
    expect(parseNetworkType({})).toBe("");
    expect(parseNetworkType({ somethingElse: "4g" })).toBe("");
  });
});

describe("compareNetwork", () => {
  const snap = (type, online) => ({ type, online: online !== false, at: 0 });

  it("says nothing when the network held still", () => {
    expect(compareNetwork(snap("4G"), snap("4G"))).toBeNull();
  });

  it("flags a change of network type", () => {
    const verdict = compareNetwork(snap("4G"), snap("3G"));
    expect(verdict.reason).toBe("network-changed");
    expect(verdict.detail).toContain("4G");
    expect(verdict.detail).toContain("3G");
  });

  it("flags losing the connection outright, ahead of any type change", () => {
    const verdict = compareNetwork(snap("4G", true), snap("", false));
    expect(verdict.reason).toBe("went-offline");
  });

  /*
    "We do not know" is not "it changed". navigator.connection does not exist
    on iOS Safari at all, so treating an empty reading as a change would flag
    every run on those devices - making the flag useless by making it
    universal.
  */
  it("does not mistake an unknown reading for a change", () => {
    expect(compareNetwork(snap(""), snap("4G"))).toBeNull();
    expect(compareNetwork(snap("4G"), snap(""))).toBeNull();
    expect(compareNetwork(null, snap("4G"))).toBeNull();
    expect(compareNetwork(snap("4G"), null)).toBeNull();
  });

  it("ignores a difference of case only", () => {
    expect(compareNetwork(snap("4g"), snap("4G"))).toBeNull();
  });
});

describe("isSuperApp", () => {
  /*
    window.WindVane alone proves nothing now. The app vendors the JSAPI
    bootstrap, and that script defines window.WindVane wherever it runs -
    including the plain web build, which must not start calling JSAPIs.
  */
  it("does not treat window.WindVane alone as the super-app", async () => {
    const { isSuperApp } = await import("../../ui/src/bridge/windvane.js");
    const original = globalThis.WindVane;
    globalThis.WindVane = {};
    const result = isSuperApp();
    if (original) globalThis.WindVane = original;
    else delete globalThis.WindVane;
    expect(result).toBe(false);
  });

  it("detects MiniappSDK (LaoApp)", async () => {
    const { isSuperApp } = await import("../../ui/src/bridge/windvane.js");
    const original = globalThis.MiniappSDK;
    globalThis.MiniappSDK = { closeApp: () => Promise.resolve() };
    expect(isSuperApp()).toBe(true);
    delete globalThis.MiniappSDK;
    if (original) globalThis.MiniappSDK = original;
  });
});

describe("exitApp", () => {
  it("calls MiniappSDK.closeApp if available", async () => {
    let closed = false;
    globalThis.MiniappSDK = {
      closeApp: () => {
        closed = true;
        return Promise.resolve();
      }
    };
    const { exitApp } = await import("../../ui/src/bridge/windvane.js");
    await exitApp();
    expect(closed).toBe(true);
    delete globalThis.MiniappSDK;
  });
});



/*
  The two decisions that made the logout button look dead.

  window.WindVane is created by a script fetched from a CDN, and that fetch has
  been observed both failing outright and succeeding seconds later on the same
  handset. Deciding "is this the super-app" on the object alone turned a slow
  fetch into a permanent verdict of "plain web page", after which nothing on
  the bridge was ever tried again.
*/
describe("isSuperApp from the User-Agent", () => {
  const withUA = (ua, fn) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: ua },
      configurable: true,
      writable: true
    });
    try {
      return fn();
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete globalThis.navigator;
    }
  };

  it("says yes on the super-app UA even before the bridge object exists", async () => {
    const { isSuperApp } = await import("../../ui/src/bridge/windvane.js");
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Mobile/15E148 AliApp(EMASDemo/3.1.22) WindVane/8.6.1 " +
      "EMAS Superapp 1170x2532 Winding(WV_2) WK";
    const hadWindVane = globalThis.WindVane;
    delete globalThis.WindVane;
    const result = withUA(ua, () => isSuperApp());
    if (hadWindVane) globalThis.WindVane = hadWindVane;
    expect(result).toBe(true);
  });

  it("says no on a plain browser with no bridge", async () => {
    const { isSuperApp } = await import("../../ui/src/bridge/windvane.js");
    const hadWindVane = globalThis.WindVane;
    delete globalThis.WindVane;
    const result = withUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      () => isSuperApp()
    );
    if (hadWindVane) globalThis.WindVane = hadWindVane;
    expect(result).toBe(false);
  });
});

describe("whenBridgeReady", () => {
  it("resolves true when the bridge arrives after the first look", async () => {
    const { whenBridgeReady } = await import("../../ui/src/bridge/windvane.js");
    const original = globalThis.WindVane;
    delete globalThis.WindVane;
    setTimeout(() => {
      globalThis.WindVane = { call: () => {} };
    }, 250);
    const ready = await whenBridgeReady(2000);
    delete globalThis.WindVane;
    if (original) globalThis.WindVane = original;
    expect(ready).toBe(true);
  });

  it("gives up rather than hanging when it never arrives", async () => {
    const { whenBridgeReady } = await import("../../ui/src/bridge/windvane.js");
    const original = globalThis.WindVane;
    delete globalThis.WindVane;
    const ready = await whenBridgeReady(400);
    if (original) globalThis.WindVane = original;
    expect(ready).toBe(false);
  });
});

describe("uint8ArrayToBase64", () => {
  it("converts byte arrays to valid base64 strings", async () => {
    const { uint8ArrayToBase64 } = await import("../../ui/src/bridge/windvane.js");
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ArrayToBase64(bytes)).toBe("SGVsbG8=");
  });

  it("handles empty or null input gracefully", async () => {
    const { uint8ArrayToBase64 } = await import("../../ui/src/bridge/windvane.js");
    expect(uint8ArrayToBase64(null)).toBe("");
    expect(uint8ArrayToBase64(new Uint8Array([]))).toBe("");
  });
});

describe("writeDiskFile", () => {
  it("refuses a call with no filename or no data", async () => {
    const { writeDiskFile } = await import("../../ui/src/bridge/windvane.js");
    expect(await writeDiskFile("", "content")).toMatchObject({ ok: false, reason: "empty" });
    expect(await writeDiskFile("file.csv", "")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("does not claim a write outside the super-app", async () => {
    const { writeDiskFile } = await import("../../ui/src/bridge/windvane.js");
    expect(await writeDiskFile("file.csv", "a,b\n1,2")).toMatchObject({
      ok: false,
      reason: "no-bridge"
    });
  });
});

/*
  The refusal the Unitel Android container actually gives, observed on a
  SM-A576B running WindVane/8.5.0 EmasMiniApp/1.0.0:

    [windvane] WVFile.write failed  {msg: "Please apply for JSAPI authorization"}

  It has to be told apart from every other failure, because it is the one that
  no change on this side can fix - the mini-app's appId is not on the
  container's allowlist for WVFile, and only the super-app team can add it.
*/
describe("isAuthError", () => {
  it("recognises the container's own refusal", async () => {
    const { isAuthError } = await import("../../ui/src/bridge/windvane.js");
    expect(isAuthError({ msg: "Please apply for JSAPI authorization" })).toBe(true);
    expect(isAuthError({ ret: ["HY_NO_PERMISSION"] })).toBe(true);
    expect(isAuthError("Forbidden")).toBe(true);
  });

  it("does not mistake an ordinary failure for one", async () => {
    const { isAuthError } = await import("../../ui/src/bridge/windvane.js");
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError({ reason: "timeout" })).toBe(false);
    expect(isAuthError({ ret: ["HY_FAILED"] })).toBe(false);
    expect(isAuthError({ msg: "File not found" })).toBe(false);
  });
});

/*
  The regression these guard: the previous parser treated any object without an
  `error` field as a successful write, so a container that answered "{}" - or
  answered with a failure it spelled differently - produced "saved
  successfully" over a file that was never created.
*/
describe("parseWriteResult", () => {
  it("accepts only an affirmative answer", async () => {
    const { parseWriteResult } = await import("../../ui/src/bridge/windvane.js");
    expect(parseWriteResult({ ret: ["HY_SUCCESS"] })).toBe(true);
    expect(parseWriteResult({ ret: "HY_SUCCESS" })).toBe(true);
    expect(parseWriteResult({ success: true })).toBe(true);
    expect(parseWriteResult({ status: "success" })).toBe(true);
  });

  it("rejects silence, failure and anything that is not an object", async () => {
    const { parseWriteResult } = await import("../../ui/src/bridge/windvane.js");
    expect(parseWriteResult({})).toBe(false);
    expect(parseWriteResult(null)).toBe(false);
    expect(parseWriteResult("HY_SUCCESS")).toBe(false);
    expect(parseWriteResult({ ret: ["HY_FAILED"] })).toBe(false);
    expect(parseWriteResult({ ret: ["HY_NOT_IN_WINDVANE"] })).toBe(false);
    expect(parseWriteResult({ ret: ["NO_HANDLER"] })).toBe(false);
  });
});

describe("normalizeAppLocale", () => {
  it("normalizes Lao variants to la", () => {
    expect(normalizeAppLocale("la")).toBe("la");
    expect(normalizeAppLocale("lo")).toBe("la");
    expect(normalizeAppLocale("LA")).toBe("la");
    expect(normalizeAppLocale("LO")).toBe("la");
    expect(normalizeAppLocale("la-LA")).toBe("la");
    expect(normalizeAppLocale("lo-LA")).toBe("la");
    expect(normalizeAppLocale("lao")).toBe("la");
  });

  it("normalizes Vietnamese variants to vi", () => {
    expect(normalizeAppLocale("vi")).toBe("vi");
    expect(normalizeAppLocale("VI")).toBe("vi");
    expect(normalizeAppLocale("vi-VN")).toBe("vi");
    expect(normalizeAppLocale("vie")).toBe("vi");
  });

  it("normalizes English variants to en", () => {
    expect(normalizeAppLocale("en")).toBe("en");
    expect(normalizeAppLocale("EN")).toBe("en");
    expect(normalizeAppLocale("en-US")).toBe("en");
    expect(normalizeAppLocale("eng")).toBe("en");
  });

  it("returns empty string for unrecognized or empty locales", () => {
    expect(normalizeAppLocale("")).toBe("");
    expect(normalizeAppLocale(null)).toBe("");
    expect(normalizeAppLocale(undefined)).toBe("");
    expect(normalizeAppLocale("fr")).toBe("");
    expect(normalizeAppLocale("zh")).toBe("");
  });
});

describe("parseAppLanguage", () => {
  it("parses direct object responses from CustomServiceJs.getAppSetting", () => {
    expect(parseAppLanguage({ language: "la" })).toBe("la");
    expect(parseAppLanguage({ language: "lo" })).toBe("la");
    expect(parseAppLanguage({ lang: "vi" })).toBe("vi");
    expect(parseAppLanguage({ locale: "en" })).toBe("en");
  });

  it("parses data envelope with JSON string", () => {
    expect(parseAppLanguage({ data: '{"language":"la"}' })).toBe("la");
    expect(parseAppLanguage({ data: '{"lang":"lo"}' })).toBe("la");
    expect(parseAppLanguage({ data: '{"language":"vi-VN"}' })).toBe("vi");
  });

  it("parses data envelope with nested object", () => {
    expect(parseAppLanguage({ data: { language: "la" } })).toBe("la");
    expect(parseAppLanguage({ data: { lang: "en-US" } })).toBe("en");
  });

  it("parses bare string responses", () => {
    expect(parseAppLanguage('{"language":"la"}')).toBe("la");
    expect(parseAppLanguage("lo")).toBe("la");
    expect(parseAppLanguage("vi")).toBe("vi");
  });

  it("returns empty string for missing or invalid results", () => {
    expect(parseAppLanguage(null)).toBe("");
    expect(parseAppLanguage({})).toBe("");
    expect(parseAppLanguage({ data: "{ broken json" })).toBe("");
    expect(parseAppLanguage({ otherField: "something" })).toBe("");
  });
});

