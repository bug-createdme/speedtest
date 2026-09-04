<script setup>
import { computed, ref } from "vue";
import MetricCard from "../components/MetricCard.vue";
import SparkLine from "../components/SparkLine.vue";
import { test } from "../state/test.js";
import { formatBytes } from "../measurement/streaming.js";
import { SCREEN, connectionType, goTo } from "../state/ui.js";
import { shareSummary, summaryText } from "../report/share.js";
import { useI18n } from "../i18n/index.js";

defineEmits(["again"]);
const { t } = useI18n();

/*
  Share the run as text, which is what the super-app bridge can actually carry
  (see report/share.js - neither of its share methods takes a file).

  The result ID is the point of it: the screen already tells the user to quote
  it to network operations, and until now the only way to do that was to copy it
  off the screen by hand.
*/
const shareState = ref("");

async function share() {
  shareState.value = "";
  const how = await shareSummary(
    summaryText({
      testId: test.testId,
      download: test.download,
      upload: test.upload,
      ping: test.ping,
      qoeScore: test.qoeResult?.overallScore,
      qoeGrade: test.qoeResult?.overallGrade,
      browsingScore: test.qoeResult?.browsingScore,
      streamingScore: test.qoeResult?.streamingScore,
      server: test.usedServer ? test.usedServer.name || test.usedServer.server : "",
      operator: test.isp,
      place: test.location ? test.location.aal1 : "",
      at: new Date().toISOString()
    })
  );
  /* Only the clipboard needs saying: a share sheet is its own feedback, and
     announcing "shared" over the top of one is noise. */
  if (how === "clipboard") shareState.value = t("share.copied");
  else if (how === "none") shareState.value = t("share.blocked");
}

function fmt(value, decimals) {
  return Number(value || 0).toFixed(decimals);
}

/*
  Connection-setup timings are routinely sub-millisecond against a nearby
  server, and rounding those to a whole number prints "0 ms" - which reads as
  "not measured", right next to rows that were dropped for being exactly that.
  One decimal below 10ms keeps a real reading distinguishable from a missing one.
*/
function fmtTiming(value) {
  const v = Number(value || 0);
  return v < 10 ? v.toFixed(1) : v.toFixed(0);
}

/*
  Same digit budget as the gauge: hundredths below 10 Mbps, tenths up to a
  gigabit, whole numbers above it. A four-digit number with a decimal is what
  broke the old readout's layout, and the tenth of a Mbps it bought was never
  a real difference at that speed.
*/
function fmtSpeed(value) {
  const v = Number(value || 0);
  if (!(v > 0)) return "0.00";
  if (v < 10) return v.toFixed(2);
  if (v < 1000) return v.toFixed(1);
  return v.toFixed(0);
}

/* usedServer, not selectedServer: see state/test.js - Start may fire before
   server selection has settled, and the result must name the server the
   numbers actually came from. */
const serverName = computed(() => {
  const s = test.usedServer || test.selectedServer;
  return s ? s.name || s.server : t("server.unknown");
});

/*
  Connection setup breakdown, added by Phase 4 item 7. Only rendered when the
  numbers are actually there: cross-origin they need Timing-Allow-Origin from
  the backend, and in the multi-point flow the connection is usually already
  warm from server selection, in which case DNS and TCP legitimately read 0.
  Showing a row of zeroes would read as "0ms, excellent" rather than "not
  measured", so the whole block is dropped instead.
*/
/*
  Latency added by load, per phase.

  Both sides of the subtraction are averages on purpose. `test.ping` is the
  minimum of the idle samples, which is the right way to report an idle link
  but the wrong baseline here: subtracting a minimum from an average would
  book part of the difference between the two statistics as bufferbloat.
*/
function increase(loaded) {
  if (!(loaded > 0) || !(test.idlePingAvg > 0)) return 0;
  const delta = loaded - test.idlePingAvg;
  return delta > 0 ? delta : 0;
}

/*
  Severity bands for the increase, in milliseconds. These follow the grading
  in common use for bufferbloat tests rather than any Unitel-defined SLA - if
  operations has its own thresholds, this is the one place to change them.
*/
function severity(loaded) {
  const delta = increase(loaded);
  if (delta >= 100) return 'bad';
  if (delta >= 30) return 'warn';
  return 'ok';
}

const hasLoadedLatency = computed(() => test.probeCount > 0);

/* Only shown when the stage actually ran; a "Skip" is configuration, not a
   result, and rendering it as one would read as a failed web test. */
const hasBrowse = computed(() => !!test.browseStatus && test.browseStatus !== "Skip");
const hasVideo = computed(() => !!test.videoStatus && test.videoStatus !== "Skip");

const browsingMetrics = computed(() => {
  if (test.browsingResult && test.browsingResult.totalSites > 0) {
    return {
      ...test.browsingResult,
      averageLoadTimeSec: (test.browsingResult.averageLoadTime / 1000).toFixed(2)
    };
  }
  if (test.browseStatus && test.browseStatus !== "Skip") {
    return {
      status: test.browseStatus,
      score: test.browseStatus === "OK" ? 85 : 40,
      grade: test.browseStatus === "OK" ? "good" : "poor",
      averageLoadTimeSec: (test.browseTime / 1000).toFixed(2),
      successRate: test.browseStatus === "OK" ? 100 : 0,
      sites: []
    };
  }
  return null;
});

const streamingMetrics = computed(() => {
  if (test.streamingResult && test.streamingResult.status && test.streamingResult.status !== "Skip") {
    return test.streamingResult;
  }
  if (test.videoStatus && test.videoStatus !== "Skip") {
    return {
      status: test.videoStatus,
      score: test.videoStatus === "OK" ? 85 : 40,
      grade: test.videoStatus === "OK" ? "good" : "poor",
      startupTimeMs: test.videoTimeToPlay,
      bufferingCount: test.videoRebufferCount,
      bufferingDurationMs: test.videoRebuffering,
      highestStableQuality: test.videoQuality ? `${test.videoQuality}p` : null,
      throughputMbps: null
    };
  }
  return null;
});

/* Total bytes the video stage pulled, when any tier could count them. */
const streamingDataUsed = computed(() => formatBytes(streamingMetrics.value?.bytesUsed));

/*
  One row per tier played, carrying the three numbers that explain the score:
  how much of the time was playback, how long the first frame took, and what it
  cost in data.
*/
const streamingTiers = computed(() => {
  const tested = streamingMetrics.value?.qualitiesTested;
  if (!tested || !tested.length) return [];
  return tested.map((tier, index) => ({
    key: (tier.qualityLabel || "auto") + ":" + index,
    label: tier.qualityLabel || "auto",
    failed: tier.status !== "OK",
    resolution: tier.quality ? tier.quality + "p" : "–",
    rate:
      tier.performanceRate !== null && tier.performanceRate !== undefined
        ? tier.performanceRate.toFixed(1) + "%"
        : "–",
    startup: tier.startupTimeMs ? (tier.startupTimeMs / 1000).toFixed(2) + t("unit.s") : "–",
    data: formatBytes(tier.bytesUsed) || "–"
  }));
});

const timings = computed(() =>
  [
    { key: "DNS", value: test.dns },
    { key: "TCP", value: test.tcp },
    { key: "TLS", value: test.tls },
    { key: "TTFB", value: test.ttfb }
  ].filter((row) => row.value > 0)
);

const details = computed(() =>
  [
    { key: "server", label: t("server.label"), value: serverName.value },
    { key: "conn", label: t("net.connection"), value: connectionType.value },
    { key: "ip", label: "IP", value: test.ip },
    { key: "isp", label: "ISP", value: test.isp }
  ]
    .filter((row) => row.value)
    .concat(
      timings.value.map((row) => ({
        key: row.key,
        label: row.key,
        value: fmtTiming(row.value) + " " + t("unit.ms")
      }))
    )
);
</script>

<template>
  <section class="result">
    <p class="sr-only" role="status" aria-live="polite">
      {{ t("result.summary", {
        download: fmt(test.download, 1),
        upload: fmt(test.upload, 1),
        ping: fmt(test.ping, 0)
      }) }}
    </p>

    <!--
      The answer, on the instrument panel the run was watched on.

      Both figures at once and at the same size: the old screen opened with two
      equal white cards in a grid, which said nothing about which number the
      user came for, and buried the server the numbers belong to eight rows
      further down.
    -->
    <!--
      A result that changed network halfway is real but mislabelled: the
      numbers belong to a different network than the row claims. Said here
      rather than only stored, so the person who took the measurement knows to
      take it again instead of trusting it.
    -->
    <summaryTextRun v-if="false" />
    <p v-if="test.invalid" class="invalid-banner" role="status">
      {{ t("result.invalid." + test.invalid.reason) }}
    </p>

    <!-- Overall Network Quality (QoE) Assessment Card -->
    <section v-if="test.qoeResult && test.qoeResult.overallScore !== null" class="qoe-card card">
      <div class="qoe-header">
        <div class="qoe-title-wrap">
          <span class="qoe-pill" :class="'qoe-pill-' + test.qoeResult.overallGrade">
            {{ t("grade." + test.qoeResult.overallGrade) }}
          </span>
          <h2 class="qoe-title">{{ t("qoe.overallTitle") }}</h2>
        </div>
        <div class="qoe-score-box">
          <span class="qoe-score-value">{{ test.qoeResult.overallScore }}</span>
          <span class="qoe-score-scale">/100</span>
        </div>
      </div>

      <p class="qoe-desc">{{ t("qoe.gradeDesc." + test.qoeResult.overallGrade) }}</p>

      <div class="qoe-breakdown">
        <div class="qoe-breakdown-item">
          <div class="qoe-item-top">
            <span class="qoe-item-name">{{ t("stage.download") }}</span>
            <span class="qoe-item-score">{{ test.qoeResult.downloadScore }}</span>
          </div>
          <div class="qoe-bar"><div class="qoe-bar-fill bar-dl" :style="{ width: test.qoeResult.downloadScore + '%' }"></div></div>
        </div>

        <div class="qoe-breakdown-item">
          <div class="qoe-item-top">
            <span class="qoe-item-name">{{ t("stage.upload") }}</span>
            <span class="qoe-item-score">{{ test.qoeResult.uploadScore }}</span>
          </div>
          <div class="qoe-bar"><div class="qoe-bar-fill bar-ul" :style="{ width: test.qoeResult.uploadScore + '%' }"></div></div>
        </div>

        <div class="qoe-breakdown-item">
          <div class="qoe-item-top">
            <span class="qoe-item-name">{{ t("stage.ping") }}</span>
            <span class="qoe-item-score">{{ test.qoeResult.latencyScore }}</span>
          </div>
          <div class="qoe-bar"><div class="qoe-bar-fill bar-lat" :style="{ width: test.qoeResult.latencyScore + '%' }"></div></div>
        </div>

        <div v-if="test.qoeResult.browsingScore !== null" class="qoe-breakdown-item">
          <div class="qoe-item-top">
            <span class="qoe-item-name">{{ t("stage.browse") }}</span>
            <span class="qoe-item-score">{{ test.qoeResult.browsingScore }}</span>
          </div>
          <div class="qoe-bar"><div class="qoe-bar-fill bar-browse" :style="{ width: test.qoeResult.browsingScore + '%' }"></div></div>
        </div>

        <div v-if="test.qoeResult.streamingScore !== null" class="qoe-breakdown-item">
          <div class="qoe-item-top">
            <span class="qoe-item-name">{{ t("stage.video") }}</span>
            <span class="qoe-item-score">{{ test.qoeResult.streamingScore }}</span>
          </div>
          <div class="qoe-bar"><div class="qoe-bar-fill bar-video" :style="{ width: test.qoeResult.streamingScore + '%' }"></div></div>
        </div>
      </div>
    </section>

    <div class="instrument">
      <div class="result-head">
        <span class="done-badge">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3.5 8.5 6.5 11.5 12.5 5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {{ t("status.done") }}
        </span>
        <span class="result-server">{{ serverName }}</span>
      </div>

      <div class="readouts">
        <div class="readout readout-download">
          <span class="readout-label">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M8 3v9m0 0 4-4m-4 4-4-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ t("metric.download") }}
          </span>
          <span class="readout-value">{{ fmtSpeed(test.download) }}</span>
          <span class="readout-unit">{{ t("unit.mbps") }}</span>
          <SparkLine :points="test.dlSamples" variant="download" />
        </div>

        <div class="readout readout-upload">
          <span class="readout-label">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M8 13V4m0 0 4 4M8 4 4 8"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ t("metric.upload") }}
          </span>
          <span class="readout-value">{{ fmtSpeed(test.upload) }}</span>
          <span class="readout-unit">{{ t("unit.mbps") }}</span>
          <SparkLine :points="test.ulSamples" variant="upload" />
        </div>
      </div>
    </div>

    <div class="grid-2">
      <MetricCard
        :label="t('metric.ping')"
        :value="fmt(test.ping, 0)"
        :unit="t('unit.ms')"
      />
      <MetricCard
        :label="t('metric.jitter')"
        :value="fmt(test.jitter, 0)"
        :unit="t('unit.ms')"
      />
    </div>

    <section v-if="hasLoadedLatency" class="loaded card">
      <h3 class="section-title">{{ t('loaded.title') }}</h3>
      <p class="loaded-explain">{{ t('loaded.explain') }}</p>

      <div class="loaded-row">
        <span class="loaded-label">{{ t('loaded.idle') }}</span>
        <span class="loaded-value">{{ fmt(test.idlePingAvg, 0) }} {{ t('unit.ms') }}</span>
        <span class="loaded-extra"></span>
      </div>

      <div v-if="test.dlPing > 0" class="loaded-row">
        <span class="loaded-label">{{ t('loaded.download') }}</span>
        <span class="loaded-value">
          {{ fmt(test.dlPing, 0) }} {{ t('unit.ms') }}
          <em class="delta" :class="'delta-' + severity(test.dlPing)">
            {{ t('loaded.increase', { value: fmt(increase(test.dlPing), 0) }) }}
          </em>
        </span>
        <span class="loaded-extra">{{ t('loaded.worst', { value: fmt(test.dlPingMax, 0) }) }}</span>
      </div>

      <div v-if="test.ulPing > 0" class="loaded-row">
        <span class="loaded-label">{{ t('loaded.upload') }}</span>
        <span class="loaded-value">
          {{ fmt(test.ulPing, 0) }} {{ t('unit.ms') }}
          <em class="delta" :class="'delta-' + severity(test.ulPing)">
            {{ t('loaded.increase', { value: fmt(increase(test.ulPing), 0) }) }}
          </em>
        </span>
        <span class="loaded-extra">{{ t('loaded.worst', { value: fmt(test.ulPingMax, 0) }) }}</span>
      </div>

      <div class="loaded-row">
        <span class="loaded-label">{{ t('loaded.loss') }}</span>
        <span class="loaded-value">{{ fmt(test.probeLoss, 2) }} {{ t('unit.percent') }}</span>
        <span class="loaded-extra">{{ t('loaded.lossSamples', { count: test.probeCount }) }}</span>
      </div>

      <p class="loaded-caveat">{{ t('loaded.lossCaveat') }}</p>
    </section>

    <!-- Web Browsing QoE Card -->
    <section v-if="browsingMetrics" class="card qoe-feature-card">
      <div class="feature-head">
        <div class="feature-title-wrap">
          <svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <h3 class="feature-title">{{ t("metric.browse") }}</h3>
        </div>
        <span v-if="browsingMetrics.grade" class="qoe-pill" :class="'qoe-pill-' + browsingMetrics.grade">
          {{ browsingMetrics.score }}/100 · {{ t("grade." + browsingMetrics.grade) }}
        </span>
      </div>

      <div class="feature-stats">
        <div class="feature-stat">
          <span class="stat-label">{{ t("browse.averageLoadTime") }}</span>
          <span class="stat-value">{{ browsingMetrics.averageLoadTimeSec }} <span class="stat-unit">{{ t("unit.s") }}</span></span>
        </div>
        <div class="feature-stat">
          <span class="stat-label">{{ t("browse.successRate") }}</span>
          <span class="stat-value">{{ browsingMetrics.successRate }}<span class="stat-unit">%</span></span>
        </div>
      </div>

      <details v-if="browsingMetrics.sites && browsingMetrics.sites.length" class="site-details">
        <summary class="site-toggle">{{ t("browse.viewDetails", { count: browsingMetrics.sites.length }) }}</summary>
        <ul class="site-list">
          <li v-for="site in browsingMetrics.sites" :key="site.id" class="site-row">
            <span class="site-name">{{ site.name }}</span>
            <span class="site-time" :class="{ 'site-error': !site.success }">
              {{ site.success ? (site.loadTimeMs / 1000).toFixed(2) + 's' : site.httpStatus }}
            </span>
          </li>
        </ul>
      </details>
    </section>

    <!-- Video Streaming QoE Card -->
    <section v-if="streamingMetrics" class="card qoe-feature-card">
      <div class="feature-head">
        <div class="feature-title-wrap">
          <svg class="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <h3 class="feature-title">{{ t("stage.video") }}</h3>
        </div>
        <span v-if="streamingMetrics.grade" class="qoe-pill" :class="'qoe-pill-' + streamingMetrics.grade">
          {{ streamingMetrics.score }}/100 · {{ t("grade." + streamingMetrics.grade) }}
        </span>
      </div>

      <div class="feature-stats grid-3">
        <div class="feature-stat">
          <span class="stat-label">{{ t("video.startupTime") }}</span>
          <span class="stat-value">{{ streamingMetrics.startupTimeMs ? Number(streamingMetrics.startupTimeMs).toFixed(0) : "—" }} <span class="stat-unit">{{ t("unit.ms") }}</span></span>
        </div>
        <div class="feature-stat">
          <span class="stat-label">{{ t("video.bufferingCount") }}</span>
          <span class="stat-value">{{ streamingMetrics.bufferingCount ?? 0 }} <span class="stat-unit">{{ t("video.stalls") }}</span></span>
        </div>
        <div class="feature-stat">
          <span class="stat-label">{{ t("video.highestQuality") }}</span>
          <span class="stat-value highlight-quality">{{ streamingMetrics.highestStableQuality || "—" }}</span>
        </div>
      </div>

      <div v-if="streamingMetrics.throughputMbps" class="loaded-row mt-2">
        <span class="loaded-label">{{ t("video.throughput") }}</span>
        <span class="loaded-value">{{ streamingMetrics.throughputMbps }} {{ t("unit.mbps") }}</span>
      </div>
      <div v-if="streamingDataUsed" class="loaded-row">
        <span class="loaded-label">{{ t("video.dataUsed") }}</span>
        <span class="loaded-value">{{ streamingDataUsed }}</span>
      </div>

      <!-- The same per-tier table the testing screen builds, kept after the
           run so the numbers behind the score are still there to read. -->
      <details v-if="streamingTiers.length" class="site-details">
        <summary class="site-toggle">{{ t("video.viewTiers", { count: streamingTiers.length }) }}</summary>
        <ul class="site-list">
          <li v-for="tier in streamingTiers" :key="tier.key" class="site-row tier-row">
            <span class="site-name">
              {{ t("video.tier", { quality: tier.label }) }}
              <span class="tier-res">{{ tier.resolution }}</span>
            </span>
            <span class="site-time" :class="{ 'site-error': tier.failed }">
              {{ tier.rate }} · {{ tier.startup }} · {{ tier.data }}
            </span>
          </li>
        </ul>
        <p class="tier-legend">{{ t("video.tierLegend") }}</p>
      </details>
    </section>

    <dl class="details card">
      <div v-for="row in details" :key="row.key" class="detail">
        <dt class="label">{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
      <div v-if="test.testId" class="detail detail-id">
        <dt class="label">{{ t("result.testId") }}</dt>
        <dd><code class="test-id">{{ test.testId }}</code></dd>
      </div>
    </dl>

    <p v-if="test.testId" class="id-hint">{{ t("result.testIdHint") }}</p>

    <div class="actions">
      <button type="button" class="btn btn-primary btn-block" @click="$emit('again')">
        {{ t("action.testAgain") }}
      </button>
      <button type="button" class="btn btn-ghost btn-block" @click="share">
        {{ t("action.share") }}
      </button>
      <p v-if="shareState" class="share-state" role="status">{{ shareState }}</p>
      <button type="button" class="btn btn-ghost btn-block" @click="goTo(SCREEN.HISTORY)">
        {{ t("action.history") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.extra {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.invalid-banner {
  margin: 0;
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--warning);
  background: var(--warning-tint);
  color: var(--warning);
  font-size: var(--fs-sm);
}

.result {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  width: 100%;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
}

.done-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--success);
  flex: none;
}

.done-badge svg {
  width: 1rem;
  height: 1rem;
}

.result-server {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.readouts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.readout {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-4);
  min-width: 0;
}

/* A hairline between the two, rather than a gap: they are one reading of one
   link, not two unrelated cards. */
.readout-upload {
  border-left: 1px solid var(--border);
}

.readout-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.readout-label svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
}

.readout-download .readout-label {
  color: var(--gauge-download-from);
}

.readout-upload .readout-label {
  color: var(--gauge-upload-from);
}

.readout-value {
  font-family: var(--font-numeric);
  font-size: clamp(2rem, 11vw, 2.75rem);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: var(--text);
}

.readout-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}

.loaded {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.loaded-explain,
.loaded-caveat {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.loaded-caveat {
  margin-top: var(--sp-2);
  border-top: 1px solid var(--border);
  padding-top: var(--sp-2);
}

.loaded-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--sp-1) var(--sp-3);
}

.loaded-label {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}

.loaded-value {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semibold);
  text-align: right;
}

.loaded-extra {
  grid-column: 2;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: right;
}

.delta {
  font-style: normal;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  margin-left: var(--sp-2);
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
}

.delta-ok {
  color: var(--success);
  background: var(--success-tint);
}

.delta-warn {
  color: var(--warning);
  background: var(--warning-tint);
}

.delta-bad {
  color: var(--danger);
  background: var(--danger-bg);
}

.details {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  margin: 0;
}

.detail {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
}

.detail dd {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  text-align: right;
  overflow-wrap: anywhere;
}

.detail-id {
  border-top: 1px solid var(--border);
  padding-top: var(--sp-3);
}

.test-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  user-select: all;
}

.id-hint {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
}

.share-state {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* QoE Overall Assessment Card */
.qoe-card {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  border: 1px solid rgba(242, 101, 34, 0.25);
  background: linear-gradient(180deg, rgba(242, 101, 34, 0.08) 0%, rgba(18, 20, 29, 0.6) 100%);
}

.qoe-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.qoe-title-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.qoe-title {
  margin: 0;
  font-size: var(--fs-md, 1rem);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.qoe-score-box {
  display: flex;
  align-items: baseline;
  gap: 2px;
}

.qoe-score-value {
  font-family: var(--font-numeric);
  font-size: 2.25rem;
  font-weight: var(--fw-bold);
  line-height: 1;
  color: var(--text-primary);
}

.qoe-score-scale {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.qoe-desc {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.4;
}

.qoe-pill {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.qoe-pill-excellent {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.qoe-pill-good {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.qoe-pill-average {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.qoe-pill-poor {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.qoe-pill-veryPoor {
  background: rgba(156, 163, 175, 0.15);
  color: #9ca3af;
  border: 1px solid rgba(156, 163, 175, 0.3);
}

.qoe-breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border);
}

.qoe-breakdown-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.qoe-item-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--fs-xs);
}

.qoe-item-name {
  color: var(--text-muted);
}

.qoe-item-score {
  font-family: var(--font-numeric);
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
}

.qoe-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.qoe-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease-out;
}

.bar-dl {
  background: var(--gauge-download-from);
}

.bar-ul {
  background: var(--gauge-upload-from);
}

.bar-lat {
  background: #38bdf8;
}

.bar-browse {
  background: #a78bfa;
}

.bar-video {
  background: #f43f5e;
}

/* Feature Cards (Browsing & Video) */
.qoe-feature-card {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.feature-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}

.feature-title-wrap {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.feature-icon {
  width: 1.1rem;
  height: 1.1rem;
  color: var(--brand-primary);
  flex: none;
}

.feature-title {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}

.feature-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
}

.grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.feature-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.stat-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  color: var(--text-primary);
}

.stat-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-normal);
  color: var(--text-muted);
}

.highlight-quality {
  color: var(--brand-primary);
}

.mt-2 {
  margin-top: var(--sp-2);
}

.site-details {
  border-top: 1px solid var(--border);
  padding-top: var(--sp-2);
}

.site-toggle {
  font-size: var(--fs-xs);
  color: var(--brand-primary);
  cursor: pointer;
  user-select: none;
}

.site-list {
  list-style: none;
  margin: var(--sp-2) 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.site-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--fs-xs);
  padding: 3px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
}

.site-name {
  color: var(--text-secondary);
}

.site-time {
  font-family: var(--font-numeric);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}

.site-error {
  color: var(--danger);
}

.tier-row {
  gap: var(--sp-2);
}

.tier-res {
  color: var(--brand-primary);
  font-family: var(--font-numeric);
  font-weight: var(--fw-semibold);
  padding-left: 4px;
}

.tier-legend {
  margin: var(--sp-1) 0 0 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
</style>
