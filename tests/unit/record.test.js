import { describe, expect, it } from "vitest";

import {
  RECORD_FIELDS,
  buildRecord,
  cellGeneration,
  netType,
  parseUserAgent,
  recordsToCsv
} from "../../ui/src/measurement/record.js";

/*
  These tests exist to hold three rules that are easy to break by accident and
  expensive to break in production, because each one fails by producing a
  plausible number rather than an error.
*/

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; BRP-NX1 Build/HONORBRP-N39) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** A run with every figure the engine can currently produce. */
function fullRun(overrides) {
  return Object.assign(
    {
      download: 23.4,
      upload: 5.12,
      ping: 28,
      jitter: 3.5,
      idlePingAvg: 31.2,
      dlPeak: 30.1,
      ulPeak: 6.4,
      dlBytes: 39_000_000,
      ulBytes: 9_600_000,
      dlDuration: 12_000,
      ulDuration: 12_000,
      dlSlowstart: 1500,
      ulSlowstart: 3000,
      dlAvgIncSlowstart: 21.0,
      ulAvgIncSlowstart: 4.4,
      dlPing: 96.5,
      ulPing: 120.25,
      dlJitter: 18.2,
      ulJitter: 22.9,
      dlStreams: 5,
      ulStreams: 3,
      pingSamples: 9,
      probeLoss: 0,
      probeCount: 92,
      ip: "10.20.30.40",
      isp: "Unitel Mobile LA",
      testId: "abc123"
    },
    overrides
  );
}

describe("units", () => {
  /*
    The engine reports Mbit/s; the partner's report format is kbit/s. Verified
    against their own file: BYTES x 8 / (DURATION/1000) / 1000 over
    SPEED_UPLOAD_AVG has a median of 0.993 across 394 of their rows, which only
    lands on 1.0 if AVG is kbit/s, DURATION is ms and BYTES is raw at once.
  */
  it("converts speeds from Mbit/s to kbit/s", () => {
    const record = buildRecord({ test: fullRun() });
    expect(record.SPEED_DOWNLOAD_AVG).toBe(23_400);
    expect(record.SPEED_UPLOAD_AVG).toBe(5_120);
    expect(record.SPEED_DOWNLOAD_PEAK).toBe(30_100);
  });

  it("leaves durations in ms and bytes raw", () => {
    const record = buildRecord({ test: fullRun() });
    expect(record.SPEED_DOWNLOAD_DURATION).toBe(12_000);
    expect(record.SPEED_DOWNLOAD_SLOWSTART_DURATION).toBe(1500);
    expect(record.BYTES_TRANSFERRED).toBe(48_600_000);
  });

  it("keeps the peak above the average and the warm-up average below it", () => {
    const record = buildRecord({ test: fullRun() });
    expect(record.SPEED_DOWNLOAD_PEAK).toBeGreaterThan(record.SPEED_DOWNLOAD_AVG);
    expect(record.SPEED_DOWNLOAD_AVG_INC_SLOWSTART).toBeLessThan(
      record.SPEED_DOWNLOAD_AVG
    );
  });
});

describe("absent is not zero", () => {
  /*
    The rule that matters most. A stored 0 for LOCATION_LAT is a coordinate in
    the Gulf of Guinea; a stored 0 for MOBILE_RSRP is an impossibly strong
    signal. Both would be averaged into a per-province report as if they were
    readings, and nothing about either looks unanswered.
  */
  it("reports what has not been collected as null, never 0", () => {
    const record = buildRecord({ test: fullRun() });
    for (const field of [
      "LOCATION_LAT",
      "LOCATION_LNG",
      "LOCATION_ACCURACY",
      "LOCATION_AAL1",
      "LOCATION_AAL2",
      "MOBILE_CELL_ID",
      "MOBILE_RSRP_START",
      "MOBILE_RSRP_END",
      "MOBILE_RSRQ_START"
    ]) {
      expect(record[field], field + " must be null, not 0").toBeNull();
    }
  });

  it("reports a failed run's speeds as null rather than 0 Mbps", () => {
    const record = buildRecord({ test: fullRun({ download: 0, upload: 0 }) });
    expect(record.SPEED_DOWNLOAD_AVG).toBeNull();
    expect(record.SPEED_UPLOAD_AVG).toBeNull();
  });
});

describe("probe loss is not packet loss", () => {
  /*
    Writing our HTTP-probe failure rate into their SPEED_DOWNLOAD_PACKETLOSS
    would have their pipeline read it as an IP loss counter and report 0% at
    exactly the cells that are failing.
  */
  it("leaves the partner's packet-loss column empty", () => {
    const record = buildRecord({ test: fullRun({ probeLoss: 4.35, probeCount: 92 }) });
    expect(record.SPEED_DOWNLOAD_PACKETLOSS).toBeNull();
    expect(record.PROBE_LOSS_PCT).toBe(4.35);
    expect(record.PROBE_SAMPLES).toBe(92);
  });

  /*
    The one field where 0 is a reading. "0.00% of 92 probes failed" is a
    result; mapping it to null would keep the bad news and throw away the good,
    leaving only problem rows carrying a figure at all.
  */
  it("keeps a measured zero, and only nulls it when nothing was probed", () => {
    const clean = buildRecord({ test: fullRun({ probeLoss: 0, probeCount: 92 }) });
    expect(clean.PROBE_LOSS_PCT).toBe(0);

    const unprobed = buildRecord({ test: fullRun({ probeLoss: 0, probeCount: 0 }) });
    expect(unprobed.PROBE_LOSS_PCT).toBeNull();
  });
});

describe("network classification", () => {
  /*
    navigator.connection.effectiveType is a throughput bucket, not a radio
    type: it answers "4g" for fast wifi and for a desktop on fibre, and has no
    "5g" value at all. Classifying from it filed a desktop run over ethernet as
    mobile 3G during testing - a fabricated row in the breakdown the whole
    report is grouped by.
  */
  it("refuses to call a run mobile on the strength of effectiveType", () => {
    expect(netType("4G", "effectiveType")).toBeNull();
    expect(cellGeneration("4G", "effectiveType")).toBeNull();
  });

  it("trusts the super-app bridge", () => {
    expect(netType("4G", "bridge")).toBe("mobile");
    expect(cellGeneration("4G", "bridge")).toBe(4);
    expect(cellGeneration("5G", "bridge")).toBe(5);
    expect(cellGeneration("LTE", "bridge")).toBe(4);
  });

  /* effectiveType never says "wifi", so the word can only have come from
     something that actually knows. */
  it("believes a wifi claim from either source", () => {
    expect(netType("WIFI", "effectiveType")).toBe("wifi");
    expect(netType("WIFI", "bridge")).toBe("wifi");
    expect(cellGeneration("WIFI", "bridge")).toBeNull();
  });

  it("records where the classification came from", () => {
    const guessed = buildRecord({
      test: fullRun(),
      connection: "4G",
      connectionSource: "effectiveType"
    });
    expect(guessed.NET_TYPE).toBeNull();
    expect(guessed.NET_NAME).toBe("4G");
    expect(guessed.NET_SOURCE).toBe("effectiveType");
  });
});

describe("interrupted runs", () => {
  it("marks a run whose network changed, and says why", () => {
    const record = buildRecord({
      test: fullRun(),
      netStart: { type: "4G" },
      netEnd: { type: "3G" },
      invalid: { reason: "network-changed", detail: "..." }
    });
    expect(record.MEASUREMENT_VALID).toBe(false);
    expect(record.MEASUREMENT_INVALID_REASON).toBe("network-changed");
    expect(record.NET_NAME_START).toBe("4G");
    expect(record.NET_NAME_END).toBe("3G");
  });

  it("marks an undisturbed run valid", () => {
    const record = buildRecord({
      test: fullRun(),
      netStart: { type: "4G" },
      netEnd: { type: "4G" },
      invalid: null
    });
    expect(record.MEASUREMENT_VALID).toBe(true);
    expect(record.MEASUREMENT_INVALID_REASON).toBeNull();
  });
});

describe("device identification", () => {
  it("reads an Android handset", () => {
    const device = parseUserAgent(ANDROID_UA);
    expect(device.platform).toBe("android");
    expect(device.osVersion).toBe("15");
    expect(device.brand).toBe("BRP-NX1");
  });

  it("reads an iPhone, converting the underscored OS version", () => {
    const device = parseUserAgent(IOS_UA);
    expect(device.platform).toBe("ios");
    expect(device.osVersion).toBe("17.5.1");
    expect(device.brand).toBe("Apple");
  });

  /* A desktop browser is not a handset, and guessing one would put a
     fabricated device into the fleet breakdown. */
  it("returns nulls rather than guesses for anything else", () => {
    const device = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
    );
    expect(device.platform).toBeNull();
    expect(device.model).toBeNull();
  });

  it("survives a missing user agent", () => {
    expect(parseUserAgent("").platform).toBeNull();
    expect(parseUserAgent(undefined).platform).toBeNull();
  });
});

describe("csv export", () => {
  it("writes one column per declared field, in declared order", () => {
    const csv = recordsToCsv([buildRecord({ test: fullRun() })]);
    const header = csv.split("\n")[0].split(",");
    expect(header).toEqual(RECORD_FIELDS);
  });

  /* An empty cell, not "0" and not "null" - the same rule the records follow,
     carried into the file operations will open in Excel. */
  it("writes a null as an empty cell", () => {
    const csv = recordsToCsv([buildRecord({ test: fullRun() })]);
    const cells = csv.split("\n")[1].split(",");
    expect(cells[RECORD_FIELDS.indexOf("LOCATION_LAT")]).toBe("");
    expect(cells[RECORD_FIELDS.indexOf("SPEED_DOWNLOAD_PACKETLOSS")]).toBe("");
  });

  it("quotes a value that would otherwise break the row", () => {
    const record = buildRecord({
      test: fullRun(),
      server: { name: 'Vientiane, "north"' }
    });
    const csv = recordsToCsv([record]);
    expect(csv).toContain('"Vientiane, ""north"""');
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("writes only a header for no records", () => {
    expect(recordsToCsv([]).split("\n")).toHaveLength(1);
  });
});
