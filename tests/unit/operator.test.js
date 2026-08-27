import { describe, expect, it } from "vitest";

import { OPERATOR, normaliseOperator } from "../../ui/src/context/operator.js";

/*
  The carrier is the key the whole report is grouped by, and it is derived, not
  typed - so the derivation has to be exactly right. These pin the four-names-to-
  three-carriers table, the tail getIP.php appends, and the rule that anything
  off the list is null rather than a guess.
*/

describe("normaliseOperator", () => {
  it("files both Unitel legal entities under Unitel", () => {
    expect(normaliseOperator("Unitel Mobile LA")).toBe(OPERATOR.UNITEL);
    // Star Telecom is the joint venture - a different AS name, same carrier.
    expect(normaliseOperator("Star Telecom LA")).toBe(OPERATOR.UNITEL);
  });

  it("maps the LaoTel and ETL names", () => {
    expect(normaliseOperator("Lao Telecom Communication")).toBe(OPERATOR.LAOTEL);
    expect(normaliseOperator("LTC LA")).toBe(OPERATOR.LAOTEL);
    expect(normaliseOperator("ETL Company LA")).toBe(OPERATOR.ETL);
  });

  /* Offline-DB path: getIP.php returns as_name + ", " + country_name. */
  it("strips the trailing country the offline database appends", () => {
    expect(normaliseOperator("Unitel Mobile LA, Laos")).toBe(OPERATOR.UNITEL);
    expect(normaliseOperator("ETL Company LA, Laos")).toBe(OPERATOR.ETL);
  });

  /* API path: getIP.php appends " (<distance>)". */
  it("strips the trailing distance the API path appends", () => {
    expect(normaliseOperator("Unitel Mobile LA (12.3 km)")).toBe(OPERATOR.UNITEL);
  });

  it("matches regardless of case and extra whitespace", () => {
    expect(normaliseOperator("UNITEL MOBILE LA, Laos")).toBe(OPERATOR.UNITEL);
    expect(normaliseOperator("  unitel   mobile  la  ")).toBe(OPERATOR.UNITEL);
  });

  /*
    Off the list is null, not a guess. A substring test would have filed this as
    Unitel; the table does not, because inventing a carrier is worse than an
    empty one in a breakdown grouped by carrier.
  */
  it("returns null for an unknown carrier, without substring-guessing", () => {
    expect(normaliseOperator("Fake Unitel Reseller LA")).toBeNull();
    expect(normaliseOperator("Some Home Broadband")).toBeNull();
    expect(normaliseOperator("")).toBeNull();
  });

  it("returns null for a non-string", () => {
    expect(normaliseOperator(null)).toBeNull();
    expect(normaliseOperator(undefined)).toBeNull();
    expect(normaliseOperator(42)).toBeNull();
  });
});
