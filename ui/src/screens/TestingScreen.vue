<script setup>
import { computed } from "vue";
import SpeedGauge from "../components/SpeedGauge.vue";
import SparkLine from "../components/SparkLine.vue";
import StageStepper from "../components/StageStepper.vue";
import { STAGE, availableStages, stageDuration, test } from "../state/test.js";
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

const streamingStatusText = computed(() => {
  if (!test.streamingLiveStats) return "Đang kết nối video...";
  if (test.streamingLiveStats.status === "buffering") return "Đang chờ đệm...";
  if (test.streamingLiveStats.status === "playing") return "Đang phát mượt";
  return "Đang phát video";
});

const streamingThroughputText = computed(() => {
  const mbps = test.streamingLiveStats?.throughputMbps;
  return mbps && mbps > 0 ? `${mbps.toFixed(1)} Mbps` : "—";
});

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

        <!-- ── STAGE: WEB BROWSING VISUAL VIEWER ────────────────────────── -->
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
                <span class="b-url">{{ test.browsingCurrentUrl || 'https://unitel.com.la/' }}</span>
              </div>
              <span class="browser-status-tag">{{ test.browsingCurrentStatus || 'Đang mở' }}</span>
            </div>

            <div class="browser-progress-track">
              <div class="browser-progress-fill" :style="{ width: ((test.browsingProgress || 0) * 100) + '%' }"></div>
            </div>

            <div class="browser-viewport">
              <iframe
                v-if="test.browsingCurrentUrl"
                :key="test.browsingCurrentUrl"
                :src="test.browsingCurrentUrl"
                class="browser-iframe"
                sandbox="allow-scripts allow-same-origin"
                loading="eager"
              ></iframe>
              <div class="browser-viewport-overlay">
                <div class="viewport-card">
                  <div class="viewport-icon">🌐</div>
                  <div class="viewport-title">{{ test.browsingCurrentSite || 'Đang mở trang web' }}</div>
                  <div class="viewport-time">
                    <span class="v-time-number">{{ test.browseTime ? (test.browseTime / 1000).toFixed(2) : "0.00" }}</span>
                    <span class="v-time-unit">s</span>
                  </div>
                  <div class="viewport-hint">Đang đo tốc độ phản hồi và tải nội dung</div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="test.browsingSitesList && test.browsingSitesList.length" class="browsing-sites-strip">
            <div
              v-for="s in test.browsingSitesList"
              :key="s.id"
              class="strip-pill"
              :class="{ 'strip-success': s.success, 'strip-error': !s.success }"
            >
              <span class="strip-pill-dot"></span>
              <span class="strip-pill-name">{{ s.name }}</span>
              <span class="strip-pill-val">{{ s.success ? (s.loadTimeMs / 1000).toFixed(2) + 's' : s.httpStatus }}</span>
            </div>
          </div>
        </div>

        <!-- ── STAGE: LIVE VIDEO STREAMING PLAYER ──────────────────────── -->
        <div v-else-if="test.stage === STAGE.VIDEO" class="stage-view-card video-playback-card">
          <div class="video-player-frame">
            <!-- Video element appended here by streaming engine -->
            <div id="video-testing-container" class="video-testing-container"></div>

            <!-- Floating Top Overlays -->
            <div class="video-overlay-top">
              <span class="video-badge-quality">{{ test.streamingCurrentQuality || "HD" }}</span>
              <span class="video-badge-status">
                <span class="video-pulse-dot"></span>
                {{ streamingStatusText }}
              </span>
            </div>

            <!-- Floating Bottom Stats Bar -->
            <div class="video-overlay-bottom">
              <div class="video-stat-col">
                <span class="v-stat-sub">Bắt đầu phát</span>
                <span class="v-stat-main">{{ test.videoTimeToPlay ? test.videoTimeToPlay.toFixed(0) + " ms" : "..." }}</span>
              </div>
              <div class="video-stat-col">
                <span class="v-stat-sub">Tốc độ video</span>
                <span class="v-stat-main">{{ streamingThroughputText }}</span>
              </div>
              <div class="video-stat-col">
                <span class="v-stat-sub">Số lần đệm</span>
                <span class="v-stat-main">{{ test.videoRebufferCount || 0 }} lần</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── STAGE: CALCULATING QOE OVERALL SCORE ────────────────────── -->
        <div v-else-if="test.stage === STAGE.CALCULATING" class="stage-view-card calculating-card">
          <div class="calculating-spinner">
            <div class="calculating-ring"></div>
            <div class="calculating-label">QoE</div>
          </div>
          <div class="calculating-title">Đang tổng hợp điểm số chất lượng mạng...</div>
          <div class="calculating-desc">Tính toán đa chiều theo chuẩn trải nghiệm người dùng thực tế</div>
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

.browser-viewport {
  position: relative;
  width: 100%;
  height: 180px;
  background: #0d0e11;
  overflow: hidden;
}

.browser-iframe {
  width: 100%;
  height: 100%;
  border: none;
  opacity: 0.25;
  filter: grayscale(0.5);
  pointer-events: none;
}

.browser-viewport-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-3);
  background: radial-gradient(circle at center, rgba(24, 25, 29, 0.7) 0%, rgba(13, 14, 17, 0.95) 100%);
}

.viewport-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
}

.viewport-icon {
  font-size: 1.8rem;
  margin-bottom: 2px;
}

.viewport-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text, #fff);
}

.viewport-time {
  display: flex;
  align-items: baseline;
  gap: 2px;
  color: var(--brand-primary, #ff7a00);
}

.v-time-number {
  font-family: var(--font-numeric);
  font-size: 1.7rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.v-time-unit {
  font-size: 0.85rem;
  font-weight: 600;
}

.viewport-hint {
  font-size: 0.74rem;
  color: var(--text-muted, #727682);
}

.browsing-sites-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}

.strip-pill {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--surface, #18191d);
  border: 1px solid var(--border, #2b2e38);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.72rem;
  min-width: 0;
}

.strip-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted, #727682);
  flex-shrink: 0;
}

.strip-success .strip-pill-dot {
  background: #27c93f;
}

.strip-error .strip-pill-dot {
  background: #ff5f56;
}

.strip-pill-name {
  color: var(--text-secondary, #a0a4b0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.strip-pill-val {
  margin-left: auto;
  font-family: var(--font-numeric);
  font-weight: 600;
  color: var(--text, #fff);
}

/* ── Live Video Streaming Player ───────────────────────────────────── */
.video-playback-card {
  width: 100%;
}

.video-player-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border-strong, #363945);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.video-testing-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
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

@keyframes pulse-dot {
  0% { transform: scale(0.9); opacity: 0.6; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.6; }
}

.video-overlay-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 8px 12px;
  background: linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 70%, transparent 100%);
  pointer-events: none;
  z-index: 5;
}

.video-stat-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.v-stat-sub {
  font-size: 0.65rem;
  color: var(--text-muted, #8b909f);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.v-stat-main {
  font-family: var(--font-numeric);
  font-size: 0.85rem;
  font-weight: 700;
  color: #fff;
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
