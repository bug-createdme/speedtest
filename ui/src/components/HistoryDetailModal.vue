<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "../i18n/index.js";
import { shareSummary, summaryText } from "../report/share.js";

const props = defineProps({
  entry: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(["close"]);
const { t } = useI18n();

const shareState = ref("");
const copiedId = ref(false);

function handleKeydown(e) {
  if (e.key === "Escape") {
    emit("close");
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

const record = computed(() => props.entry.record || {});

function fmtSpeed(value) {
  const v = Number(value || 0);
  if (!(v > 0)) return "0.00";
  if (v < 10) return v.toFixed(2);
  if (v < 1000) return v.toFixed(1);
  return v.toFixed(0);
}

function fmt(value, decimals) {
  return Number(value || 0).toFixed(decimals);
}

function fmtTiming(value) {
  const v = Number(value || 0);
  return v < 10 ? v.toFixed(1) : v.toFixed(0);
}

const isSent = computed(() => props.entry.status === "sent");

const testId = computed(() => record.value.TEST_ID || props.entry.id || "");
const serverName = computed(() => props.entry.server || record.value.SPEED_SERVER_POOL_NAME || t("server.unknown"));
const connectionName = computed(() => props.entry.connection || record.value.NET_NAME || "");
const ispName = computed(() => record.value.ISP || record.value.MOBILE_ISP || "");
const ipAddress = computed(() => record.value.IPV4 || "");

const locationName = computed(() => {
  if (props.entry.place) return props.entry.place;
  if (record.value.LOCATION_AAL1) return record.value.LOCATION_AAL1;
  if (record.value.LOCATION_LAT && record.value.LOCATION_LNG) {
    return `${record.value.LOCATION_LAT.toFixed(4)}, ${record.value.LOCATION_LNG.toFixed(4)}`;
  }
  return "";
});

/* Loaded latency calculations */
const idlePing = computed(() => record.value.SPEED_LATENCY_AVG || props.entry.ping || 0);
const dlLoadedPing = computed(() => record.value.SPEED_DOWNLOAD_LOADED_LATENCY || 0);
const ulLoadedPing = computed(() => record.value.SPEED_UPLOAD_LOADED_LATENCY || 0);
const probeLoss = computed(() => record.value.PROBE_LOSS_PCT);
const probeCount = computed(() => record.value.PROBE_SAMPLES);

const hasLoadedLatency = computed(() => {
  return dlLoadedPing.value > 0 || ulLoadedPing.value > 0 || (probeCount.value && probeCount.value > 0);
});

function getIncrease(loadedVal) {
  if (!(loadedVal > 0) || !(idlePing.value > 0)) return 0;
  const delta = loadedVal - idlePing.value;
  return delta > 0 ? delta : 0;
}

function getSeverity(loadedVal) {
  const delta = getIncrease(loadedVal);
  if (delta >= 100) return "bad";
  if (delta >= 30) return "warn";
  return "ok";
}

/* Web and Video test */
const hasBrowse = computed(() => !!record.value.BROWSE_STATUS && record.value.BROWSE_STATUS !== "Skip");
const hasVideo = computed(() => !!record.value.STREAM_STATUS && record.value.STREAM_STATUS !== "Skip");

const timings = computed(() =>
  [
    { key: "DNS", value: record.value.SETUP_DNS },
    { key: "TCP", value: record.value.SETUP_TCP },
    { key: "TLS", value: record.value.SETUP_TLS },
    { key: "TTFB", value: record.value.SETUP_TTFB }
  ].filter((row) => row.value > 0)
);

const detailsList = computed(() => {
  const list = [
    { key: "server", label: t("server.label"), value: serverName.value },
    { key: "conn", label: t("net.connection"), value: connectionName.value },
    { key: "isp", label: "ISP", value: ispName.value },
    { key: "ip", label: "IP", value: ipAddress.value },
    { key: "place", label: "Khu vực", value: locationName.value }
  ].filter((row) => row.value);

  return list.concat(
    timings.value.map((row) => ({
      key: row.key,
      label: row.key,
      value: fmtTiming(row.value) + " " + t("unit.ms")
    }))
  );
});

async function copyTestId() {
  if (!testId.value) return;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(testId.value);
      copiedId.value = true;
      setTimeout(() => {
        copiedId.value = false;
      }, 2000);
    }
  } catch (e) {
    // Ignore clipboard error
  }
}

async function shareEntry() {
  shareState.value = "";
  const text = summaryText({
    testId: testId.value,
    download: props.entry.download,
    upload: props.entry.upload,
    ping: props.entry.ping,
    server: serverName.value,
    operator: ispName.value,
    place: locationName.value,
    at: props.entry.at ? new Date(props.entry.at).toISOString() : ""
  });

  const how = await shareSummary(text);
  if (how === "clipboard") shareState.value = t("share.copied");
  else if (how === "none") shareState.value = t("share.blocked");
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="sheet card" role="dialog" aria-modal="true" :aria-label="t('history.details')">
      <div class="sheet-handle-bar" aria-hidden="true" @click="emit('close')">
        <span class="sheet-handle"></span>
      </div>

      <div class="sheet-header">
        <div class="header-left">
          <h3 class="sheet-title">{{ t("history.details") }}</h3>
          <div class="header-sub">
            <span class="entry-time-tag">{{ entry.dayLabel }} {{ entry.timeLabel }}</span>
            <span
              class="status-chip"
              :class="isSent ? 'status-chip-sent' : 'status-chip-pending'"
            >
              {{ isSent ? t("sync.sent") : t("sync.notSent") }}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="btn-close"
          :aria-label="t('action.close')"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <div class="sheet-body">
        <!-- Main Speeds Readout -->
        <div class="readouts-card card">
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
            <div class="readout-val-wrap">
              <span class="readout-value">{{ fmtSpeed(entry.download) }}</span>
              <span class="readout-unit">{{ t("unit.mbps") }}</span>
            </div>
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
            <div class="readout-val-wrap">
              <span class="readout-value">{{ fmtSpeed(entry.upload) }}</span>
              <span class="readout-unit">{{ t("unit.mbps") }}</span>
            </div>
          </div>
        </div>

        <!-- Latency & Jitter Grid -->
        <div class="grid-2">
          <div class="metric-mini card">
            <span class="label">{{ t("metric.ping") }}</span>
            <span class="metric-num">
              {{ Math.round(entry.ping) }} <span class="metric-unit">{{ t("unit.ms") }}</span>
            </span>
          </div>
          <div class="metric-mini card">
            <span class="label">{{ t("metric.jitter") }}</span>
            <span class="metric-num">
              {{ Math.round(entry.jitter || 0) }} <span class="metric-unit">{{ t("unit.ms") }}</span>
            </span>
          </div>
        </div>

        <!-- Loaded Latency Section -->
        <section v-if="hasLoadedLatency" class="section-box card">
          <h4 class="box-title">{{ t("loaded.title") }}</h4>
          <p class="box-desc">{{ t("loaded.explain") }}</p>

          <div class="info-row">
            <span class="info-label">{{ t("loaded.idle") }}</span>
            <span class="info-value">{{ fmt(idlePing, 0) }} {{ t("unit.ms") }}</span>
          </div>

          <div v-if="dlLoadedPing > 0" class="info-row">
            <span class="info-label">{{ t("loaded.download") }}</span>
            <span class="info-value">
              {{ fmt(dlLoadedPing, 0) }} {{ t("unit.ms") }}
              <em class="delta" :class="'delta-' + getSeverity(dlLoadedPing)">
                {{ t("loaded.increase", { value: fmt(getIncrease(dlLoadedPing), 0) }) }}
              </em>
            </span>
          </div>

          <div v-if="ulLoadedPing > 0" class="info-row">
            <span class="info-label">{{ t("loaded.upload") }}</span>
            <span class="info-value">
              {{ fmt(ulLoadedPing, 0) }} {{ t("unit.ms") }}
              <em class="delta" :class="'delta-' + getSeverity(ulLoadedPing)">
                {{ t("loaded.increase", { value: fmt(getIncrease(ulLoadedPing), 0) }) }}
              </em>
            </span>
          </div>

          <div v-if="probeCount > 0" class="info-row">
            <span class="info-label">{{ t("loaded.loss") }}</span>
            <span class="info-value">{{ fmt(probeLoss || 0, 2) }} {{ t("unit.percent") }}</span>
          </div>
        </section>

        <!-- Web & Video Section -->
        <section v-if="hasBrowse || hasVideo" class="section-box card">
          <div v-if="hasBrowse" class="info-row">
            <span class="info-label">{{ t("metric.browse") }}</span>
            <span class="info-value">
              {{ t("browse.result", { bytes: Math.round((record.BROWSE_BYTES || 0) / 1000), time: Math.round(record.BROWSE_TIME || 0) }) }}
            </span>
          </div>
          <div v-if="hasVideo && record.STREAM_PRELOADING_TIME" class="info-row">
            <span class="info-label">{{ t("video.timeToPlay") }}</span>
            <span class="info-value">{{ fmt(record.STREAM_PRELOADING_TIME, 0) }} {{ t("unit.ms") }}</span>
          </div>
          <div v-if="hasVideo && record.STREAM_REBUFFERING_TIME !== null" class="info-row">
            <span class="info-label">{{ t("video.rebuffering") }}</span>
            <span class="info-value">{{ fmt(record.STREAM_REBUFFERING_TIME, 0) }} {{ t("unit.ms") }}</span>
          </div>
        </section>

        <!-- Details List -->
        <dl class="details card">
          <div v-for="item in detailsList" :key="item.key" class="detail-row">
            <dt class="label">{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
          <div v-if="testId" class="detail-row detail-id-row">
            <dt class="label">{{ t("result.testId") }}</dt>
            <dd class="id-wrapper">
              <code class="test-id">{{ testId }}</code>
              <button
                type="button"
                class="btn-copy-id"
                :title="t('action.copyId')"
                @click="copyTestId"
              >
                {{ copiedId ? t("action.copied") : t("action.copyId") }}
              </button>
            </dd>
          </div>
        </dl>
      </div>

      <div class="sheet-footer">
        <button type="button" class="btn btn-primary btn-block" @click="shareEntry">
          {{ t("action.share") }}
        </button>
        <p v-if="shareState" class="share-state" role="status">{{ shareState }}</p>
        <button type="button" class="btn btn-ghost btn-block" @click="emit('close')">
          {{ t("action.close") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: backdrop-fade 200ms ease-out;
}

@keyframes backdrop-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.sheet {
  width: 100%;
  max-width: var(--content-max);
  max-height: 88vh;
  max-height: 88dvh;
  display: flex;
  flex-direction: column;
  background: var(--surface-raised, #232833);
  border: 1px solid var(--border-strong, #3d4553);
  border-bottom: none;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: sheet-slide-up 240ms cubic-bezier(0.2, 0.9, 0.3, 1);
}

@keyframes sheet-slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.sheet-handle-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: var(--sp-2) 0 0;
  cursor: pointer;
}

.sheet-handle {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--track, rgba(255, 255, 255, 0.2));
}

.sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-4) var(--sp-3);
  border-bottom: 1px solid var(--border);
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-title {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  color: var(--text);
}

.header-sub {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.entry-time-tag {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}

.status-chip {
  font-size: var(--fs-xs);
  padding: 1px var(--sp-2);
  border-radius: var(--radius-pill);
  font-weight: var(--fw-semibold);
}

.status-chip-pending {
  color: var(--warning);
  background: var(--warning-tint);
}

.status-chip-sent {
  color: var(--success);
  background: var(--success-tint);
}

.btn-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  flex: none;
  transition: background var(--dur-fast), color var(--dur-fast);
}

.btn-close:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.btn-close svg {
  width: 18px;
  height: 18px;
}

.sheet-body {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.readouts-card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  background: var(--surface);
}

.readout {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-3) var(--sp-4);
  min-width: 0;
}

.readout-upload {
  border-left: 1px solid var(--border);
}

.readout-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

.readout-label svg {
  width: 0.85rem;
  height: 0.85rem;
}

.readout-download .readout-label {
  color: var(--brand-download);
}

.readout-upload .readout-label {
  color: var(--brand-upload);
}

.readout-val-wrap {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
}

.readout-value {
  font-family: var(--font-numeric);
  font-size: clamp(1.75rem, 8vw, 2.25rem);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  line-height: var(--lh-tight);
}

.readout-unit {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  font-weight: var(--fw-medium);
  text-transform: uppercase;
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2);
}

.metric-mini {
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--surface);
}

.metric-num {
  font-family: var(--font-numeric);
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}

.metric-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-normal);
  color: var(--text-muted);
}

.section-box {
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  background: var(--surface);
}

.box-title {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--text);
}

.box-desc {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  line-height: var(--lh-normal);
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
}

.info-label {
  color: var(--text-secondary);
}

.info-value {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semibold);
  text-align: right;
}

.delta {
  font-style: normal;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  margin-left: var(--sp-1);
  padding: 0 var(--sp-1);
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
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  background: var(--surface);
  margin: 0;
}

.detail-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
}

.detail-row dd {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  text-align: right;
  overflow-wrap: anywhere;
}

.detail-id-row {
  border-top: 1px solid var(--border);
  padding-top: var(--sp-2);
  margin-top: var(--sp-1);
}

.id-wrapper {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.test-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  background: var(--surface-sunken);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  color: var(--brand-ink);
  user-select: all;
}

.btn-copy-id {
  font-size: var(--fs-xs);
  color: var(--brand-ink);
  background: var(--brand-tint);
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  padding: 2px 8px;
  cursor: pointer;
  font-weight: var(--fw-semibold);
}

.btn-copy-id:hover {
  background: var(--brand-primary);
  color: #fff;
}

.sheet-footer {
  padding: var(--sp-3) var(--sp-4) calc(env(safe-area-inset-bottom, 0px) + var(--sp-3));
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.share-state {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
}
</style>
