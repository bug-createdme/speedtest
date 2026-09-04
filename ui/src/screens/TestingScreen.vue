<script setup>
import { computed } from "vue";
import SpeedGauge from "../components/SpeedGauge.vue";
import SparkLine from "../components/SparkLine.vue";
import StageStepper from "../components/StageStepper.vue";
import { STAGE, availableStages, stageDuration, test } from "../state/test.js";
import { formatBytes } from "../measurement/streaming.js";
import { useI18n } from "../i18n/index.js";

defineEmits(["cancel"]);
const { t } = useI18n();

const variant = computed(() => {
  if (test.stage === STAGE.DOWNLOAD) return "download";
  if (test.stage === STAGE.UPLOAD) return "upload";
  return "neutral";
});

const value = computed(() => {
  if (test.stage === STAGE.DOWNLOAD) return test.download;
  if (test.stage === STAGE.UPLOAD) return test.upload;
  return 0;
});

const samples = computed(() =>
  test.stage === STAGE.UPLOAD ? test.ulSamples : test.dlSamples
);

const progress = computed(() => {
  if (test.stage === STAGE.DOWNLOAD) return test.dlProgress;
  if (test.stage === STAGE.UPLOAD) return test.ulProgress;
  if (test.stage === STAGE.PING) return test.pingProgress;
  if (test.stage === STAGE.BROWSE) return test.browsingProgress || test.browseProgress;
  if (test.stage === STAGE.VIDEO) return test.streamingProgress || test.videoProgress;
  if (test.stage === STAGE.CALCULATING) return 1;
  return 0;
});

const duration = computed(() => stageDuration(test.stage));

const headline = computed(() => {
  if (test.stage === STAGE.PING) return t("status.measuringPing");
  if (test.stage === STAGE.DOWNLOAD) return t("status.measuringDownload");
  if (test.stage === STAGE.UPLOAD) return t("status.measuringUpload");
  if (test.stage === STAGE.BROWSE) {
    const site = test.browsingCurrentSite;
    return site ? `${t("status.measuringBrowse")} (${site})` : t("status.measuringBrowse");
  }
  if (test.stage === STAGE.VIDEO) {
    const q = test.streamingCurrentQuality;
    return q ? `${t("status.measuringVideo")} (${q})` : t("status.measuringVideo");
  }
  if (test.stage === STAGE.CALCULATING) return t("status.calculatingQoE");
  return t("status.idle");
});

const doneStages = computed(() => ({
  [STAGE.PING]: test.ping > 0 && test.stage !== STAGE.PING,
  [STAGE.DOWNLOAD]: test.download > 0 && test.stage !== STAGE.DOWNLOAD,
  [STAGE.UPLOAD]: test.upload > 0 && test.stage !== STAGE.UPLOAD,
  [STAGE.BROWSE]: !!test.browsingResult && test.stage !== STAGE.BROWSE,
  [STAGE.VIDEO]: !!test.streamingResult && test.stage !== STAGE.VIDEO
}));

const showGauge = computed(
  () => test.stage === STAGE.DOWNLOAD || test.stage === STAGE.UPLOAD
);

/*
  The URL ledger under the rendered page: every site the run will visit, listed
  before the first one loads, each row filling in with its own load time and
  rating as the run reaches it.
*/
const browseRows = computed(() => {
  const done = new Map((test.browsingSitesList || []).map((s) => [s.id, s]));
  const planned =
    test.browsingPlannedSites && test.browsingPlannedSites.length
      ? test.browsingPlannedSites
      : test.browsingSitesList || [];

  return planned.map((site, index) => {
    const result = done.get(site.id) || null;
    return {
      key: site.id || site.url || index,
      url: site.url,
      name: site.name,
      result,
      /* Reached, but no verdict yet - the row that is loading right now. */
      active: index === test.browsingCurrentIndex && !result,
      pending: index > test.browsingCurrentIndex,
      /* Response time rather than page load: a different measurement, so it is
         marked rather than left to look like the others. */
      probed: !!result && result.source === "probe" && result.success,
      time: result
        ? result.success
          ? (result.loadTimeMs / 1000).toFixed(2) + t("unit.s")
          : result.httpStatus
        : "–",
      rating: result && result.success ? result.rating + "%" : "–"
    };
  });
});

/* Any row measured by probe needs the footnote explaining what its time is. */
const hasProbedRows = computed(() => browseRows.value.some((r) => r.probed));

/* Elapsed on the page on screen right now, not the run average. */
const currentSiteSeconds = computed(() =>
  ((test.browsingCurrentElapsedMs || 0) / 1000).toFixed(2)
);

/* The thin bar under the address bar tracks the current page, not the run -
   the footer bar already shows the run. */
const browseSiteBarWidth = computed(
  () => Math.min(100, Math.max(0, test.browsingCurrentPercent || 0)) + "%"
);

/* ── VIDEO STAGE ───────────────────────────────────────────────────── */

/* The tier on screen right now, by its configured label ("360p"), so the
   caption names what is playing rather than saying "video". */
const streamingTierLabel = computed(
  () =>
    test.streamingCurrentQuality ||
    test.streamingPlannedQualities[Math.max(0, test.streamingCurrentIndex)]?.quality ||
    ""
);

/* nPerf's caption under the player: what the player is doing, at this quality. */
const streamingCaption = computed(() => {
  const q = streamingTierLabel.value;
  switch (test.streamingPhase) {
    case "buffering":
      return t("video.buffering");
    case "loading-results":
      return t("video.loadingResults");
    case "done":
      return t("video.finished");
    case "playing":
      return q ? t("video.playingQuality", { quality: q }) : t("status.measuringVideo");
    default:
      return q ? t("video.startingQuality", { quality: q }) : t("status.measuringVideo");
  }
});

const streamingSmooth = computed(() => test.streamingPhase === "playing");

/* Progress of the tier on screen, not of the run - the footer bar already
   shows the run. */
const streamingTierBarWidth = computed(() => {
  const total = test.streamingPlannedQualities.length || 1;
  const idx = Math.max(0, test.streamingCurrentIndex);
  const within = Math.min(1, Math.max(0, test.streamingProgress * total - idx));
  return (within * 100).toFixed(1) + "%";
});

function secondsText(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  return (n / 1000).toFixed(2) + " " + t("unit.s");
}

function bytesText(bytes) {
  return formatBytes(bytes);
}

/*
  The detail table under the player: one card per tier, every tier listed
  before the first one plays, each filling in with its own numbers as the run
  reaches it. Same arrangement as the browse ledger above.
*/
const streamingCards = computed(() => {
  const planned = test.streamingPlannedQualities || [];
  const done = test.streamingTiers || [];
  const live = test.streamingLiveStats;
  const idx = test.streamingCurrentIndex;

  return planned.map((tier, index) => {
    const result = done[index] || null;
    const active = index === idx && !result;
    /* Live figures for the tier playing now, settled ones for a tier that has
       finished, nothing at all for one not reached yet. */
    const stats = result || (active ? live : null);
    const probed = !!result && result.measuredBy === "probe";
    const estimated = stats && stats.bytesSource === "estimated";
    const resolution = stats && stats.resolution
      ? stats.resolution
      : result && result.quality
        ? result.quality
        : null;

    return {
      key: tier.quality + ":" + index,
      /* nPerf names the source in this cell ("Google YouTube") and puts the
         resolution beside it. A tier can be given a name for that; without
         one it falls back to naming the tier itself. */
      name: tier.name && tier.name !== tier.quality
        ? tier.name
        : t("video.tier", { quality: tier.quality }),
      label: tier.quality,
      active,
      pending: index > idx,
      failed: !!result && result.status !== "OK",
      probed,
      estimated,
      resolution: resolution ? resolution + "p" : "–",
      rate:
        stats && stats.performanceRate !== null && stats.performanceRate !== undefined
          ? stats.performanceRate.toFixed(2) + " " + t("unit.percent")
          : "–",
      startup: stats && stats.startupTimeMs ? secondsText(stats.startupTimeMs) : "–",
      buffering:
        stats && stats.bufferingDurationMs !== null && stats.bufferingDurationMs !== undefined
          ? secondsText(stats.bufferingDurationMs)
          : "–",
      data: (stats && bytesText(stats.bytesUsed)) || "–"
    };
  });
});

/* Footnotes, only when a row actually needs one. */
const hasEstimatedData = computed(() => streamingCards.value.some((c) => c.estimated));
const hasProbedTiers = computed(() => streamingCards.value.some((c) => c.probed));

const settled = computed(() =>
  [
    {
      key: STAGE.PING,
      label: t("stage.ping"),
      value: test.ping > 0 ? test.ping.toFixed(0) : null,
      unit: t("unit.ms"),
      variant: "neutral"
    },
    {
      key: STAGE.DOWNLOAD,
      label: t("stage.download"),
      value:
        test.download > 0 && test.stage !== STAGE.DOWNLOAD
          ? test.download.toFixed(1)
          : null,
      unit: t("unit.mbps"),
      variant: "download"
    },
    {
      key: STAGE.UPLOAD,
      label: t("stage.upload"),
      value:
        test.upload > 0 && test.stage !== STAGE.UPLOAD ? test.upload.toFixed(1) : null,
      unit: t("unit.mbps"),
      variant: "upload"
    },
    {
      key: STAGE.BROWSE,
      label: t("stage.browse"),
      value:
        test.browsingResult && test.stage !== STAGE.BROWSE
          ? (test.browsingResult.averageLoadTime / 1000).toFixed(2)
          : null,
      unit: t("unit.s"),
      variant: "neutral"
    },
    {
      key: STAGE.VIDEO,
      label: t("stage.video"),
      value:
        test.streamingResult && test.stage !== STAGE.VIDEO
          ? (test.streamingResult.startupTimeMs || test.videoTimeToPlay).toFixed(0)
          : null,
      unit: t("unit.ms"),
      variant: "neutral"
    }
  ].filter((row) => row.value)
);
</script>

<template>
  <section class="testing">
    <div class="instrument">
      <div class="instrument-body">
        <StageStepper :stage="test.stage" :done="doneStages" :available="availableStages()" />

        <p class="sr-only" role="status" aria-live="polite">{{ headline }}</p>

        <!-- ── STAGE: WEB BROWSING - the page under test, rendered live ─── -->
        <div v-if="test.stage === STAGE.BROWSE" class="stage-view-card web-preview-card">
          <div class="browser-mockup">
            <div class="browser-header">
              <div class="browser-dots">
                <span class="b-dot b-red"></span>
                <span class="b-dot b-yellow"></span>
                <span class="b-dot b-green"></span>
              </div>
              <div class="browser-address-bar">
                <svg class="b-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span class="b-url">{{ test.browsingCurrentUrl || '—' }}</span>
              </div>
              <span class="browser-status-tag">{{ test.browsingCurrentStatus || t('browse.opening') }}</span>
            </div>

            <div class="browser-progress-track">
              <div class="browser-progress-fill" :style="{ width: browseSiteBarWidth }"></div>
            </div>

            <!--
              The page itself. browsing.js puts the iframe in here and times it
              to its load event, so what is on screen is what was measured.
              The note is a sibling, not a child: browsing.js clears the
              container, and would wipe anything Vue rendered inside it.
            -->
            <div class="browser-stage">
              <div id="browse-testing-container" class="browser-viewport"></div>
              <div v-if="!test.browsingCurrentRenders" class="browser-noframe">
                <svg class="noframe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="3" y="4" width="18" height="16" rx="2"/>
                  <path d="M3 9h18M4 20L20 4"/>
                </svg>
                <p class="noframe-title">{{ t("browse.noFrame") }}</p>
                <p class="noframe-hint">{{ t("browse.noFrameHint") }}</p>
              </div>
            </div>

            <div class="browser-caption">
              <span class="caption-name">{{ test.browsingCurrentSite || t('status.measuringBrowse') }}</span>
              <span class="caption-time">
                <span class="caption-time-number">{{ currentSiteSeconds }}</span>
                <span class="caption-time-unit">{{ t('unit.s') }}</span>
              </span>
            </div>
          </div>

          <div v-if="browseRows.length" class="browse-ledger">
            <div class="ledger-head">
              <span class="ledger-col-url">{{ t('browse.browsedUrls') }}</span>
              <span class="ledger-col-time">{{ t('browse.time') }}</span>
              <span class="ledger-col-rate">{{ t('browse.rating') }}</span>
            </div>
            <div
              v-for="row in browseRows"
              :key="row.key"
              class="ledger-row"
              :class="{
                'ledger-active': row.active,
                'ledger-pending': row.pending,
                'ledger-failed': row.result && !row.result.success
              }"
            >
              <span class="ledger-col-url" :title="row.url">{{ row.url }}</span>
              <span class="ledger-col-time">
                <span v-if="row.active" class="ledger-spinner" aria-hidden="true"></span>
                <template v-else>{{ row.time }}<span v-if="row.probed" class="ledger-mark">*</span></template>
              </span>
              <span class="ledger-col-rate">{{ row.rating }}</span>
            </div>
            <p v-if="hasProbedRows" class="ledger-note">{{ t("browse.responseNote") }}</p>
          </div>
        </div>

        <!-- ── STAGE: LIVE VIDEO STREAMING PLAYER ──────────────────────── -->
        <div v-else-if="test.stage === STAGE.VIDEO" class="stage-view-card video-playback-card">
          <div class="video-mockup">
            <div class="video-stage">
              <!--
                The player itself. streaming.js puts the <video> in here and
                times it, so what is on screen is what was measured.
              -->
              <div id="video-testing-container" class="video-viewport"></div>

              <div class="video-overlay-top">
                <span class="video-badge-quality">{{ streamingTierLabel || "—" }}</span>
                <span class="video-badge-status">
                  <span class="video-pulse-dot" :class="{ 'video-pulse-idle': !streamingSmooth }"></span>
                  {{ test.streamingCurrentResolution ? test.streamingCurrentResolution + "p" : "—" }}
                </span>
              </div>
            </div>

            <div class="video-progress-track">
              <div class="video-progress-fill" :style="{ width: streamingTierBarWidth }"></div>
            </div>

            <!-- nPerf's caption strip: what the player is doing, right now. -->
            <div class="video-caption">
              <span class="video-caption-spinner" aria-hidden="true"></span>
              <span class="video-caption-text">{{ streamingCaption }}</span>
            </div>
          </div>

          <!-- The detail table: every tier, its numbers filling in as it plays. -->
          <div v-if="streamingCards.length" class="video-detail">
            <div
              v-for="card in streamingCards"
              :key="card.key"
              class="video-card"
              :class="{
                'video-card-active': card.active,
                'video-card-pending': card.pending,
                'video-card-failed': card.failed
              }"
            >
              <div class="video-card-head">
                <span class="video-card-name">{{ card.name }}</span>
                <span class="video-card-res">{{ card.resolution }}</span>
              </div>
              <dl class="video-card-rows">
                <div class="video-card-row">
                  <dt>{{ t("video.performanceRate") }}</dt>
                  <dd>
                    <span v-if="card.active" class="video-row-spinner" aria-hidden="true"></span>
                    <template v-else>{{ card.rate }}</template>
                  </dd>
                </div>
                <div class="video-card-row">
                  <dt>{{ t("video.initialLoading") }}</dt>
                  <dd>{{ card.startup }}</dd>
                </div>
                <div class="video-card-row">
                  <dt>{{ t("video.bufferingTotal") }}</dt>
                  <dd>{{ card.buffering }}</dd>
                </div>
                <div class="video-card-row">
                  <dt>{{ t("video.dataUsed") }}</dt>
                  <dd>
                    {{ card.data }}<span v-if="card.estimated" class="video-mark">*</span>
                  </dd>
                </div>
              </dl>
            </div>
            <p v-if="hasEstimatedData" class="video-note">{{ t("video.estimateNote") }}</p>
            <p v-if="hasProbedTiers" class="video-note">{{ t("video.probeNote") }}</p>
          </div>
        </div>

        <!-- ── STAGE: CALCULATING QOE OVERALL SCORE ────────────────────── -->
        <div v-else-if="test.stage === STAGE.CALCULATING" class="stage-view-card calculating-card">
          <div class="calculating-spinner">
            <div class="calculating-ring"></div>
            <div class="calculating-label">QoE</div>
          </div>
          <div class="calculating-title">{{ t("status.calculatingQoE") }}</div>
          <div class="calculating-desc">{{ t("status.calculatingDesc") }}</div>
        </div>

        <!-- ── STAGE: SPEED GAUGES (PING, DOWNLOAD, UPLOAD) ────────────── -->
        <template v-else>
          <SpeedGauge
            :value="showGauge ? value : 0"
            :variant="variant"
            :idle="!showGauge"
            :unit="t('unit.mbps')"
            :aria-label="t('a11y.gauge', { value: value.toFixed(1) })"
          >
            <template v-if="!showGauge">
              <span
                class="ping-value"
                :class="{ 'ping-value-pending': !test.ping }"
              >{{ test.ping ? test.ping.toFixed(0) : "—" }}</span>
              <span class="ping-unit">{{ t("unit.ms") }}</span>
            </template>
          </SpeedGauge>

          <SparkLine
            v-if="showGauge"
            :points="samples"
            :variant="variant"
          />
        </template>

        <p class="headline" aria-hidden="true">{{ headline }}</p>
      </div>

      <div class="instrument-footer">
        <div
          class="progress"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(progress * 100)"
          :aria-label="t('a11y.progress')"
        >
          <div class="progress-bar" :style="{ width: (progress * 100).toFixed(1) + '%' }"></div>
        </div>
        <p v-if="duration" class="elapsed" aria-hidden="true">
          {{ t("status.elapsed", { elapsed: (progress * duration).toFixed(1), total: duration }) }}
        </p>
      </div>
    </div>

    <ul v-if="settled.length" class="settled">
      <li v-for="row in settled" :key="row.key" class="settled-row" :class="'settled-' + row.variant">
        <span class="settled-label">{{ row.label }}</span>
        <span class="settled-value">{{ row.value }} <span class="settled-unit">{{ row.unit }}</span></span>
      </li>
    </ul>

    <button type="button" class="btn btn-ghost btn-block" @click="$emit('cancel')">
      {{ t("action.cancel") }}
    </button>
  </section>
</template>

<style scoped>
.testing {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  flex: 1;
  justify-content: center;
  width: 100%;
}

.headline {
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  text-align: center;
  margin-top: var(--sp-2);
}

.ping-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-readout);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--text);
}

.ping-value-pending {
  font-size: var(--fs-2xl);
  color: var(--text-muted);
}

.ping-unit {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.instrument-footer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.elapsed {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.settled {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: var(--sp-2);
}

.settled-row {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent, var(--border-strong));
  min-width: 0;
}

.settled-download {
  --accent: var(--brand-download);
}

.settled-upload {
  --accent: var(--brand-upload);
}

.settled-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.settled-value {
  white-space: nowrap;
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-bold);
  color: var(--text);
}

.settled-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}

/* ── STAGE VIEW CARDS (WEB & VIDEO) ────────────────────────────────── */
.stage-view-card {
  width: 100%;
  margin: var(--sp-3) 0 var(--sp-2) 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

/* ── Web Browser Mockup ────────────────────────────────────────────── */
.browser-mockup {
  width: 100%;
  background: var(--surface-raised, #18191d);
  border: 1px solid var(--border-strong, #32353f);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.browser-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface, #121316);
  border-bottom: 1px solid var(--border, #262830);
}

.browser-dots {
  display: flex;
  gap: 5px;
}

.b-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}

.b-red { background: #ff5f56; }
.b-yellow { background: #ffbd2e; }
.b-green { background: #27c93f; }

.browser-address-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-raised, #1f2127);
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #2d303a);
  min-width: 0;
}

.b-lock-icon {
  width: 12px;
  height: 12px;
  color: var(--brand-primary, #ff7a00);
  flex-shrink: 0;
}

.b-url {
  font-size: 0.75rem;
  color: var(--text-secondary, #a0a4b0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.browser-status-tag {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--brand-primary, #ff7a00);
  background: rgba(255, 122, 0, 0.12);
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.browser-progress-track {
  width: 100%;
  height: 2px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.browser-progress-fill {
  height: 100%;
  background: var(--brand-gradient, linear-gradient(90deg, #ff7a00, #ff4500));
  transition: width 0.25s ease-out;
}

/*
  The page under test, shown at full brightness. It used to sit at 25% opacity
  behind a card that covered it, which meant the screen never actually showed
  what was being measured - the thing this stage exists to show.

  White, because that is what an empty page looks like; a dark box behind a
  loading page reads as a broken one.
*/
.browser-stage {
  position: relative;
  width: 100%;
  height: 300px;
}

.browser-viewport {
  position: absolute;
  inset: 0;
  background: #fff;
  overflow: hidden;
}

/* A site that refuses to be framed would otherwise be an empty white box that
   reads as a broken page. */
.browser-noframe {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: var(--sp-4);
  text-align: center;
  background: var(--surface-raised, #18191d);
}

.noframe-icon {
  width: 30px;
  height: 30px;
  color: var(--text-muted, #727682);
}

.noframe-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-secondary, #a0a4b0);
}

.noframe-hint {
  margin: 0;
  font-size: 0.74rem;
  color: var(--text-muted, #727682);
}

/* Sizing and the fit-to-panel scale are set inline by browsing.js, which is
   the only place that knows the panel's measured size. */
.browser-viewport :deep(iframe) {
  border: 0;
  display: block;
}

.browser-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: 7px 12px;
  background: var(--surface, #121316);
  border-top: 1px solid var(--border, #262830);
}

.caption-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text, #fff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.caption-time {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: var(--brand-primary, #ff7a00);
  flex-shrink: 0;
}

.caption-time-number {
  font-family: var(--font-numeric);
  font-size: 1.15rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.caption-time-unit {
  font-size: 0.78rem;
  font-weight: 600;
}

/* ── URL ledger: every site, its load time, its rating ─────────────── */
.browse-ledger {
  width: 100%;
  border: 1px solid var(--border, #2b2e38);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface, #18191d);
}

.ledger-head,
.ledger-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.2rem 3.2rem;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 0.72rem;
}

.ledger-head {
  background: rgba(255, 122, 0, 0.12);
  color: var(--brand-primary, #ff7a00);
  font-weight: 700;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.ledger-row {
  border-top: 1px solid var(--border, #262830);
  color: var(--text-secondary, #a0a4b0);
}

.ledger-row.ledger-active {
  background: rgba(255, 122, 0, 0.07);
  color: var(--text, #fff);
}

.ledger-row.ledger-pending {
  opacity: 0.5;
}

.ledger-row.ledger-failed .ledger-col-time,
.ledger-row.ledger-failed .ledger-col-rate {
  color: #ff5f56;
}

.ledger-col-url {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ledger-col-time,
.ledger-col-rate {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  text-align: right;
  color: var(--text, #fff);
}

.ledger-head .ledger-col-time,
.ledger-head .ledger-col-rate {
  font-family: inherit;
  color: inherit;
}

.ledger-mark {
  color: var(--brand-primary, #ff7a00);
  font-weight: 700;
  padding-left: 1px;
}

.ledger-note {
  margin: 0;
  padding: 5px 10px 7px;
  border-top: 1px solid var(--border, #262830);
  font-size: 0.68rem;
  line-height: 1.35;
  color: var(--text-muted, #727682);
}

.ledger-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 122, 0, 0.25);
  border-top-color: var(--brand-primary, #ff7a00);
  border-radius: 50%;
  animation: ledger-spin 0.7s linear infinite;
  vertical-align: -1px;
}

@keyframes ledger-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ledger-spinner {
    animation-duration: 2.4s;
  }
}

/* ── Live Video Streaming Player ───────────────────────────────────── */
.video-playback-card {
  width: 100%;
}

/* Same chrome as the browser mockup above: player, its own progress bar, and
   a caption strip saying what is happening to it. */
.video-mockup {
  width: 100%;
  background: var(--surface-raised, #18191d);
  border: 1px solid var(--border-strong, #32353f);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.video-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
}

.video-viewport {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.video-progress-track {
  width: 100%;
  height: 2px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.video-progress-fill {
  height: 100%;
  background: var(--brand-gradient, linear-gradient(90deg, #ff7a00, #ff4500));
  transition: width 0.25s ease-out;
}

.video-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--surface, #121316);
  border-top: 1px solid var(--border, #262830);
}

.video-caption-text {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text, #fff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-caption-spinner {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 122, 0, 0.25);
  border-top-color: var(--brand-primary, #ff7a00);
  border-radius: 50%;
  animation: ledger-spin 0.7s linear infinite;
}

.video-overlay-top {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  z-index: 5;
}

.video-badge-quality {
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 122, 0, 0.5);
  color: var(--brand-primary, #ff7a00);
  font-size: 0.72rem;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  letter-spacing: 0.05em;
  backdrop-filter: blur(4px);
}

.video-badge-status {
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  backdrop-filter: blur(4px);
}

.video-pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #27c93f;
  animation: pulse-dot 1.2s infinite ease-in-out;
}

/* Not playing: the dot stops claiming it is. */
.video-pulse-idle {
  background: var(--text-muted, #8b909f);
  animation: none;
}

@keyframes pulse-dot {
  0% { transform: scale(0.9); opacity: 0.6; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.6; }
}

@media (prefers-reduced-motion: reduce) {
  .video-pulse-dot { animation: none; }
  .video-caption-spinner,
  .video-row-spinner { animation-duration: 2.4s; }
}

/* ── Per-tier detail table ─────────────────────────────────────────── */
.video-detail {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.video-card {
  border: 1px solid var(--border, #2b2e38);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface, #18191d);
}

.video-card-pending {
  opacity: 0.5;
}

.video-card-active {
  border-color: var(--brand-primary, #ff7a00);
}

.video-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(255, 122, 0, 0.12);
}

.video-card-active .video-card-head {
  background: rgba(255, 122, 0, 0.22);
}

.video-card-name {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--brand-primary, #ff7a00);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-card-res {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text, #fff);
  flex-shrink: 0;
}

.video-card-rows {
  margin: 0;
}

.video-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border-top: 1px solid var(--border, #262830);
  font-size: 0.74rem;
}

.video-card-row dt {
  color: var(--text-secondary, #a0a4b0);
  min-width: 0;
}

.video-card-row dd {
  margin: 0;
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text, #fff);
  white-space: nowrap;
}

.video-card-failed .video-card-row dd {
  color: #ff5f56;
}

.video-mark {
  color: var(--brand-primary, #ff7a00);
  font-weight: 700;
  padding-left: 1px;
}

.video-note {
  margin: 0;
  font-size: 0.68rem;
  line-height: 1.35;
  color: var(--text-muted, #727682);
}

.video-row-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 122, 0, 0.25);
  border-top-color: var(--brand-primary, #ff7a00);
  border-radius: 50%;
  animation: ledger-spin 0.7s linear infinite;
  vertical-align: -1px;
}

/* ── Calculating QoE Card ──────────────────────────────────────────── */
.calculating-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5) var(--sp-3);
  text-align: center;
  background: var(--surface, #141518);
  border: 1px solid var(--border, #272a33);
  border-radius: 16px;
}

.calculating-spinner {
  position: relative;
  width: 76px;
  height: 76px;
  margin-bottom: var(--sp-3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.calculating-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid rgba(255, 122, 0, 0.15);
  border-top-color: var(--brand-primary, #ff7a00);
  animation: spin 1s infinite linear;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.calculating-label {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--brand-primary, #ff7a00);
}

.calculating-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text, #fff);
  margin-bottom: 4px;
}

.calculating-desc {
  font-size: 0.78rem;
  color: var(--text-muted, #7a7f8e);
  max-width: 280px;
}
</style>
