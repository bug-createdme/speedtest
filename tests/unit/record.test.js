import { describe, expect, it } from "vitest";

import {
  RECORD_FIELDS,
  buildRecord,
  cellGeneration,
  netType,
  parseUserAgent,
  recordsToCsv,
  recordsToTsv
} from "../../ui/src/measurement/record.js";
import { summarise } from "../../ui/src/measurement/kpi.js";

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
      "LOCATION_LOCALITY",
      "LOCATION_FULL_ADDRESS",
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

describe("carrier from ISP", () => {
  /*
    CHANGE-012: the record carries the carrier the report groups by, normalised
    from the ISP name rather than typed in. Two rules matter beyond the mapping
    itself - a wifi run must not be filed under a mobile carrier, and an
    unclassified network is still resolved best-effort.
  */
  it("normalises the ISP into a report carrier on a mobile run", () => {
    const record = buildRecord({
      test: fullRun({ isp: "Unitel Mobile LA, Laos" }),
      connection: "4G",
      connectionSource: "bridge"
    });
    expect(record.NET_TYPE).toBe("mobile");
    expect(record.MOBILE_OPERATOR).toBe("Unitel");
    // The raw name is still kept alongside the normalised one.
    expect(record.MOBILE_ISP).toBe("Unitel Mobile LA, Laos");
  });

  /*
    On wifi the AS name is the router's ISP, not the mobile carrier. Filing it
    as one would invent a carrier the run never measured, so it is nulled even
    though the same string maps cleanly on a mobile run.
  */
  it("refuses to name a carrier on a wifi run", () => {
    const record = buildRecord({
      test: fullRun({ isp: "Unitel Mobile LA, Laos" }),
      connection: "WIFI",
      connectionSource: "bridge"
    });
    expect(record.NET_TYPE).toBe("wifi");
    expect(record.MOBILE_OPERATOR).toBeNull();
  });

  /* Outside the super-app the network cannot be classified; the carrier is
     still resolved, and NET_TYPE null is what marks the row unverified. */
  it("still resolves the carrier on an unclassified network", () => {
    const record = buildRecord({ test: fullRun({ isp: "ETL Company LA, Laos" }) });
    expect(record.NET_TYPE).toBeNull();
    expect(record.MOBILE_OPERATOR).toBe("ETL");
  });

  it("leaves the carrier null when the ISP is not one of the three", () => {
    const record = buildRecord({
      test: fullRun({ isp: "Some Home Broadband" }),
      connection: "4G",
      connectionSource: "bridge"
    });
    expect(record.MOBILE_OPERATOR).toBeNull();
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

describe("web and video fields", () => {
  /*
    CHANGE-010 added the browse and video stages, and their figures reach the
    record the same untested way the speed figures used to. They follow the
    absent-is-not-zero rule with one extra turn: for these two, a measured zero
    IS the reading the KPI grades on - 0 bytes is "moved nothing" (a fail), 0ms
    rebuffering is "no freezing" (the pass). So a stage that ran and measured a
    zero must keep the zero, while a stage that never ran must be null - and
    telling those apart is exactly what buildRecord does here and nothing pins.
  */
  const built = (over) => buildRecord({ test: fullRun(over) });

  it("passes a measured browse result through", () => {
    const r = built({ browseStatus: "Timeout", browseTime: 4000, browseBytes: 1_050_000 });
    expect(r.BROWSE_STATUS).toBe("Timeout");
    expect(r.BROWSE_TIME).toBe(4000);
    expect(r.BROWSE_BYTES).toBe(1_050_000);
  });

  /*
    A stage that never ran is null, not 0. A stored 0 reads as "the connection
    moved nothing in the window" - a real fail the web rate must count - so a
    skipped run cannot be allowed to look like one.
  */
  it("stores a skipped or absent browse as null bytes", () => {
    // A non-zero count here: the status, not the number, is what nulls it - a
    // Skip discards even a real-looking byte count rather than grading on it.
    expect(built({ browseStatus: "Skip", browseBytes: 800_000 }).BROWSE_BYTES).toBeNull();
    const absent = built({});
    expect(absent.BROWSE_STATUS).toBeNull();
    expect(absent.BROWSE_BYTES).toBeNull();
  });

  /* The zero that must survive: a browse that ran and moved nothing is the
     worst kind of pass/fail row, and nulling it would drop it from the rate. */
  it("keeps a measured zero bytes on a browse that ran", () => {
    expect(built({ browseStatus: "Timeout", browseBytes: 0 }).BROWSE_BYTES).toBe(0);
  });

  it("passes a video that played through, keeping a measured zero rebuffering", () => {
    const r = built({
      videoStatus: "OK",
      videoTimeToPlay: 1200,
      videoRebuffering: 0,
      videoRebufferCount: 0,
      videoTotal: 10_000,
      videoQuality: 720
    });
    expect(r.STREAM_STATUS).toBe("OK");
    expect(r.STREAM_PRELOADING_TIME).toBe(1200);
    // 0 is the pass condition for "không bị dừng hình", not an absence.
    expect(r.STREAM_REBUFFERING_TIME).toBe(0);
    expect(r.STREAM_REBUFFER_COUNT).toBe(0);
    expect(r.STREAM_QUALITY).toBe(720);
  });

  /*
    A video that never started has no time-to-play, and rebuffering is
    undefined for it - a clip that never played cannot have "zero freezing".
    Both must be null, or a never-started run would score as a clean pass on
    the no-freeze indicator, which grades at 90%.
  */
  it("nulls rebuffering when the video never started, even if a zero was passed in", () => {
    const r = built({
      videoStatus: "Timeout",
      videoTimeToPlay: 0,
      videoRebuffering: 0,
      videoRebufferCount: 0
    });
    expect(r.STREAM_PRELOADING_TIME).toBeNull();
    expect(r.STREAM_REBUFFERING_TIME).toBeNull();
    expect(r.STREAM_REBUFFER_COUNT).toBeNull();
  });

  it("stores a skipped video as all nulls", () => {
    const r = built({ videoStatus: "Skip" });
    expect(r.STREAM_STATUS).toBe("Skip");
    expect(r.STREAM_PRELOADING_TIME).toBeNull();
    expect(r.STREAM_REBUFFERING_TIME).toBeNull();
    expect(r.STREAM_REBUFFER_COUNT).toBeNull();
  });

  /*
    The contract between this file and kpi.js: the field names buildRecord
    writes are the ones samplePasses reads. A rename on either side makes every
    web and video sample silently unmeasurable, and no per-metric test catches
    it because each side uses its own synthetic record. One run through both
    ends pins the names together.
  */
  it("produces a record the KPI summary can grade on all five indicators", () => {
    const record = buildRecord({
      test: fullRun({
        browseStatus: "Timeout",
        browseTime: 4000,
        browseBytes: 900_000,
        videoStatus: "OK",
        videoTimeToPlay: 1200,
        videoRebuffering: 0,
        videoRebufferCount: 0
      }),
      connection: "4G",
      connectionSource: "bridge"
    });
    const summary = summarise([record]);
    for (const name of ["download", "upload", "web", "videoPlay", "videoFreeze"]) {
      expect(summary.metrics[name].measured, name).toBe(1);
      expect(summary.metrics[name].verdict, name).toBe(true);
    }
  });
});

describe("location fields", () => {
  /*
    CHANGE-007 (location part): the coordinates from context/location.js land in
    the record here. Coordinates are not a measured magnitude, so they do NOT
    follow the absent-is-not-zero rule the speeds do - a latitude of 0 is the
    equator, a real place - while accuracy does, because the bridge reports none
    and a stored 0 would read as a perfect fix.
  */
  it("maps a bridge fix, with accuracy null rather than zero", () => {
    const r = buildRecord({
      test: fullRun(),
      location: { lat: 17.9757, lng: 102.6331, accuracy: null }
    });
    expect(r.LOCATION_LAT).toBe(17.9757);
    expect(r.LOCATION_LNG).toBe(102.6331);
    // The bridge gives no accuracy: it stays null, not 0.
    expect(r.LOCATION_ACCURACY).toBeNull();
  });

  it("keeps the accuracy a web fix carries", () => {
    const r = buildRecord({
      test: fullRun(),
      location: { lat: 17.9757, lng: 102.6331, accuracy: 12 }
    });
    expect(r.LOCATION_ACCURACY).toBe(12);
  });

  it("stores a run with no fix as null coordinates", () => {
    const r = buildRecord({ test: fullRun() });
    expect(r.LOCATION_LAT).toBeNull();
    expect(r.LOCATION_LNG).toBeNull();
    expect(r.LOCATION_ACCURACY).toBeNull();
  });

  /* Coordinates are not magnitudes: a genuine 0 must survive, unlike a 0 Mbps. */
  it("keeps a real zero coordinate", () => {
    const r = buildRecord({
      test: fullRun(),
      location: { lat: 0, lng: 102.6331, accuracy: null }
    });
    expect(r.LOCATION_LAT).toBe(0);
  });

  /* The area is resolved by context/geo.js before it gets here; this layer
     writes down what it is handed. */
  it("stores the province and district resolved from the coordinates", () => {
    const r = buildRecord({
      test: fullRun(),
      location: {
        lat: 17.9757,
        lng: 102.6331,
        accuracy: 12,
        aal1: "Vientiane Capital",
        aal2: "Chanthabuly",
        country: "Laos"
      }
    });
    expect(r.LOCATION_AAL1).toBe("Vientiane Capital");
    expect(r.LOCATION_AAL2).toBe("Chanthabuly");
    expect(r.LOCATION_COUNTRY).toBe("Laos");
  });

  /*
    A fix with no boundary table loaded - the shipping default. The coordinates
    are still stored; the province is empty rather than guessed, which is the
    whole point of geo.js shipping without polygons.
  */
  it("keeps the coordinates but leaves the area null when nothing resolved it", () => {
    const r = buildRecord({
      test: fullRun(),
      location: { lat: 17.9757, lng: 102.6331, accuracy: null }
    });
    expect(r.LOCATION_LAT).toBe(17.9757);
    expect(r.LOCATION_COUNTRY).toBeNull();
    expect(r.LOCATION_AAL1).toBeNull();
    expect(r.LOCATION_AAL2).toBeNull();
    expect(r.LOCATION_LOCALITY).toBeNull();
    expect(r.LOCATION_FULL_ADDRESS).toBeNull();
  });

  /* A street address is not derivable from boundary polygons alone. */
  it("leaves the full address null when absent", () => {
    const r = buildRecord({
      test: fullRun(),
      location: { lat: 17.9757, lng: 102.6331, aal1: "Vientiane Capital" }
    });
    expect(r.LOCATION_FULL_ADDRESS).toBeNull();
  });

  it("records full address and locality when provided", () => {
    const r = buildRecord({
      test: fullRun(),
      location: {
        lat: 17.9757,
        lng: 102.6331,
        aal1: "Oudomxay",
        aal2: "Houne District",
        locality: "Nathong",
        fullAddress: "2W, Nathong, Houne District, Oudomxay, Laos",
        country: "Laos"
      }
    });
    expect(r.LOCATION_AAL1).toBe("Oudomxay");
    expect(r.LOCATION_AAL2).toBe("Houne District");
    expect(r.LOCATION_LOCALITY).toBe("Nathong");
    expect(r.LOCATION_FULL_ADDRESS).toBe("2W, Nathong, Houne District, Oudomxay, Laos");
    expect(r.LOCATION_COUNTRY).toBe("Laos");
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

describe("qoe fields", () => {
  it("includes QoE, Browsing, and Streaming scores in record output", () => {
    const r = buildRecord({
      test: fullRun({
        qoeResult: {
          overallScore: 88,
          overallGrade: "good",
          downloadScore: 85,
          uploadScore: 70,
          latencyScore: 90,
          browsingScore: 92,
          streamingScore: 95
        },
        browsingResult: {
          score: 92,
          grade: "excellent",
          averageLoadTime: 780,
          successRate: 100,
          totalSites: 5
        },
        streamingResult: {
          score: 95,
          grade: "excellent",
          startupTimeMs: 420,
          bufferingCount: 0,
          bufferingDurationMs: 0,
          rebufferingRatio: 0,
          throughputMbps: 18.5,
          highestStableQuality: "1080p"
        }
      })
    });

    expect(r.QOE_OVERALL_SCORE).toBe(88);
    expect(r.QOE_OVERALL_GRADE).toBe("good");
    expect(r.QOE_DOWNLOAD_SCORE).toBe(85);
    expect(r.BROWSING_SCORE).toBe(92);
    expect(r.BROWSING_GRADE).toBe("excellent");
    expect(r.BROWSING_AVG_LOAD_TIME).toBe(780);
    expect(r.STREAMING_SCORE).toBe(95);
    expect(r.STREAMING_STARTUP_TIME).toBe(420);
    expect(r.STREAMING_BUFFERING_COUNT).toBe(0);
    expect(r.STREAMING_HIGHEST_QUALITY).toBe("1080p");
  });
});

describe("RECORD_FIELDS covers the record", () => {
  /*
    The column order is declared by hand so that adding a field cannot reorder
    a file someone already parses. The cost is that a field added to the record
    and not to the list is measured, stored, and then silently absent from
    every export - which is what happened to STREAMING_PERFORMANCE_RATE and
    STREAMING_DATA_USED_BYTES: both were on screen and neither reached the
    spreadsheet.
  */
  /*
    Held out on purpose. IPV6 is a placeholder the record always writes as
    null, so exporting it would add a permanently empty column; the underscore
    keys are our own envelope rather than measurement data. Named here so that
    leaving a field out stays a decision someone made, and any OTHER new field
    fails this test.
  */
  const NOT_EXPORTED = ["IPV6"];

  it("exports every field the record builds", () => {
    const record = buildRecord({ test: fullRun() });
    const missing = Object.keys(record).filter(
      (f) => !f.startsWith("_") && !NOT_EXPORTED.includes(f) && !RECORD_FIELDS.includes(f)
    );
    expect(missing).toEqual([]);
  });

  it("declares no column the record does not build", () => {
    const record = buildRecord({ test: fullRun() });
    const extra = RECORD_FIELDS.filter((f) => !(f in record));
    expect(extra).toEqual([]);
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

describe("tsv export", () => {
  it("writes tab-separated fields in declared order", () => {
    const tsv = recordsToTsv([buildRecord({ test: fullRun() })]);
    const header = tsv.split("\n")[0].split("\t");
    expect(header).toEqual(RECORD_FIELDS);
  });

  it("replaces tabs and newlines inside field values with spaces", () => {
    const record = buildRecord({
      test: fullRun(),
      server: { name: "Vientiane\tnorth\r\nsub" }
    });
    const tsv = recordsToTsv([record]);
    const lines = tsv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Vientiane north  sub");
  });
});

