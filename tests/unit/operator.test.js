import { describe, expect, it } from "vitest";

import {
  OPERATOR,
  IP_RANGES,
  getOperatorFromIp,
  getOperatorFromIsdn,
  ipMatchesCidr,
  ipToInt,
  isIpInRanges,
  normaliseOperator,
  parseIpResponse
} from "../../ui/src/context/operator.js";

/*
  The carrier is the key the whole report is grouped by, and it is derived, not
  typed - so the derivation has to be exactly right. These pin the IP range
  table, the AS name table, the tail getIP.php appends, and the rule that anything
  off the list is null rather than a guess.
*/

describe("CIDR helper functions", () => {
  it("converts valid IPv4 strings to 32-bit integers", () => {
    expect(ipToInt("0.0.0.0")).toBe(0);
    expect(ipToInt("255.255.255.255")).toBe(4294967295);
    expect(ipToInt("183.182.96.0")).toBe(3082182656);
    expect(ipToInt("103.1.28.1")).toBe(1728125953);
  });

  it("returns null for malformed or non-IPv4 strings", () => {
    expect(ipToInt("")).toBeNull();
    expect(ipToInt("192.168.1")).toBeNull();
    expect(ipToInt("192.168.1.256")).toBeNull();
    expect(ipToInt("192.168.1.-1")).toBeNull();
    expect(ipToInt("invalid.ip.string.here")).toBeNull();
    expect(ipToInt(null)).toBeNull();
    expect(ipToInt(undefined)).toBeNull();
  });

  it("matches IPs against CIDR masks correctly", () => {
    // 183.182.96.0/19 covers 183.182.96.0 - 183.182.127.255
    expect(ipMatchesCidr("183.182.96.0", "183.182.96.0/19")).toBe(true);
    expect(ipMatchesCidr("183.182.100.201", "183.182.96.0/19")).toBe(true);
    expect(ipMatchesCidr("183.182.127.255", "183.182.96.0/19")).toBe(true);
    expect(ipMatchesCidr("183.182.128.0", "183.182.96.0/19")).toBe(false);
    expect(ipMatchesCidr("183.182.95.255", "183.182.96.0/19")).toBe(false);
  });

  it("checks membership in arrays of CIDRs", () => {
    expect(isIpInRanges("103.1.28.5", IP_RANGES.UNITEL)).toBe(true);
    expect(isIpInRanges("154.222.4.10", IP_RANGES.UNITEL)).toBe(true);
    expect(isIpInRanges("8.8.8.8", IP_RANGES.UNITEL)).toBe(false);
  });
});

describe("getOperatorFromIp", () => {
  it("identifies Unitel IPs correctly", () => {
    expect(getOperatorFromIp("183.182.96.1")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIp("183.182.100.201")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIp("103.1.28.10")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIp("154.222.4.55")).toBe(OPERATOR.UNITEL);
  });

  it("identifies LaoTel IPs correctly", () => {
    expect(getOperatorFromIp("103.43.76.1")).toBe(OPERATOR.LAOTEL);
    expect(getOperatorFromIp("115.84.103.20")).toBe(OPERATOR.LAOTEL);
    expect(getOperatorFromIp("115.84.64.5")).toBe(OPERATOR.LAOTEL);
    expect(getOperatorFromIp("202.137.128.100")).toBe(OPERATOR.LAOTEL);
    expect(getOperatorFromIp("202.144.187.1")).toBe(OPERATOR.LAOTEL);
  });

  it("identifies ETL IPs correctly", () => {
    expect(getOperatorFromIp("101.78.8.5")).toBe(OPERATOR.ETL);
    expect(getOperatorFromIp("103.13.88.10")).toBe(OPERATOR.ETL);
    expect(getOperatorFromIp("114.129.24.1")).toBe(OPERATOR.ETL);
    expect(getOperatorFromIp("202.62.96.2")).toBe(OPERATOR.ETL);
    expect(getOperatorFromIp("43.252.244.10")).toBe(OPERATOR.ETL);
  });

  it("identifies Best Telecom and Viettel IPs correctly", () => {
    expect(getOperatorFromIp("141.164.101.10")).toBe("Best Telecom");
    expect(getOperatorFromIp("171.241.8.5")).toBe("Viettel");
  });

  it("returns null for unknown, foreign, or invalid IPs", () => {
    expect(getOperatorFromIp("8.8.8.8")).toBeNull();
    expect(getOperatorFromIp("1.1.1.1")).toBeNull();
    expect(getOperatorFromIp("")).toBeNull();
    expect(getOperatorFromIp(null)).toBeNull();
    expect(getOperatorFromIp(undefined)).toBeNull();
  });
});

describe("normaliseOperator", () => {
  it("prioritises IP-based detection when IP is provided", () => {
    // Even if ISP text is generic or missing, matching IP wins
    expect(normaliseOperator("", "183.182.100.201")).toBe(OPERATOR.UNITEL);
    expect(normaliseOperator("Unknown ISP", "103.43.76.5")).toBe(OPERATOR.LAOTEL);
    expect(normaliseOperator(null, "101.78.8.10")).toBe(OPERATOR.ETL);
  });

  it("files both Unitel legal entities under Unitel when using AS name", () => {
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
    expect(normaliseOperator("Unknown ISP", "8.8.8.8")).toBeNull();
  });

  it("returns null for a non-string", () => {
    expect(normaliseOperator(null)).toBeNull();
    expect(normaliseOperator(undefined)).toBeNull();
    expect(normaliseOperator(42)).toBeNull();
  });
});

describe("parseIpResponse", () => {
  it("handles raw JSON responses with processedString", () => {
    const raw1 = JSON.stringify({ processedString: "172.19.0.1", rawIspInfo: "" });
    expect(parseIpResponse(raw1)).toEqual({ ip: "172.19.0.1", isp: "" });

    const raw2 = JSON.stringify({
      processedString: "183.182.100.201 - Star Telecom LA, Laos",
      rawIspInfo: { ip: "183.182.100.201" }
    });
    expect(parseIpResponse(raw2)).toEqual({ ip: "183.182.100.201", isp: OPERATOR.UNITEL });
  });

  it("handles plain text responses", () => {
    expect(parseIpResponse("183.182.100.201")).toEqual({ ip: "183.182.100.201", isp: OPERATOR.UNITEL });
    expect(parseIpResponse("103.43.76.10 - Lao Telecom")).toEqual({ ip: "103.43.76.10", isp: OPERATOR.LAOTEL });
    expect(parseIpResponse("8.8.8.8 - Google LLC")).toEqual({ ip: "8.8.8.8", isp: "Google LLC" });
  });

  it("handles objects directly", () => {
    expect(parseIpResponse({ processedString: "154.222.4.1" })).toEqual({ ip: "154.222.4.1", isp: OPERATOR.UNITEL });
    expect(parseIpResponse({ ip: "172.19.0.1" })).toEqual({ ip: "172.19.0.1", isp: "" });
  });

  it("handles empty or invalid inputs", () => {
    expect(parseIpResponse("")).toEqual({ ip: "", isp: "" });
    expect(parseIpResponse(null)).toEqual({ ip: "", isp: "" });
    expect(parseIpResponse(undefined)).toEqual({ ip: "", isp: "" });
  });

  it("uses ISDN to detect carrier when IP is private or unmapped", () => {
    const raw = JSON.stringify({ processedString: "172.19.0.1 - private IPv4 access", rawIspInfo: "" });
    expect(parseIpResponse(raw, "2095868688")).toEqual({ ip: "172.19.0.1", isp: OPERATOR.UNITEL });
  });
});

describe("getOperatorFromIsdn", () => {
  it("identifies Unitel subscriber numbers (209, 208, 206)", () => {
    expect(getOperatorFromIsdn("2095868688")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIsdn("02095868688")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIsdn("8562095868688")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIsdn("2081234567")).toBe(OPERATOR.UNITEL);
    expect(getOperatorFromIsdn("2061234567")).toBe(OPERATOR.UNITEL);
  });

  it("identifies LaoTel subscriber numbers (205)", () => {
    expect(getOperatorFromIsdn("2055555555")).toBe(OPERATOR.LAOTEL);
    expect(getOperatorFromIsdn("02055555555")).toBe(OPERATOR.LAOTEL);
  });

  it("identifies ETL subscriber numbers (202)", () => {
    expect(getOperatorFromIsdn("2022222222")).toBe(OPERATOR.ETL);
    expect(getOperatorFromIsdn("02022222222")).toBe(OPERATOR.ETL);
  });

  it("identifies Best Telecom subscriber numbers (207, 203)", () => {
    expect(getOperatorFromIsdn("2077777777")).toBe("Best Telecom");
    expect(getOperatorFromIsdn("2033333333")).toBe("Best Telecom");
  });

  it("returns null for invalid or non-matching numbers", () => {
    expect(getOperatorFromIsdn("")).toBeNull();
    expect(getOperatorFromIsdn(null)).toBeNull();
    expect(getOperatorFromIsdn("12345")).toBeNull();
  });
});

