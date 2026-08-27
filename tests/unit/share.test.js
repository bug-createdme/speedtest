import { describe, expect, it } from "vitest";

import { parseShareResult } from "../../ui/src/bridge/windvane.js";
import { summaryText } from "../../ui/src/report/share.js";

/*
  The share path has one job that matters: never claim a result left the device
  when it did not. parseShareResult decides whether the bridge actually opened a
  sheet, and getting that wrong in the optimistic direction means the caller
  stops trying and the surveyor believes they sent something.
*/

describe("parseShareResult", () => {
  it("accepts the documented reply", () => {
    expect(
      parseShareResult({ code: 200, message: "Share sheet presented successfully", success: true })
    ).toBe(true);
  });

  /* The same super-app wraps other replies this way - getUserLocation does -
     so both shapes have to be understood here too. */
  it("accepts the envelope form, with data as an object or a JSON string", () => {
    expect(parseShareResult({ ret: "HY_SUCCESS", status: "SUCCESS", data: { success: true } })).toBe(true);
    expect(parseShareResult({ data: '{"code":200,"success":true}' })).toBe(true);
  });

  it("accepts success signalled by code alone", () => {
    expect(parseShareResult({ code: 200 })).toBe(true);
  });

  /*
    The direction that matters. A reply that arrived but says nothing useful is
    "did not share" - claiming otherwise would stop the caller falling back to
    the clipboard, and the user would be told it was shared when it was not.
  */
  it("refuses anything that does not actually say it worked", () => {
    expect(parseShareResult(null)).toBe(false);
    expect(parseShareResult(undefined)).toBe(false);
    expect(parseShareResult({})).toBe(false);
    expect(parseShareResult({ success: false })).toBe(false);
    expect(parseShareResult({ code: 500 })).toBe(false);
    expect(parseShareResult({ message: "ok" })).toBe(false);
    expect(parseShareResult({ data: "not json" })).toBe(false);
  });
});

describe("summaryText", () => {
  const run = {
    testId: "abc123",
    download: 23.42,
    upload: 5.118,
    ping: 28.4,
    server: "Vientiane",
    operator: "Unitel",
    place: "Vientiane Capital",
    at: "2026-08-27T09:00:00.000Z"
  };

  it("leads with the speeds and ends with the id operations quotes", () => {
    const lines = summaryText(run).split("\n");
    expect(lines[0]).toBe("Speed test result");
    expect(lines[1]).toBe("Download: 23.4 Mbps");
    expect(lines[2]).toBe("Upload: 5.1 Mbps");
    expect(lines[3]).toBe("Ping: 28 ms");
    expect(lines[lines.length - 1]).toBe("Result ID: abc123");
  });

  /*
    Absent is left out, not printed empty. "Province: -" reads as a value the
    app failed to fill in; the line simply not being there says nothing, which
    is what is true when no boundary table is loaded.
  */
  it("omits the lines it has no value for", () => {
    const text = summaryText({ download: 10, upload: 2, ping: 30 });
    expect(text).not.toContain("Province");
    expect(text).not.toContain("Operator");
    expect(text).not.toContain("Result ID");
    expect(text).not.toContain("undefined");
  });

  it("prints a dash for a missing figure rather than a wrong zero", () => {
    const text = summaryText({ testId: "x" });
    expect(text).toContain("Download: - Mbps");
    expect(text).not.toContain("0.0 Mbps");
  });

  it("survives being handed nothing", () => {
    expect(summaryText(undefined).split("\n")[0]).toBe("Speed test result");
  });
});
