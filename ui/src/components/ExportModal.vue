<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "../i18n/index.js";
import { history, toCsv, toTsv, toXlsx } from "../state/history.js";
import { copyToClipboard, downloadFile, saveFile, shareSummary } from "../report/share.js";
import { XLSX_MIME } from "../report/xlsx.js";
import { isSuperApp, probeExportRoutes } from "../bridge/windvane.js";

const props = defineProps({
  initialType: {
    type: String,
    default: "xlsx"
  }
});

const emit = defineEmits(["close"]);
const { t } = useI18n();

const activeTab = ref(props.initialType === "csv" ? "csv" : "xlsx");
const copyFeedback = ref("");
const shareFeedback = ref("");
const downloadMsg = ref("");
const showPreview = ref(false);

const recordCount = computed(() => history.value.length);
const inSuperApp = computed(() => isSuperApp());

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

const currentTextData = computed(() => {
  return activeTab.value === "xlsx" ? toTsv() : toCsv();
});

const previewSnippet = computed(() => {
  const text = currentTextData.value || "";
  const lines = text.split("\n");
  if (lines.length <= 8) return text;
  return lines.slice(0, 8).join("\n") + "\n" + t("export.moreLines", { count: lines.length - 8 });
});

/*
  The two files, built once per press rather than held in state.

  A CSV always carries the byte-order mark. Without it Excel reads the file as
  the machine's ANSI code page and every Lao and Vietnamese name in it comes
  back as mojibake - and this used to be added on the bridge route and omitted
  on the download route, so the same export was correct or corrupt depending on
  which button reached it.
*/
function buildFile() {
  if (activeTab.value === "xlsx") {
    return {
      filename: "speedtest-history.xlsx",
      blob: new Blob([toXlsx()], { type: XLSX_MIME }),
      mime: XLSX_MIME,
      /* No bridgeText: a .xlsx is a ZIP, and WVFile.write stores strings.
         See saveFile() in report/share.js. */
      bridgeText: null
    };
  }
  const text = "﻿" + toCsv();
  return {
    filename: "speedtest-history.csv",
    blob: new Blob([text], { type: "text/csv;charset=utf-8" }),
    mime: "text/csv",
    bridgeText: text
  };
}

async function doCopy() {
  const text = currentTextData.value;
  const ok = await copyToClipboard(text);
  if (ok) {
    copyFeedback.value =
      activeTab.value === "xlsx"
        ? t("export.copiedExcel")
        : t("export.copiedCsv");
    setTimeout(() => {
      copyFeedback.value = "";
    }, 2800);
  }
}

const saveFeedback = ref("");
const saving = ref(false);

/*
  Why the failure gets its own wording per reason.

  "Could not save the file" sent every Android user to the same dead end. The
  reasons are not the same problem and do not have the same answer: a format
  the container cannot carry means "use CSV", a container that refused the
  write means "send the diagnostic", and a run outside the super-app means the
  ordinary download button.
*/
function saveErrorText(res) {
  if (res.reason === "binary-no-bridge-route") return t("export.savedErrorBinary");
  /* The container granting nothing is not a fault the user or this app can
     clear, so the wording sends them to the workaround rather than to a retry
     that will refuse identically every time. */
  if (res.reason === "unauthorized") return t("export.savedErrorUnauthorized");
  if (res.reason === "unsupported") return t("export.savedErrorUnsupported");
  if (res.reason === "truncated") return t("export.savedErrorTruncated");
  if (res.reason === "network" || String(res.reason || "").startsWith("http-")) {
    return t("export.savedErrorUpload");
  }
  return t("export.savedError");
}

async function doSaveToDevice() {
  if (saving.value) return;
  saving.value = true;
  saveFeedback.value = "";
  downloadMsg.value = "";

  const file = buildFile();
  let res;
  try {
    res = await saveFile(file);
  } catch (e) {
    console.warn("[ExportModal] saveFile threw", e);
    res = { ok: false, route: "none", reason: "threw" };
  }
  saving.value = false;

  if (res.ok) {
    /* The share sheet has already told the user what happened; a write to
       storage and an upload each need their own confirmation, because nothing
       else says so - and the upload one has to say the data left the handset,
       which is not something to discover later. */
    if (res.route === "bridge") {
      saveFeedback.value = t("export.savedSuccess", { filename: file.filename });
    } else if (res.route === "link") {
      const minutes = Math.max(1, Math.round((res.detail?.expiresIn || 0) / 60));
      saveFeedback.value = t("export.linkShared", { minutes });
    } else {
      saveFeedback.value = t("export.shared");
    }
    setTimeout(() => {
      saveFeedback.value = "";
    }, 6000);
    return;
  }

  console.warn("[ExportModal] save failed", res);
  downloadMsg.value = saveErrorText(res);
  setTimeout(() => {
    downloadMsg.value = "";
  }, 6000);
}

async function doShareText() {
  shareFeedback.value = "";
  const text = currentTextData.value;
  const res = await shareSummary(text);
  if (res !== "none") {
    shareFeedback.value = t("export.shared");
    setTimeout(() => {
      shareFeedback.value = "";
    }, 2500);
  }
}



function doDownload() {
  downloadMsg.value = "";
  const file = buildFile();
  const ok = !inSuperApp.value && downloadFile(file.blob, file.filename);
  if (!ok) {
    downloadMsg.value = t("export.downloadBlocked");
    setTimeout(() => {
      downloadMsg.value = "";
    }, 3500);
  }
}

/*
  The diagnostic.

  Here rather than in a developer build because the device that fails is not
  the device anyone debugs on: it is a surveyor's handset, in the field, in a
  container nobody here can reproduce. One press, one screenshot, and the
  question "which route does this Android actually have" is answered - see
  probeExportRoutes in bridge/windvane.js.
*/
const showDiag = ref(false);
const diagRunning = ref(false);
const diagReport = ref("");

async function doDiagnose() {
  showDiag.value = true;
  diagRunning.value = true;
  diagReport.value = "";
  try {
    diagReport.value = JSON.stringify(await probeExportRoutes(), null, 1);
  } catch (e) {
    diagReport.value = String((e && e.message) || e);
  }
  diagRunning.value = false;
}

async function copyDiag() {
  if (!diagReport.value) return;
  if (await copyToClipboard(diagReport.value)) {
    copyFeedback.value = t("export.copiedDiag");
    setTimeout(() => {
      copyFeedback.value = "";
    }, 2800);
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div
      class="sheet"
      role="dialog"
      aria-modal="true"
      :aria-label="t('export.title')"
    >
      <!-- Drag handle indicator for bottom sheet UI -->
      <div class="sheet-handle-bar" @click="emit('close')">
        <div class="sheet-handle"></div>
      </div>

      <!-- Header -->
      <div class="sheet-header">
        <div class="header-left">
          <h3 class="sheet-title">{{ t("export.title") }}</h3>
          <span class="header-sub">
            {{ t("export.count", { count: recordCount }) }}
          </span>
        </div>
        <button
          type="button"
          class="btn-close"
          :title="t('action.close')"
          @click="emit('close')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <!-- Format Tabs -->
      <div class="export-tabs">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'xlsx' }"
          @click="activeTab = 'xlsx'"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3 2.5A1.5 1.5 0 0 1 4.5 1h7A1.5 1.5 0 0 1 13 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5v-11zM8 5v6m-3-3h6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          {{ t("export.tabExcel") }}
        </button>

        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'csv' }"
          @click="activeTab = 'csv'"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M4 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm2 3h4M6 8h4M6 11h2"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          {{ t("export.tabCsv") }}
        </button>
      </div>

      <!-- Body Content -->
      <div class="sheet-body">
        <!-- Notice box for mobile SuperApp environment -->
        <div class="notice-card card">
          <div class="notice-icon">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
              <path d="M8 4.5v4m0 2.5h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <p class="notice-text">
            {{ t("export.noticeApp") }}
          </p>
        </div>

        <!-- Action Buttons -->
        <div class="action-grid">
          <!-- Save to device: share sheet on iOS, WVFile.write in the Android
               container, <a download> on the plain web. saveFile() picks. -->
          <button
            type="button"
            class="btn-action btn-save"
            :disabled="saving"
            @click="doSaveToDevice"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M2.5 1.5A1.5 1.5 0 0 0 1 3v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V5.414a1.5 1.5 0 0 0-.44-1.06l-2.914-2.914A1.5 1.5 0 0 0 9.586 1H2.5zm1 1h6v3h-6v-3zm0 5h9v6h-9v-6z" fill="currentColor"/>
            </svg>
            <span class="btn-text">
              {{ saving ? t("export.saving") : t("export.saveToDevice") }}
              ({{ activeTab === 'xlsx' ? '.xlsx' : '.csv' }})
            </span>
          </button>

          <!-- Copy Button (Primary) -->
          <button
            type="button"
            class="btn-action btn-copy"
            @click="doCopy"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="5" y="5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
              <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" fill="none" stroke="currentColor" stroke-width="1.6"/>
            </svg>
            <span class="btn-text">
              {{ activeTab === 'xlsx' ? t("export.copyForExcel") : t("export.copyCsv") }}
            </span>
          </button>

          <!-- Send as text message -->
          <button
            type="button"
            class="btn-action btn-share"
            @click="doShareText"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M4 8.5v4a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5v-4M8 1.5v8m-3-5l3-3 3 3"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="btn-text">{{ t("export.shareText") }}</span>
          </button>

          <!-- Direct Download (Web fallback) -->
          <button
            type="button"
            class="btn-action btn-download"
            @click="doDownload"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M8 2v8m-3-3l3 3 3-3M3 13.5h10"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="btn-text">
              {{ t("export.downloadFile") }} ({{ activeTab === 'xlsx' ? '.xlsx' : '.csv' }})
            </span>
          </button>
        </div>

        <!-- Feedback Alert Messages -->
        <transition name="fade">
          <div v-if="saveFeedback" class="feedback-banner feedback-success" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>{{ saveFeedback }}</span>
          </div>
        </transition>

        <transition name="fade">
          <div v-if="copyFeedback" class="feedback-banner feedback-success" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>{{ copyFeedback }}</span>
          </div>
        </transition>

        <transition name="fade">
          <div v-if="shareFeedback" class="feedback-banner feedback-info" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>{{ shareFeedback }}</span>
          </div>
        </transition>

        <transition name="fade">
          <div v-if="downloadMsg" class="feedback-banner feedback-warn" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>
              <path d="M8 4.5v4m0 2.5h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <span>{{ downloadMsg }}</span>
          </div>
        </transition>

        <!-- Preview Section -->
        <div class="preview-box card">
          <button
            type="button"
            class="preview-toggle"
            @click="showPreview = !showPreview"
          >
            <span class="preview-label">
              {{ t("export.preview") }} ({{ recordCount }} {{ t("history.dayCount", { count: recordCount }) }})
            </span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
              class="chevron"
              :class="{ open: showPreview }"
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div v-if="showPreview" class="preview-content">
            <pre class="preview-code"><code>{{ previewSnippet }}</code></pre>
          </div>
        </div>

        <!-- Which export routes this handset actually has. Only useful inside
             the super-app, which is the only place they are in doubt. -->
        <div v-if="inSuperApp" class="preview-box card">
          <button
            type="button"
            class="preview-toggle"
            @click="showDiag ? (showDiag = false) : doDiagnose()"
          >
            <span class="preview-label">{{ t("export.diagnose") }}</span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
              class="chevron"
              :class="{ open: showDiag }"
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <div v-if="showDiag" class="preview-content">
            <p v-if="diagRunning" class="diag-status">{{ t("export.diagRunning") }}</p>
            <template v-else>
              <pre class="preview-code diag-code"><code>{{ diagReport }}</code></pre>
              <button type="button" class="diag-copy" @click="copyDiag">
                {{ t("export.copyDiag") }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="sheet-footer">
        <button
          type="button"
          class="btn btn-ghost btn-block"
          @click="emit('close')"
        >
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
  max-width: var(--content-max, 460px);
  max-height: 90vh;
  max-height: 90dvh;
  display: flex;
  flex-direction: column;
  background: var(--surface-raised, #232833);
  border: 1px solid var(--border-strong, #3d4553);
  border-bottom: none;
  border-radius: var(--radius-xl, 20px) var(--radius-xl, 20px) 0 0;
  box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.5));
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
  padding: var(--sp-2, 8px) 0 0;
  cursor: pointer;
}

.sheet-handle {
  width: 36px;
  height: 4px;
  border-radius: var(--radius-pill, 9999px);
  background: var(--track, rgba(255, 255, 255, 0.2));
}

.sheet-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3, 12px);
  padding: var(--sp-2, 8px) var(--sp-4, 16px) var(--sp-3, 12px);
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-title {
  font-size: var(--fs-lg, 18px);
  font-weight: var(--fw-bold, 700);
  color: var(--text, #ffffff);
  margin: 0;
}

.header-sub {
  font-size: var(--fs-xs, 12px);
  color: var(--text-muted, #9aa2b1);
}

.btn-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted, #9aa2b1);
  cursor: pointer;
  transition: all 150ms ease;
}

.btn-close:hover {
  color: var(--text, #ffffff);
  background: rgba(255, 255, 255, 0.12);
}

.btn-close svg {
  width: 14px;
  height: 14px;
}

/* Tabs */
.export-tabs {
  display: flex;
  padding: var(--sp-2, 8px) var(--sp-4, 16px);
  gap: var(--sp-2, 8px);
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  background: rgba(0, 0, 0, 0.15);
}

.tab-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: var(--fs-sm, 13px);
  font-weight: 600;
  color: var(--text-muted, #9aa2b1);
  background: transparent;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: var(--radius-md, 10px);
  cursor: pointer;
  transition: all 180ms ease;
}

.tab-btn svg {
  width: 14px;
  height: 14px;
}

.tab-btn.active {
  color: #ffffff;
  background: var(--primary, #e30613);
  border-color: var(--primary, #e30613);
  box-shadow: 0 2px 8px rgba(227, 6, 19, 0.35);
}

/* Body */
.sheet-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--sp-4, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3, 12px);
}

.notice-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: rgba(255, 170, 0, 0.08);
  border: 1px solid rgba(255, 170, 0, 0.25);
  border-radius: var(--radius-md, 10px);
}

.notice-icon {
  color: #ffaa00;
  flex-shrink: 0;
  margin-top: 2px;
}

.notice-icon svg {
  width: 16px;
  height: 16px;
}

.notice-text {
  font-size: var(--fs-xs, 12px);
  line-height: 1.45;
  color: #ffda85;
  margin: 0;
}

/* Action buttons */
.action-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-action {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 13px 16px;
  font-size: var(--fs-sm, 14px);
  font-weight: 600;
  border-radius: var(--radius-md, 10px);
  cursor: pointer;
  transition: all 160ms ease;
  border: 1px solid transparent;
}

.btn-action svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.btn-save {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
}

.btn-save:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.btn-save:active {
  transform: translateY(0);
}

.btn-copy {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
}

.btn-copy:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.btn-copy:active {
  transform: translateY(0);
}

.btn-share {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: var(--text, #ffffff);
}

.btn-share:hover {
  background: rgba(255, 255, 255, 0.14);
}

.btn-download {
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  color: var(--text-muted, #9aa2b1);
  font-size: var(--fs-xs, 12px);
  padding: 10px 14px;
}

.btn-download:hover {
  border-color: rgba(255, 255, 255, 0.4);
  color: var(--text, #ffffff);
}

/* Feedback banners */
.feedback-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-sm, 8px);
  font-size: var(--fs-xs, 12px);
  font-weight: 500;
}

.feedback-banner svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.feedback-success {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
}

.feedback-info {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #60a5fa;
}

.feedback-warn {
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fbbf24;
}

/* Preview Box */
.preview-box {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: var(--radius-md, 10px);
  overflow: hidden;
}

.preview-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: transparent;
  border: none;
  color: var(--text-muted, #9aa2b1);
  font-size: var(--fs-xs, 12px);
  cursor: pointer;
}

.preview-toggle:hover {
  color: var(--text, #ffffff);
}

.chevron {
  width: 14px;
  height: 14px;
  transition: transform 180ms ease;
}

.chevron.open {
  transform: rotate(180deg);
}

.preview-content {
  padding: 0 14px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.preview-code {
  margin: 8px 0 0;
  padding: 10px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  color: #d1d5db;
  overflow-x: auto;
  white-space: pre;
  max-height: 130px;
}

.diag-code {
  max-height: 220px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diag-status {
  margin: 8px 0 0;
  font-size: var(--fs-xs, 12px);
  color: var(--text-muted, #9aa2b1);
}

.diag-copy {
  width: 100%;
  margin-top: 8px;
  padding: 8px 12px;
  font-size: var(--fs-xs, 12px);
  font-weight: 600;
  color: var(--text, #ffffff);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--radius-sm, 8px);
  cursor: pointer;
}

.btn-action:disabled {
  opacity: 0.6;
  cursor: default;
  transform: none;
  filter: none;
}

/* Footer */
.sheet-footer {
  padding: var(--sp-3, 12px) var(--sp-4, 16px) var(--sp-4, 16px);
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  background: var(--surface-raised, #232833);
}

.btn-block {
  width: 100%;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
