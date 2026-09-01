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


