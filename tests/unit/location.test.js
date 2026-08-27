import { describe, expect, it } from "vitest";

import { parseUserLocation } from "../../ui/src/context/location.js";

/*
  getUserLocation reaches the app in more than one shape - the bridge wraps the
  coordinates in a {ret,status,data} envelope on one platform (data a JSON
  string) and returns the bare object on another - so the parser is where that
  variation is absorbed. These pin the shapes observed against a real Unitel
  mini-app plus the failure modes that must resolve to "no fix", never to a
  wrong coordinate.
*/

describe("parseUserLocation", () => {
  it("reads the bare object a platform returns directly", () => {
    expect(parseUserLocation({ latitude: 17.9757, longitude: 102.6331 })).toEqual({
      lat: 17.9757,
      lng: 102.6331
    });
  });

  it("unwraps the {ret,status,data} envelope where data is a JSON string", () => {
    const result = {
      ret: "HY_SUCCESS",
      status: "SUCCESS",
      data: '{"longitude":102.6331,"latitude":17.9757}'
    };
    expect(parseUserLocation(result)).toEqual({ lat: 17.9757, lng: 102.6331 });
  });

  it("unwraps the envelope where data is already an object", () => {
    const result = { data: { latitude: 17.9757, longitude: 102.6331 } };
    expect(parseUserLocation(result)).toEqual({ lat: 17.9757, lng: 102.6331 });
  });

  /* The two platforms order the keys differently, so the value must be read by
     name - a positional read would swap lat and lng on one of them. */
  it("reads by field name regardless of key order", () => {
    const lngFirst = parseUserLocation({ longitude: 102.6331, latitude: 17.9757 });
    const latFirst = parseUserLocation({ latitude: 17.9757, longitude: 102.6331 });
    expect(lngFirst).toEqual(latFirst);
  });

  /* Some bridges hand back numbers as strings; Number() settles it. */
  it("coerces stringy numbers", () => {
    expect(parseUserLocation({ latitude: "17.9757", longitude: "102.6331" })).toEqual({
      lat: 17.9757,
      lng: 102.6331
    });
  });

  it("returns null for a missing, empty or unparseable result", () => {
    expect(parseUserLocation(null)).toBeNull();
    expect(parseUserLocation(undefined)).toBeNull();
    expect(parseUserLocation("nope")).toBeNull();
    expect(parseUserLocation({})).toBeNull();
    expect(parseUserLocation({ data: "not json" })).toBeNull();
    expect(parseUserLocation({ data: '{"foo":1}' })).toBeNull();
  });

  /*
    (0, 0) is what a failed native locate reports, and it is in the middle of
    the ocean. Stored as a reading it would drag a province average to the Gulf
    of Guinea, so it must be no fix, not a coordinate.
  */
  it("rejects the null-island sentinel", () => {
    expect(parseUserLocation({ latitude: 0, longitude: 0 })).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parseUserLocation({ latitude: 200, longitude: 102 })).toBeNull();
    expect(parseUserLocation({ latitude: 17, longitude: 400 })).toBeNull();
    expect(parseUserLocation({ latitude: "abc", longitude: 102 })).toBeNull();
  });

  /* A latitude of 0 on its own is the equator, a real place - only 0,0 together
     is the sentinel. This guards against over-eager zero-rejection. */
  it("keeps a real zero latitude when the longitude is not zero", () => {
    expect(parseUserLocation({ latitude: 0, longitude: 102.6331 })).toEqual({
      lat: 0,
      lng: 102.6331
    });
  });
});
