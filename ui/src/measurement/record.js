/*
  One measurement, one shape.

  Before this file a result existed in three different shapes that had already
  drifted apart: the reactive object in state/test.js, a seven-field entry in
  state/history.js, and a six-field FormData in speedtest_worker.js's telemetry
  post. Packet loss, the test id and the loaded-latency figures were in the
  first and in neither of the others - measured, shown once, then dropped.

  Everything that stores, exports or transmits a result now goes through
  buildRecord().

  ── FIELD NAMES AND UNITS ───────────────────────────────────────────────────

  Names come from the nPerf export the partner's report is built on
  (PGPS-141/BÁO CÁO TỔNG HỢP ĐO KIỂM.xlsb, sheet "1_DL nPert (thô)", 151
  columns). Using their names means the eventual Excel export is a projection
  rather than a translation layer, and it means anyone comparing our output to
  their existing data is comparing like with like.

  Units follow that export, verified against the file itself rather than
  assumed:

    speeds      kbit/s   (SPEED_*_AVG etc.)
    durations   ms
    latency     ms
    bytes       raw

  The verification, because it matters and is not obvious: for their upload
  rows, BYTES_TRANSFERRED × 8 ÷ (SPEED_UPLOAD_DURATION ÷ 1000) ÷ 1000 divided
  by SPEED_UPLOAD_AVG has a median of 0.993 across 394 Unitel samples. That
  only lands on 1.0 if AVG is kbit/s, DURATION is ms and BYTES is raw bytes
  simultaneously. The engine reports Mbit/s, so this file converts.

  ── ABSENT IS NOT ZERO ──────────────────────────────────────────────────────

  Anything not measured is null, never 0. A stored 0 for LOCATION_LAT is a
  coordinate in the Gulf of Guinea; a stored 0 for MOBILE_RSRP is an
  impossibly strong signal. Both would be averaged into a report as though
  they were readings. null survives JSON, is what SQL NULL maps to, and is
  skipped by every aggregate.

  The LOCATION_* and MOBILE_* groups are declared here and null for now: they
  are what the context layer (GPS, radio) will fill, and having the columns
  exist from the start means the storage, the sync payload and the export do
  not change shape when it lands.
*/

import { normaliseOperator } from "../context/operator.js";

/* Bumped when the shape changes in a way a reader has to know about. */
export const RECORD_VERSION = 1;

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function zeroOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/*
  For the fields where zero is a reading rather than an absence.

  numOrNull() above maps 0 to null, which is right for almost everything here:
  a 0 Mbps download did not happen, a 0ms latency is impossible, a 0 for
  MOBILE_RSRP would be an impossibly strong signal. All of those mean "no
  value".

  Loss is the exception, and it inverts the rule. "0.00% of 92 probes failed"
  is one of the more useful things a run can report, and turning it into an
  empty cell would throw away the good news while keeping the bad - every
  clean measurement would look unmeasured, and the only rows carrying a loss
  figure would be the ones with a problem. The count decides: if probes were
  sent, whatever they found is a result.
*/
function measuredOrNull(value, wasMeasured) {
  if (!wasMeasured) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/*
  For coordinates, where 0 is a real value rather than an absence.

  numOrNull() maps 0 to null, which is wrong here: latitude 0 is the equator, a
  place, not "unmeasured". So only null/undefined and non-finite input become
  null; a genuine 0 survives. It also keeps accuracy: null distinct from
  accuracy: 0, because the bridge reports no accuracy at all and a stored 0
  would read as a perfect fix.
*/
function finiteOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* Mbit/s as the engine reports it -> kbit/s as the report format wants it. */
function mbpsToKbps(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

function strOrNull(value) {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

/*
  Best-effort device identification from the user agent.

  Deliberately modest. A user agent is a self-reported string that lies often
  and is deprecated as a source of device data on both platforms, so what is
  pulled out here is only what is safe to read positionally, and every field
  falls back to null rather than to a guess. When the super-app bridge can
  answer this properly, this becomes the fallback rather than the source.
*/
export function parseUserAgent(ua) {
  const s = typeof ua === "string" ? ua : "";
  const out = {
    platform: null,
    osName: null,
    osVersion: null,
    brand: null,
    model: null
  };
  if (s === "") return out;

  const android = s.match(/Android\s+([\d.]+)/i);
  const ios = s.match(/(?:iPhone|iPad|iPod).*?OS\s+([\d_]+)/i);

  if (android) {
    out.platform = "android";
    out.osName = "android";
    out.osVersion = android[1];
    // Android puts "; <MODEL> Build/" or "; <MODEL>)" in the token list.
    const model = s.match(/;\s*([^;)]+?)\s*(?:Build\/[^;)]*)?\)/);
    if (model) {
      const value = model[1].trim();
      // Skip the locale token some builds place here instead of a model.
      if (value && !/^[a-z]{2}([-_][A-Za-z]{2})?$/.test(value)) {
        out.model = value;
        out.brand = value.split(/\s+/)[0];
      }
    }
  } else if (ios) {
    out.platform = "ios";
    out.osName = "ios";
    out.osVersion = ios[1].replace(/_/g, ".");
    out.brand = "Apple";
    const model = s.match(/(iPhone|iPad|iPod)/i);
    if (model) out.model = model[1];
  }
  return out;
}

/*
  ── ONLY THE BRIDGE MAY CLASSIFY THE NETWORK ────────────────────────────────

  Both functions below refuse to answer unless the value came from the
  super-app bridge (source === "bridge"), because the only other source,
  navigator.connection.effectiveType, cannot answer the question being asked.

  effectiveType is a round-trip-and-throughput bucket, not a radio type. It
  reports "4g" for a fast wifi link, for a desktop on fibre, and for real LTE
  alike, and it has no "5g" value at all. Classifying from it produced exactly
  the failure this guard exists to stop: a run on a desktop browser over
  ethernet was recorded as NET_TYPE "mobile", NET_CELL_GEN 3 - a fabricated row
  in the per-network breakdown the whole report is grouped by.

  So: no bridge, no classification. The raw string still travels in NET_NAME,
  where it reads as a hint rather than as a fact, and the row can be counted as
  unclassified instead of being counted as the wrong thing.
*/

/** Radio generation for NET_CELL_GEN, or null when it cannot be known. */
export function cellGeneration(connectionType, source) {
  if (source !== "bridge") return null;
  const value = String(connectionType || "").toUpperCase();
  if (value.includes("5G") || value === "NR") return 5;
  if (value.includes("4G") || value.includes("LTE")) return 4;
  if (value === "3G" || value === "HSPA" || value === "UMTS") return 3;
  if (value === "2G" || value === "EDGE" || value === "GPRS") return 2;
  return null;
}

/*
  Is this measurement of a mobile network at all?

  The specification asks for the quality of "Cellular 4G/5G". A run made over
  wifi measures the subscriber's own router, and averaging it into a
  per-province mobile figure is simply wrong. Recorded rather than blocked, so
  the row can be filtered out downstream and counted, rather than silently
  distorting an average.
*/
export function netType(connectionType, source) {
  const value = String(connectionType || "").toUpperCase();
  if (value === "") return null;
  // A wifi claim is safe to believe from either source: effectiveType never
  // says "wifi", so if the word is present something that actually knows put
  // it there.
  if (value.includes("WIFI") || value.includes("WLAN")) return "wifi";
  if (value.includes("ETHERNET")) return "ethernet";
  if (source !== "bridge") return null;
  return "mobile";
}

/**
 * Build one stored measurement.
 *
 * @param {object}  input
 * @param {object}  input.test        the reactive test state from state/test.js
 * @param {object}  input.server      the server object the run measured against
 * @param {string}  input.connection       connection type as the platform reports it
 * @param {string}  input.connectionSource "bridge" (trustworthy) or "effectiveType" (a guess)
 * @param {string}  input.isdn        subscriber number, when the super-app gave one
 * @param {string}  input.appVersion  build identifier
 * @param {object}  input.netStart    network snapshot taken before the run
 * @param {object}  input.netEnd      network snapshot taken after it
 * @param {object}  input.invalid     verdict from compareNetwork(), or null
 * @param {object}  input.location    {lat, lng, accuracy} from context/location.js, or null
 * @param {number}  input.startedAt   epoch ms when the run started
 * @param {number}  input.finishedAt  epoch ms when it ended
 * @returns {object} one record, nPerf field names, nulls for what was not measured
 */
export function buildRecord(input) {
  const t = input.test || {};
  const server = input.server || null;
  const device = parseUserAgent(
    typeof navigator === "undefined" ? "" : navigator.userAgent
  );
  const startedAt = input.startedAt || Date.now();
  const finishedAt = input.finishedAt || Date.now();
  const net = netType(input.connection, input.connectionSource);

  return {
    /* ── envelope, ours not nPerf's ──────────────────────────────────── */
    _v: RECORD_VERSION,
    _startedAt: new Date(startedAt).toISOString(),

    /* ── identity ───────────────────────────────────────────────────── */
    TEST_ID: strOrNull(t.testId),
    DATETIME_UTC: new Date(finishedAt).toISOString(),
    START_DATETIME_UTC: new Date(startedAt).toISOString(),
    TEST_TYPE: "speed",

    /* ── app and device ─────────────────────────────────────────────── */
    APP_PLATFORM: device.platform,
    APP_VERSION: strOrNull(input.appVersion),
    DEVICE_HWBRAND: device.brand,
    DEVICE_HWMODEL: device.model,
    OS_NAME: device.osName,
    OS_VERSION: device.osVersion,

    /* ── subscriber ─────────────────────────────────────────────────── */
    ISDN: strOrNull(input.isdn),

    /* ── network ────────────────────────────────────────────────────── */
    ISP: strOrNull(t.isp),
    MOBILE_ISP: strOrNull(t.isp),
    /*
      The raw ISP normalised to one of the three report carriers - the key the
      whole report is grouped by. Nulled on a wifi or ethernet run: there the AS
      name is the router's ISP, not the mobile carrier, and filing it as one
      would invent a carrier the run never measured. On an unknown network it is
      still resolved (best effort), because NET_TYPE null already marks the row
      as unverified. See context/operator.js.
    */
    MOBILE_OPERATOR:
      net === "wifi" || net === "ethernet"
        ? null
        : normaliseOperator(t.isp, t.ip, input.isdn || t.isdn),
    IPV4: strOrNull(t.ip),
    IPV6: null,
    NET_TYPE: net,
    NET_CELL_GEN: cellGeneration(input.connection, input.connectionSource),
    NET_NAME: strOrNull(input.connection),
    /* Kept so a null NET_TYPE can be told apart from "we never asked". */
    NET_SOURCE: strOrNull(input.connectionSource),
    /*
      The network at both ends of the run, and the verdict on whether it held.

      Their export carries START/END pairs for every radio field for the same
      reason: reading conditions once does not tell you what a thirty-second
      measurement measured. A run that fell from LTE to 3G halfway produces
      real numbers under the wrong label, so it is kept and marked rather than
      dropped - a row operations can exclude and still count beats one that
      silently never existed. See context/network.js.
    */
    NET_NAME_START: input.netStart ? strOrNull(input.netStart.type) : null,
    NET_NAME_END: input.netEnd ? strOrNull(input.netEnd.type) : null,
    MEASUREMENT_VALID: input.invalid ? false : true,
    MEASUREMENT_INVALID_REASON: input.invalid ? input.invalid.reason : null,

    /*
      ── location ──────────────────────────────────────────────────────
      Coordinates come from ui/src/context/location.js (the super-app bridge,
      falling back to navigator.geolocation). Accuracy is a number only from the
      web fallback; the bridge reports none, so it stays null rather than 0.

      Province, district and country are resolved from the coordinates by
      context/geo.js before they get here - this layer only writes down what it
      is handed. They are null whenever no boundary table is configured, which
      is the shipping default; see geo.js for why inventing one would be worse
      than leaving the column empty.

      FULL_ADDRESS stays null: a street address is not derivable from a boundary
      table, and nothing in the report is grouped by one.
    */
    LOCATION_LAT: input.location ? finiteOrNull(input.location.lat) : null,
    LOCATION_LNG: input.location ? finiteOrNull(input.location.lng) : null,
    LOCATION_ACCURACY: input.location ? finiteOrNull(input.location.accuracy) : null,
    LOCATION_COUNTRY: input.location ? strOrNull(input.location.country) : null,
    LOCATION_AAL1: input.location ? strOrNull(input.location.aal1) : null, // province
    LOCATION_AAL2: input.location ? strOrNull(input.location.aal2) : null, // district
    LOCATION_LOCALITY: input.location ? strOrNull(input.location.locality) : null, // locality / village
    LOCATION_FULL_ADDRESS: input.location ? strOrNull(input.location.fullAddress) : null,

    /*
      ── radio: not collected yet ──────────────────────────────────────
      Needs a native API the public WindVane documentation does not cover.
      START/END pairs because a run can change cell midway, and a record that
      reports only one of them cannot be told apart from one that did not move.
    */
    MOBILE_CELL_ID: null,
    MOBILE_TAC: null,
    MOBILE_PCI: null,
    MOBILE_RSSI_START: null,
    MOBILE_RSSI_END: null,
    MOBILE_RSRP_START: null,
    MOBILE_RSRP_END: null,
    MOBILE_RSRQ_START: null,
    MOBILE_RSRQ_END: null,
    MOBILE_RSSNR_START: null,
    MOBILE_RSSNR_END: null,

    /* ── test point ─────────────────────────────────────────────────── */
    SPEED_SERVER_POOL_NAME: server ? strOrNull(server.name || server.server) : null,
    SPEED_STATUS: t.aborted ? "ABORTED" : "OK",

    /* ── download ───────────────────────────────────────────────────── */
    SPEED_DOWNLOAD_AVG: mbpsToKbps(t.download),
    SPEED_DOWNLOAD_PEAK: mbpsToKbps(t.dlPeak),
    SPEED_DOWNLOAD_DURATION: numOrNull(t.dlDuration),
    SPEED_DOWNLOAD_CONNECTIONS: numOrNull(t.dlStreams),
    SPEED_DOWNLOAD_SLOWSTART_DURATION: numOrNull(t.dlSlowstart),
    SPEED_DOWNLOAD_AVG_INC_SLOWSTART: mbpsToKbps(t.dlAvgIncSlowstart),
    SPEED_DOWNLOAD_LOADED_LATENCY: numOrNull(t.dlPing),
    SPEED_DOWNLOAD_LOADED_JITTER: numOrNull(t.dlJitter),

    /* ── upload ─────────────────────────────────────────────────────── */
    SPEED_UPLOAD_AVG: mbpsToKbps(t.upload),
    SPEED_UPLOAD_PEAK: mbpsToKbps(t.ulPeak),
    SPEED_UPLOAD_DURATION: numOrNull(t.ulDuration),
    SPEED_UPLOAD_CONNECTIONS: numOrNull(t.ulStreams),
    SPEED_UPLOAD_SLOWSTART_DURATION: numOrNull(t.ulSlowstart),
    SPEED_UPLOAD_AVG_INC_SLOWSTART: mbpsToKbps(t.ulAvgIncSlowstart),
    SPEED_UPLOAD_LOADED_LATENCY: numOrNull(t.ulPing),
    SPEED_UPLOAD_LOADED_JITTER: numOrNull(t.ulJitter),

    BYTES_TRANSFERRED: (Number(t.dlBytes) || 0) + (Number(t.ulBytes) || 0) || null,

    /* ── latency ────────────────────────────────────────────────────── */
    SPEED_LATENCY_AVG: numOrNull(t.idlePingAvg),
    SPEED_LATENCY_MIN: numOrNull(t.ping),
    SPEED_LATENCY_JITTER: numOrNull(t.jitter),
    SPEED_LATENCY_SAMPLES: numOrNull(t.pingSamples),

    /*
      ── probe loss, and why their packet-loss column stays empty ──────

      SPEED_DOWNLOAD_PACKETLOSS is deliberately null. We do not measure packet
      loss and must not appear to.

      What we do measure is PROBE_LOSS_PCT: the share of latency probes that
      failed or exceeded their timeout. That is an HTTP-level figure. TCP
      retransmits underneath it, so a link genuinely dropping several percent
      of packets usually still completes every probe and reads 0.00 here. A
      high value is strong evidence of a problem; a zero is not evidence of a
      clean link.

      Writing that number into their packet-loss column would be the worst
      version of this: their pipeline would read it as an IP loss counter,
      average it per province, and report 0% at exactly the cells that are
      failing - a wrong number is harder to catch than a missing one, because
      nothing about it looks unanswered.

      So the column stays empty until something actually measures loss below
      HTTP - an ICMP/UDP probe from inside the network, or a native API. That
      gap is then visible in the export instead of being papered over.

      PROBE_SAMPLES travels alongside so nobody reads a 0.00 drawn from forty
      probes as a guarantee.
    */
    SPEED_DOWNLOAD_PACKETLOSS: null,
    PROBE_LOSS_PCT: measuredOrNull(t.probeLoss, Number(t.probeCount) > 0),
    PROBE_SAMPLES: numOrNull(t.probeCount),

    /*
      ── web access ────────────────────────────────────────────────────
      Their column is BROWSE_URL_WEIGHT and the pass rule is that it reached
      500 KB inside the 4s budget - NOT that the page finished, which only 16%
      of their own samples did. BROWSE_TIME is capped at the budget, matching
      the cap in every row of their export. See measurement/kpi.js.

      Measured against a resource we can read, not against tiktok or facebook:
      reading bytes cross-origin needs CORS and none of the sites they use send
      it. Same indicator, different source - a report comparing the two must
      say so. See browseTest() in speedtest_worker.js.
    */
    BROWSE_STATUS: strOrNull(t.browseStatus),
    BROWSE_TIME: numOrNull(t.browseTime),
    BROWSE_BYTES: measuredOrNull(t.browseBytes, !!t.browseStatus && t.browseStatus !== "Skip"),

    /*
      ── video ─────────────────────────────────────────────────────────
      PRELOADING_TIME <= 4000ms and REBUFFERING_TIME === 0 are the two video
      indicators. Rebuffering of 0 is a reading, not an absence - it is the
      pass condition - so it goes through measuredOrNull.
    */
    STREAM_STATUS: strOrNull(t.videoStatus),
    STREAM_PRELOADING_TIME: numOrNull(t.videoTimeToPlay),
    STREAM_REBUFFERING_TIME: measuredOrNull(
      t.videoRebuffering,
      !!t.videoStatus && t.videoStatus !== "Skip" && Number(t.videoTimeToPlay) > 0
    ),
    STREAM_REBUFFER_COUNT: measuredOrNull(
      t.videoRebufferCount,
      !!t.videoStatus && t.videoStatus !== "Skip" && Number(t.videoTimeToPlay) > 0
    ),
    STREAM_QUALITY_TOTAL_TIME: numOrNull(t.videoTotal),
    STREAM_QUALITY: numOrNull(t.videoQuality),

    /* ── connection setup ───────────────────────────────────────────── */
    SETUP_DNS: numOrNull(t.dns),
    SETUP_TCP: numOrNull(t.tcp),
    SETUP_TLS: numOrNull(t.tls),
    SETUP_TTFB: numOrNull(t.ttfb),

    /* ── Network Quality of Experience (QoE) ────────────────────────── */
    QOE_OVERALL_SCORE: t.qoeResult ? zeroOrNull(t.qoeResult.overallScore) : null,
    QOE_OVERALL_GRADE: t.qoeResult ? strOrNull(t.qoeResult.overallGrade) : null,
    QOE_DOWNLOAD_SCORE: t.qoeResult ? zeroOrNull(t.qoeResult.downloadScore) : null,
    QOE_UPLOAD_SCORE: t.qoeResult ? zeroOrNull(t.qoeResult.uploadScore) : null,
    QOE_LATENCY_SCORE: t.qoeResult ? zeroOrNull(t.qoeResult.latencyScore) : null,
    QOE_BROWSING_SCORE: t.qoeResult ? zeroOrNull(t.qoeResult.browsingScore) : null,
    QOE_STREAMING_SCORE: t.qoeResult ? zeroOrNull(t.qoeResult.streamingScore) : null,

    /* ── Web Browsing Extended QoE ──────────────────────────────────── */
    BROWSING_SCORE: t.browsingResult ? zeroOrNull(t.browsingResult.score) : null,
    BROWSING_GRADE: t.browsingResult ? strOrNull(t.browsingResult.grade) : null,
    BROWSING_AVG_LOAD_TIME: t.browsingResult ? zeroOrNull(t.browsingResult.averageLoadTime) : zeroOrNull(t.browseTime),
    BROWSING_SUCCESS_RATE: t.browsingResult ? zeroOrNull(t.browsingResult.successRate) : null,
    BROWSING_SITES_COUNT: t.browsingResult ? zeroOrNull(t.browsingResult.totalSites) : null,

    /* ── Video Streaming Extended QoE ───────────────────────────────── */
    STREAMING_SCORE: t.streamingResult ? zeroOrNull(t.streamingResult.score) : null,
    STREAMING_GRADE: t.streamingResult ? strOrNull(t.streamingResult.grade) : null,
    STREAMING_STARTUP_TIME: t.streamingResult ? zeroOrNull(t.streamingResult.startupTimeMs) : zeroOrNull(t.videoTimeToPlay),
    STREAMING_BUFFERING_COUNT: t.streamingResult ? zeroOrNull(t.streamingResult.bufferingCount) : zeroOrNull(t.videoRebufferCount),
    STREAMING_BUFFERING_DURATION: t.streamingResult ? zeroOrNull(t.streamingResult.bufferingDurationMs) : zeroOrNull(t.videoRebuffering),
    STREAMING_REBUFFERING_RATIO: t.streamingResult ? zeroOrNull(t.streamingResult.rebufferingRatio) : null,
    STREAMING_THROUGHPUT_MBPS: t.streamingResult ? zeroOrNull(t.streamingResult.throughputMbps) : null,
    STREAMING_HIGHEST_QUALITY: t.streamingResult ? strOrNull(t.streamingResult.highestStableQuality) : (t.videoQuality ? `${t.videoQuality}p` : null),
    /*
      The two numbers the per-tier table on screen is built from, averaged and
      summed across the tiers that played. Null rather than 0 when nothing
      played, or when no byte source on this device could count - see
      BYTES_SOURCE in measurement/streaming.js.
    */
    STREAMING_PERFORMANCE_RATE: t.streamingResult ? numOrNull(t.streamingResult.performanceRate) : null,
    STREAMING_DATA_USED_BYTES: t.streamingResult ? numOrNull(t.streamingResult.bytesUsed) : null
  };
}

/*
  Column order for the CSV export. Explicit rather than Object.keys(), so
  adding a field cannot silently reorder a file someone has a parser for.
*/
export const RECORD_FIELDS = [
  "TEST_ID",
  "DATETIME_UTC",
  "START_DATETIME_UTC",
  "TEST_TYPE",
  "APP_PLATFORM",
  "APP_VERSION",
  "DEVICE_HWBRAND",
  "DEVICE_HWMODEL",
  "OS_NAME",
  "OS_VERSION",
  "ISDN",
  "ISP",
  "MOBILE_ISP",
  "MOBILE_OPERATOR",
  "IPV4",
  "NET_TYPE",
  "NET_CELL_GEN",
  "NET_NAME",
  "NET_SOURCE",
  "NET_NAME_START",
  "NET_NAME_END",
  "MEASUREMENT_VALID",
  "MEASUREMENT_INVALID_REASON",
  "LOCATION_LAT",
  "LOCATION_LNG",
  "LOCATION_ACCURACY",
  "LOCATION_COUNTRY",
  "LOCATION_AAL1",
  "LOCATION_AAL2",
  "LOCATION_LOCALITY",
  "LOCATION_FULL_ADDRESS",
  "MOBILE_CELL_ID",
  "MOBILE_TAC",
  "MOBILE_PCI",
  "MOBILE_RSSI_START",
  "MOBILE_RSSI_END",
  "MOBILE_RSRP_START",
  "MOBILE_RSRP_END",
  "MOBILE_RSRQ_START",
  "MOBILE_RSRQ_END",
  "MOBILE_RSSNR_START",
  "MOBILE_RSSNR_END",
  "SPEED_SERVER_POOL_NAME",
  "SPEED_STATUS",
  "SPEED_DOWNLOAD_AVG",
  "SPEED_DOWNLOAD_PEAK",
  "SPEED_DOWNLOAD_DURATION",
  "SPEED_DOWNLOAD_CONNECTIONS",
  "SPEED_DOWNLOAD_SLOWSTART_DURATION",
  "SPEED_DOWNLOAD_AVG_INC_SLOWSTART",
  "SPEED_DOWNLOAD_LOADED_LATENCY",
  "SPEED_DOWNLOAD_LOADED_JITTER",
  "SPEED_UPLOAD_AVG",
  "SPEED_UPLOAD_PEAK",
  "SPEED_UPLOAD_DURATION",
  "SPEED_UPLOAD_CONNECTIONS",
  "SPEED_UPLOAD_SLOWSTART_DURATION",
  "SPEED_UPLOAD_AVG_INC_SLOWSTART",
  "SPEED_UPLOAD_LOADED_LATENCY",
  "SPEED_UPLOAD_LOADED_JITTER",
  "BYTES_TRANSFERRED",
  "SPEED_LATENCY_AVG",
  "SPEED_LATENCY_MIN",
  "SPEED_LATENCY_JITTER",
  "SPEED_LATENCY_SAMPLES",
  "SPEED_DOWNLOAD_PACKETLOSS",
  "PROBE_LOSS_PCT",
  "PROBE_SAMPLES",
  "BROWSE_STATUS",
  "BROWSE_TIME",
  "BROWSE_BYTES",
  "STREAM_STATUS",
  "STREAM_PRELOADING_TIME",
  "STREAM_REBUFFERING_TIME",
  "STREAM_REBUFFER_COUNT",
  "STREAM_QUALITY_TOTAL_TIME",
  "STREAM_QUALITY",
  "SETUP_DNS",
  "SETUP_TCP",
  "SETUP_TLS",
  "SETUP_TTFB",
  "QOE_OVERALL_SCORE",
  "QOE_OVERALL_GRADE",
  "QOE_DOWNLOAD_SCORE",
  "QOE_UPLOAD_SCORE",
  "QOE_LATENCY_SCORE",
  "QOE_BROWSING_SCORE",
  "QOE_STREAMING_SCORE",
  "BROWSING_SCORE",
  "BROWSING_GRADE",
  "BROWSING_AVG_LOAD_TIME",
  "BROWSING_SUCCESS_RATE",
  "BROWSING_SITES_COUNT",
  "STREAMING_SCORE",
  "STREAMING_GRADE",
  "STREAMING_STARTUP_TIME",
  "STREAMING_BUFFERING_COUNT",
  "STREAMING_BUFFERING_DURATION",
  "STREAMING_REBUFFERING_RATIO",
  "STREAMING_THROUGHPUT_MBPS",
  "STREAMING_HIGHEST_QUALITY"
];

function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Records to CSV, in RECORD_FIELDS order.
 *
 * A null becomes an empty cell, not "0" and not "null" - the same
 * absent-is-not-zero rule the records themselves follow, carried into the file
 * that operations will open in Excel.
 */
export function recordsToCsv(records) {
  const rows = [RECORD_FIELDS.join(",")];
  for (const record of records || []) {
    rows.push(RECORD_FIELDS.map((field) => csvField(record[field])).join(","));
  }
  return rows.join("\n");
}

function tsvField(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\t\n\r]/g, " ");
}

/**
 * Records to TSV (Tab-Separated Values), in RECORD_FIELDS order.
 *
 * Pasting TSV into Microsoft Excel, Google Sheets, or WPS Office cleanly
 * distributes values into individual columns and cells without delimiter ambiguity.
 */
export function recordsToTsv(records) {
  const rows = [RECORD_FIELDS.join("\t")];
  for (const record of records || []) {
    rows.push(RECORD_FIELDS.map((field) => tsvField(record ? record[field] : null)).join("\t"));
  }
  return rows.join("\n");
}

