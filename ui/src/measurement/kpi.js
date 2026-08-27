/*
  The partner's pass/fail rules, in code.

  Until now these thresholds existed only in a spreadsheet and in an analysis
  document. That is the shape of rule that gets re-derived slightly differently
  by whoever needs it next, so it lives here instead: one place, one set of
  numbers, covered by tests that pin the boundaries.

  ── WHERE THE NUMBERS COME FROM ─────────────────────────────────────────────

  PGPS-141/BÁO CÁO TỔNG HỢP ĐO KIỂM.xlsb:
    sheet "KPI"                  the nine indicators and their pass rates
    sheet "2_KQ BÁO CÁO THƯỜNG"  the report layout and the per-sample thresholds
    sheet "TC"                   the unit conversion table

  Two columns of pass rate, because the partner grades ordinary days and event
  days ("LHSK", lễ hội sự kiện) differently - an event day is when the network
  is under crowd load and the bar is lower.

  ── ⚠ ONE NUMBER IS NOT CONFIRMED ───────────────────────────────────────────

  The report header writes the download threshold as "≥4,27MBps". MBps means
  megaBYTES per second, which would be 34 Mbit/s - eight times what is
  implemented below.

  It is read as 4.26 Mbit/s here on the evidence of their own conversion table:
  sheet "TC" gives 520 KB = 532,480 B = 4,259,840 bit, and 4,259,840 bit/s is
  4.26 Mbit/s, which rounds to the "4,27" printed in the header. The raw data
  sheet also carries a column literally headed "KPIS (>3Mbps)". Both point at
  Mbit/s and neither points at MB/s.

  This is still an interpretation of an ambiguous document, and it is worth
  eight times the answer, so it is written as one named constant with this note
  attached rather than sprinkled through a calculation. REQ-002 in the gap
  assessment asks the partner to confirm it. If they say MB/s, change
  DOWNLOAD_MIN_KBPS and the tests will tell you what else moved.

  ── WHAT IS NOT HERE ────────────────────────────────────────────────────────

  Four of the nine indicators - three voice, one livestream - cannot be
  measured from a WebView at all and are out of scope for this app (REQ-004).
  The other five are all implemented: download, upload, web, and the two video
  indicators.
*/

/** Per-sample pass thresholds. A sample at exactly the threshold PASSES. */
export const DOWNLOAD_MIN_KBPS = 4260; // see the warning above before changing
export const UPLOAD_MIN_KBPS = 520;

/*
  ── WEB AND VIDEO, RECOVERED FROM THEIR OWN DATA ────────────────────────────

  These three were not obvious from the report headers, so they were derived
  from the 25,210-row nPerf export and checked against the percentages the
  report prints for Unitel.

  WEB. The header says "Time to download first 500KB ≤4s". The obvious reading
  - a sample passes when BROWSE_URL_STATUS is "OK" - is wrong: only 16.0% of
  their Unitel browse samples are OK, while the report claims 82.8%. The rule
  that reproduces the number is the weight: BROWSE_URL_WEIGHT >= 500,000 bytes
  gives 82.1%, within 0.7 points of the report.

  What that means in practice: their loading time is CAPPED at the 4s budget
  (median and max are both exactly 4000ms), so most page loads are marked
  Timeout because the whole page did not finish - and still pass, because half
  a megabyte arrived inside the window. The indicator is "did the connection
  move 500 KB of real web content in four seconds", not "did the page finish".

  Decimal 500,000 rather than binary 512,000: both are close, and the decimal
  reading lands nearer the printed figure (82.1% vs 81.7%).

  VIDEO. PRELOADING_TIME <= 4000ms for time-to-play, REBUFFERING_TIME === 0 for
  the no-freeze indicator - the wording is "không bị dừng hình", which admits
  no tolerance.

  ⚠ The video DENOMINATOR is not settled. Counting every sample gives 77.1% /
  75.1%; counting only STREAM_QUALITY_STATUS "OK" gives 99.1% / 97.6%; the
  report prints 81.3% / 79.1%, between the two. So their exclusion rule is
  neither "all" nor "successful only" and cannot be recovered from the file.
  The reading implemented in excludedReason() is stated there. This is REQ-006
  in the gap assessment and it moves a reported rate by several points.
*/
export const BROWSE_MIN_BYTES = 500_000;
export const BROWSE_BUDGET_MS = 4000;
export const VIDEO_MAX_TIME_TO_PLAY_MS = 4000;

/** Share of samples that must pass for the location to be rated "đạt". */
export const PASS_RATE = {
  normal: 0.9,
  event: 0.8
};

/*
  Video's time-to-play indicator is graded higher than everything else - 95%
  on an ordinary day rather than 90%. Kept as a per-metric override rather
  than folded into PASS_RATE, so the exception stays visible.
*/
export const METRICS = {
  web: { key: "web", implemented: true, rate: { normal: 0.9, event: 0.8 } },
  videoPlay: { key: "videoPlay", implemented: true, rate: { normal: 0.95, event: 0.9 } },
  videoFreeze: { key: "videoFreeze", implemented: true, rate: { normal: 0.9, event: 0.8 } },
  download: { key: "download", implemented: true, rate: PASS_RATE },
  upload: { key: "upload", implemented: true, rate: PASS_RATE }
};

/**
 * Should this record count towards a KPI at all?
 *
 * Two exclusions, both of which would otherwise quietly distort an average:
 *
 * - a run flagged by the network check produced real numbers under the wrong
 *   label (see context/network.js)
 * - a run over wifi or ethernet measured someone's own router, and the
 *   specification asks for "Cellular 4G/5G"
 *
 * A record whose network type is unknown is NOT excluded. Refusing those would
 * drop every measurement taken outside the super-app, where nothing can
 * classify the connection - which today is most of them.
 *
 * @returns {null|string} the reason it was excluded, or null to include it
 */
export function excludedReason(record) {
  if (!record) return "empty";
  if (record.MEASUREMENT_VALID === false) {
    return record.MEASUREMENT_INVALID_REASON || "invalid";
  }
  if (record.NET_TYPE === "wifi" || record.NET_TYPE === "ethernet") {
    return "not-mobile";
  }
  return null;
}

/**
 * Does one sample pass one speed indicator?
 *
 * @returns {null|boolean} null when the record carries no figure to judge -
 *          distinct from false, which means it was measured and fell short
 */
export function samplePasses(record, metric) {
  if (!record) return null;
  if (metric === "download") {
    const value = record.SPEED_DOWNLOAD_AVG;
    return typeof value === "number" ? value >= DOWNLOAD_MIN_KBPS : null;
  }
  if (metric === "upload") {
    const value = record.SPEED_UPLOAD_AVG;
    return typeof value === "number" ? value >= UPLOAD_MIN_KBPS : null;
  }
  if (metric === "web") {
    /*
      A page load that errored outright is not a verdict on the network - it is
      a failed measurement, and counting it as a slow connection would blame
      the link for a broken URL. Timeout IS a verdict: the budget ran out.
    */
    if (record.BROWSE_STATUS === "Error" || record.BROWSE_STATUS === "Skip") return null;
    const value = record.BROWSE_BYTES;
    return typeof value === "number" ? value >= BROWSE_MIN_BYTES : null;
  }
  if (metric === "videoPlay") {
    if (record.STREAM_STATUS === "Error" || record.STREAM_STATUS === "Skip") return null;
    const value = record.STREAM_PRELOADING_TIME;
    if (typeof value !== "number") return null;
    return value <= VIDEO_MAX_TIME_TO_PLAY_MS;
  }
  if (metric === "videoFreeze") {
    if (record.STREAM_STATUS === "Error" || record.STREAM_STATUS === "Skip") return null;
    const value = record.STREAM_REBUFFERING_TIME;
    if (typeof value !== "number") return null;
    // "không bị dừng hình" admits no tolerance.
    return value === 0;
  }
  return null;
}

function mean(values) {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Summarise a set of records the way the report's rows are laid out:
 * measured / passed / rate / verdict, per indicator.
 *
 * @param {object[]} records
 * @param {object}   [options]
 * @param {boolean}  [options.eventDay] grade against the LHSK column
 * @returns {object} one entry per metric, plus the excluded tally
 */
export function summarise(records, options) {
  const eventDay = !!(options && options.eventDay);
  const band = eventDay ? "event" : "normal";

  const excluded = {};
  const included = [];
  for (const record of records || []) {
    const reason = excludedReason(record);
    if (reason) {
      excluded[reason] = (excluded[reason] || 0) + 1;
      continue;
    }
    included.push(record);
  }

  const result = { eventDay, excluded, metrics: {} };

  for (const name of Object.keys(METRICS)) {
    const metric = METRICS[name];
    let measured = 0;
    let passed = 0;
    for (const record of included) {
      const verdict = samplePasses(record, name);
      if (verdict === null) continue;
      measured++;
      if (verdict) passed++;
    }
    /*
      A rate of 0 out of 0 samples is not a failure, it is an absence. Reported
      as null so a report prints "not measured" rather than "0% - Ko đạt",
      which would read as a network that failed everywhere.
    */
    const rate = measured > 0 ? passed / measured : null;
    result.metrics[name] = {
      implemented: metric.implemented,
      measured,
      passed,
      rate,
      threshold: metric.rate[band],
      verdict: rate === null ? null : rate >= metric.rate[band]
    };
  }

  /* The report prints an average speed alongside the pass rate. */
  result.metrics.download.averageKbps = mean(
    included.map((r) => r.SPEED_DOWNLOAD_AVG).filter((v) => typeof v === "number")
  );
  result.metrics.upload.averageKbps = mean(
    included.map((r) => r.SPEED_UPLOAD_AVG).filter((v) => typeof v === "number")
  );

  return result;
}
