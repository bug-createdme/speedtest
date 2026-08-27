import { describe, expect, it } from "vitest";

import {
  BROWSE_BUDGET_MS,
  BROWSE_MIN_BYTES,
  DOWNLOAD_MIN_KBPS,
  UPLOAD_MIN_KBPS,
  VIDEO_MAX_TIME_TO_PLAY_MS,
  excludedReason,
  samplePasses,
  summarise
} from "../../ui/src/measurement/kpi.js";

/*
  The partner's grading rules. Every number here is traceable to
  PGPS-141/BÁO CÁO TỔNG HỢP ĐO KIỂM.xlsb; the boundary cases are pinned
  because an off-by-one at the threshold moves a whole province between
  "đạt" and "Ko đạt".
*/

function sample(overrides) {
  return Object.assign(
    {
      SPEED_DOWNLOAD_AVG: 20_000,
      SPEED_UPLOAD_AVG: 4_000,
      MEASUREMENT_VALID: true,
      NET_TYPE: "mobile"
    },
    overrides
  );
}

describe("thresholds", () => {
  /*
    Guards the interpretation, not just the code. The report header prints
    "≥4,27MBps"; read as MB/s that would be 34 Mbit/s, eight times this. Their
    own conversion table (sheet TC) gives 520 KB = 4,259,840 bit, and the raw
    data sheet has a column headed "KPIS (>3Mbps)" - both point at Mbit/s. If
    the partner answers REQ-002 the other way, this test is the thing that
    fails and says so.
  */
  it("reads the download threshold as 4.26 Mbit/s, not 4.27 MB/s", () => {
    expect(DOWNLOAD_MIN_KBPS).toBe(4260);
    expect(DOWNLOAD_MIN_KBPS).toBeLessThan(34_000);
  });

  it("reads the upload threshold as 520 kbit/s", () => {
    expect(UPLOAD_MIN_KBPS).toBe(520);
  });
});

describe("one sample", () => {
  it("passes exactly at the threshold", () => {
    expect(samplePasses(sample({ SPEED_DOWNLOAD_AVG: 4260 }), "download")).toBe(true);
    expect(samplePasses(sample({ SPEED_UPLOAD_AVG: 520 }), "upload")).toBe(true);
  });

  it("fails one unit below it", () => {
    expect(samplePasses(sample({ SPEED_DOWNLOAD_AVG: 4259 }), "download")).toBe(false);
    expect(samplePasses(sample({ SPEED_UPLOAD_AVG: 519 }), "upload")).toBe(false);
  });

  /*
    null and false are different answers: false is "measured and fell short",
    null is "no figure to judge". Collapsing them would count every unmeasured
    sample as a failure.
  */
  it("returns null, not false, when there is no figure", () => {
    expect(samplePasses(sample({ SPEED_DOWNLOAD_AVG: null }), "download")).toBeNull();
    expect(samplePasses(sample(), "web")).toBeNull();
    expect(samplePasses(sample(), "videoPlay")).toBeNull();
  });
});

describe("what counts", () => {
  it("excludes a run interrupted by a network change", () => {
    const record = sample({
      MEASUREMENT_VALID: false,
      MEASUREMENT_INVALID_REASON: "network-changed"
    });
    expect(excludedReason(record)).toBe("network-changed");
  });

  /* The specification asks for "Cellular 4G/5G"; a wifi run measured
     someone's own router. */
  it("excludes wifi and ethernet", () => {
    expect(excludedReason(sample({ NET_TYPE: "wifi" }))).toBe("not-mobile");
    expect(excludedReason(sample({ NET_TYPE: "ethernet" }))).toBe("not-mobile");
  });

  /*
    Unknown is included on purpose. Outside the super-app nothing can classify
    the connection, so excluding unknowns would throw away most measurements
    to avoid a smaller error.
  */
  it("includes a run whose network type could not be determined", () => {
    expect(excludedReason(sample({ NET_TYPE: null }))).toBeNull();
  });
});

describe("summary", () => {
  const passing = () => sample({ SPEED_DOWNLOAD_AVG: 20_000, SPEED_UPLOAD_AVG: 4_000 });
  const failing = () => sample({ SPEED_DOWNLOAD_AVG: 1_000, SPEED_UPLOAD_AVG: 100 });

  it("counts, rates and grades against the ordinary-day bar", () => {
    const records = [passing(), passing(), passing(), passing(), passing(), failing()];
    const result = summarise(records);
    expect(result.metrics.download.measured).toBe(6);
    expect(result.metrics.download.passed).toBe(5);
    expect(result.metrics.download.rate).toBeCloseTo(5 / 6);
    expect(result.metrics.download.threshold).toBe(0.9);
    // 83.3% is below the 90% bar for an ordinary day.
    expect(result.metrics.download.verdict).toBe(false);
  });

  it("grades the same samples against the lower event-day bar", () => {
    const records = [passing(), passing(), passing(), passing(), passing(), failing()];
    const result = summarise(records, { eventDay: true });
    expect(result.metrics.download.threshold).toBe(0.8);
    // 83.3% clears the 80% bar for an event day.
    expect(result.metrics.download.verdict).toBe(true);
  });

  it("passes at exactly the pass rate", () => {
    const records = [passing(), passing(), passing(), passing(), passing(), passing(), passing(), passing(), passing(), failing()];
    const result = summarise(records);
    expect(result.metrics.download.rate).toBe(0.9);
    expect(result.metrics.download.verdict).toBe(true);
  });

  it("grades video time-to-play at 95%, not 90%", () => {
    const result = summarise([passing()]);
    expect(result.metrics.videoPlay.threshold).toBe(0.95);
    expect(result.metrics.videoFreeze.threshold).toBe(0.9);
  });

  /*
    0 of 0 is an absence, not a failure. Reporting it as 0% would print
    "Ko đạt" for a network nobody measured.
  */
  it("reports an unmeasured indicator as null rather than 0%", () => {
    /* The sample carries speeds only - no browse or stream figures - so web
       is implemented but has nothing to judge on this run. */
    const result = summarise([passing()]);
    expect(result.metrics.web.implemented).toBe(true);
    expect(result.metrics.web.measured).toBe(0);
    expect(result.metrics.web.rate).toBeNull();
    expect(result.metrics.web.verdict).toBeNull();
  });

  it("keeps excluded records out of the rate and still counts them", () => {
    const result = summarise([
      passing(),
      sample({ NET_TYPE: "wifi", SPEED_DOWNLOAD_AVG: 1 }),
      sample({ MEASUREMENT_VALID: false, MEASUREMENT_INVALID_REASON: "went-offline" })
    ]);
    expect(result.metrics.download.measured).toBe(1);
    expect(result.metrics.download.verdict).toBe(true);
    expect(result.excluded).toEqual({ "not-mobile": 1, "went-offline": 1 });
  });

  it("reports the average speed the report prints beside the rate", () => {
    const result = summarise([
      sample({ SPEED_DOWNLOAD_AVG: 10_000 }),
      sample({ SPEED_DOWNLOAD_AVG: 20_000 })
    ]);
    expect(result.metrics.download.averageKbps).toBe(15_000);
  });

  it("survives an empty set", () => {
    const result = summarise([]);
    expect(result.metrics.download.measured).toBe(0);
    expect(result.metrics.download.verdict).toBeNull();
  });
});

/*
  Web and video. Every threshold below was recovered from the partner's own
  25,210-row export and checked against the percentages their report prints,
  not read off a header - see the note at the top of kpi.js.
*/
describe("web access", () => {
  const web = (bytes, status) => ({
    BROWSE_BYTES: bytes,
    BROWSE_STATUS: status || "Timeout",
    MEASUREMENT_VALID: true,
    NET_TYPE: "mobile"
  });

  it("uses 500,000 bytes as the bar", () => {
    expect(BROWSE_MIN_BYTES).toBe(500_000);
    expect(BROWSE_BUDGET_MS).toBe(4000);
  });

  it("passes at exactly 500 KB and fails one byte short", () => {
    expect(samplePasses(web(500_000), "web")).toBe(true);
    expect(samplePasses(web(499_999), "web")).toBe(false);
  });

  /*
    The rule that reproduces their reported 82.8%. Judging on status instead
    gives 16% - a page that did not finish inside the budget still passes if
    half a megabyte arrived.
  */
  it("passes a page that timed out but moved 500 KB", () => {
    expect(samplePasses(web(1_050_000, "Timeout"), "web")).toBe(true);
  });

  /* A broken URL is a failed measurement, not a slow network. */
  it("declines to judge an errored or skipped load", () => {
    expect(samplePasses(web(0, "Error"), "web")).toBeNull();
    expect(samplePasses(web(0, "Skip"), "web")).toBeNull();
  });
});

describe("video", () => {
  const vid = (play, rebuf, status) => ({
    STREAM_PRELOADING_TIME: play,
    STREAM_REBUFFERING_TIME: rebuf,
    STREAM_STATUS: status || "OK",
    MEASUREMENT_VALID: true,
    NET_TYPE: "mobile"
  });

  it("passes time-to-play at exactly 4s and fails past it", () => {
    expect(VIDEO_MAX_TIME_TO_PLAY_MS).toBe(4000);
    expect(samplePasses(vid(4000, 0), "videoPlay")).toBe(true);
    expect(samplePasses(vid(4001, 0), "videoPlay")).toBe(false);
  });

  /* "không bị dừng hình" admits no tolerance: one millisecond of freezing
     fails the indicator. */
  it("fails the freeze indicator on any rebuffering at all", () => {
    expect(samplePasses(vid(1000, 0), "videoFreeze")).toBe(true);
    expect(samplePasses(vid(1000, 1), "videoFreeze")).toBe(false);
  });

  /*
    A video that never started is a verdict on the link; a video that errored
    is a failed measurement. They must not be counted the same way.
  */
  it("judges a timeout but not an error", () => {
    expect(samplePasses(vid(9000, 0, "Timeout"), "videoPlay")).toBe(false);
    expect(samplePasses(vid(0, 0, "Error"), "videoPlay")).toBeNull();
    expect(samplePasses(vid(0, 0, "Skip"), "videoFreeze")).toBeNull();
  });

  it("counts all five indicators once web and video are measured", () => {
    const record = {
      SPEED_DOWNLOAD_AVG: 20_000,
      SPEED_UPLOAD_AVG: 4_000,
      BROWSE_BYTES: 900_000,
      BROWSE_STATUS: "Timeout",
      STREAM_PRELOADING_TIME: 1200,
      STREAM_REBUFFERING_TIME: 0,
      STREAM_STATUS: "OK",
      MEASUREMENT_VALID: true,
      NET_TYPE: "mobile"
    };
    const result = summarise([record]);
    for (const name of ["web", "videoPlay", "videoFreeze", "download", "upload"]) {
      expect(result.metrics[name].measured, name).toBe(1);
      expect(result.metrics[name].verdict, name).toBe(true);
    }
  });
});
