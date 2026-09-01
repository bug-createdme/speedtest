import { describe, expect, it } from "vitest";

import { parseAuthCode, parseNetworkType } from "../../ui/src/bridge/windvane.js";
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
  it("detects WindVane", async () => {
    const { isSuperApp } = await import("../../ui/src/bridge/windvane.js");
    const original = globalThis.WindVane;
    globalThis.WindVane = {};
    expect(isSuperApp()).toBe(true);
    globalThis.WindVane = original;
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
