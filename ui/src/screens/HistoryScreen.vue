<script setup>
import { computed, ref } from "vue";
import { clearHistory, history, syncState, toCsv, toXlsx } from "../state/history.js";
import { XLSX_MIME } from "../report/xlsx.js";
import { saveFile } from "../report/share.js";
import { goBack } from "../state/ui.js";
import { useI18n } from "../i18n/index.js";
import HistoryDetailModal from "../components/HistoryDetailModal.vue";
import ExportModal from "../components/ExportModal.vue";


const { t, locale } = useI18n();

/* Modal state for viewing item details */
const selectedEntry = ref(null);

function openDetails(entry) {
  selectedEntry.value = entry;
}

function closeDetails() {
  selectedEntry.value = null;
}

/* Sync queue status text */
const syncLabel = computed(() => {
  const s = syncState.value;
  if (s.waitingForEndpoint) {
    return s.pending > 0 ? t("sync.storedLocally", { count: s.pending }) : "";
  }
  if (s.pending > 0) return t("sync.pending", { count: s.pending });
  if (s.sent > 0) return t("sync.allSent");
  return "";
});

const confirming = ref(false);
const exportFailed = ref(false);

/* Network filter */
const selectedFilter = ref("all");

const filterOptions = computed(() => {
  const types = new Set();
  for (const item of history.value) {
    if (item.connection) types.add(item.connection);
  }
  return ["all", ...Array.from(types)];
});

/* Enriched history items with date/time formatting */
const enriched = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 86400000);

  return history.value.map((entry) => {
    const at = new Date(entry.at);
    const day = new Date(at);
    day.setHours(0, 0, 0, 0);
    let dayLabel;
    if (day.getTime() === today.getTime()) dayLabel = t("history.today");
    else if (day.getTime() === yesterday.getTime()) dayLabel = t("history.yesterday");
    else dayLabel = at.toLocaleDateString(locale.value);

    return {
      ...entry,
      dayKey: day.toISOString(),
      dayLabel,
      timeLabel: at.toLocaleTimeString(locale.value, {
        hour: "2-digit",
        minute: "2-digit"
      })
    };
  });
});

/* Filtered by network type */
const filtered = computed(() => {
  if (selectedFilter.value === "all") return enriched.value;
  return enriched.value.filter((item) => item.connection === selectedFilter.value);
});

/* Limit for long lists */
const PAGE_SIZE = 10;
const displayLimit = ref(PAGE_SIZE);

const visibleEntries = computed(() => {
  return filtered.value.slice(0, displayLimit.value);
});

const hasMore = computed(() => filtered.value.length > displayLimit.value);
const remainingCount = computed(() => filtered.value.length - displayLimit.value);

function loadMore() {
  displayLimit.value += PAGE_SIZE;
}

function showAll() {
  displayLimit.value = filtered.value.length;
}

function collapseList() {
  displayLimit.value = PAGE_SIZE;
}

/* Group visible entries by date */
const groupedByDate = computed(() => {
  const groups = [];
  const map = new Map();

  for (const entry of visibleEntries.value) {
    const key = entry.dayLabel;
    if (!map.has(key)) {
      const group = { dayLabel: key, items: [] };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).items.push(entry);
  }
  return groups;
});

const showExportModal = ref(false);
const exportType = ref("xlsx");
const exportSuccessMsg = ref("");

function openExport(type) {
  exportType.value = type || "xlsx";
  showExportModal.value = true;
}

function closeExport() {
  showExportModal.value = false;
}

function showSavedToast(filename) {
  exportSuccessMsg.value = t("export.savedSuccess", { filename });
  setTimeout(() => {
    exportSuccessMsg.value = "";
  }, 4000);
}

/*
  One press on the toolbar tries the direct route and opens the sheet when
  there is not one. The route choice itself lives in report/share.js: it used
  to be spelled out again here, with the base64 .xlsx mistake in it, and two
  copies of a rule this subtle is one copy too many.
*/
async function exportAs(type) {
  const csv = type === "csv";
  const text = csv ? "\uFEFF" + toCsv() : null;
  const res = await saveFile({
    blob: csv
      ? new Blob([text], { type: "text/csv;charset=utf-8" })
      : new Blob([toXlsx()], { type: XLSX_MIME }),
    filename: csv ? "speedtest-history.csv" : "speedtest-history.xlsx",
    mime: csv ? "text/csv" : XLSX_MIME,
    bridgeText: text
  });

  if (res.ok) {
    if (res.route === "bridge") showSavedToast(csv ? "speedtest-history.csv" : "speedtest-history.xlsx");
    return;
  }

  /* Nothing carried the file, so hand the user the sheet, where copy, share
     and the diagnostic are. */
  console.warn("[history] export failed", res);
  openExport(type);
}

function downloadCsv() {
  return exportAs("csv");
}

function downloadXlsx() {
  return exportAs("xlsx");
}



const keptAfterClear = ref(0);
async function doClear() {
  keptAfterClear.value = await clearHistory(false);
  confirming.value = false;
}

function fmtSpeed(value) {
  const v = Number(value || 0);
  if (!(v > 0)) return "0.00";
  if (v < 10) return v.toFixed(2);
  if (v < 1000) return v.toFixed(1);
  return v.toFixed(0);
}
</script>

<template>
  <section class="history">
    <!-- Header with Title and Count -->
    <div class="history-header">
      <div class="header-main">
        <h2 class="section-title">{{ t("history.title") }}</h2>
        <span v-if="history.length" class="history-count-badge">
          {{ t("history.count", { count: history.length }) }}
        </span>
      </div>
      <p v-if="syncLabel" class="sync-line" role="status">{{ syncLabel }}</p>
      <p v-if="keptAfterClear" class="sync-line">{{ t("sync.kept", { count: keptAfterClear }) }}</p>
    </div>

    <!-- Quick Action Bar & Filter Chips when history exists -->
    <div v-if="history.length" class="history-controls">
      <!-- Quick Action Buttons -->
      <div class="quick-actions">
        <button
          type="button"
          class="btn-tool"
          :title="t('action.exportExcel')"
          @click="downloadXlsx"
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
          {{ t("action.exportExcel") }}
        </button>

        <button
          type="button"
          class="btn-tool"
          :title="t('action.exportCsv')"
          @click="downloadCsv"
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
          CSV
        </button>

        <button
          v-if="!confirming"
          type="button"
          class="btn-tool btn-tool-danger"
          :title="t('action.clearHistory')"
          @click="confirming = true"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M2.5 4h11M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4m2 0v9.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          {{ t("action.clearHistory") }}
        </button>
      </div>

      <!-- Network Filter Tabs (shown when multiple types exist) -->
      <div v-if="filterOptions.length > 2" class="filter-tabs">
        <button
          v-for="opt in filterOptions"
          :key="opt"
          type="button"
          class="filter-chip"
          :class="{ active: selectedFilter === opt }"
          @click="selectedFilter = opt"
        >
          {{ opt === "all" ? t("history.filterAll") : opt }}
        </button>
      </div>
    </div>

    <!-- Confirm Clear Box -->
    <div v-if="confirming" class="confirm card">
      <p class="confirm-text">{{ t("history.confirmClear") }}</p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-ghost" @click="confirming = false">
          {{ t("action.cancel") }}
        </button>
        <button type="button" class="btn btn-danger" @click="doClear">
          {{ t("action.clearHistory") }}
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <p v-if="!filtered.length" class="empty card">{{ t("history.empty") }}</p>

    <!-- Grouped History List -->
    <div v-else class="history-list">
      <div v-for="group in groupedByDate" :key="group.dayLabel" class="date-group">
        <div class="date-header">
          <span class="date-label">{{ group.dayLabel }}</span>
          <span class="date-count">{{ t("history.dayCount", { count: group.items.length }) }}</span>
        </div>

        <ul class="entries">
          <li
            v-for="(entry, index) in group.items"
            :key="entry.at + index"
            class="entry-wrapper"
          >
            <button
              type="button"
              class="entry card"
              @click="openDetails(entry)"
            >
              <!-- Card Top Row: Time, Network Chip, Sync Chip, Chevron -->
              <div class="entry-top">
                <div class="entry-badges">
                  <span class="entry-time">{{ entry.timeLabel }}</span>
                  <span v-if="entry.connection" class="entry-chip entry-chip-net">
                    {{ entry.connection }}
                  </span>
                  <span
                    class="entry-chip"
                    :class="entry.status === 'sent' ? 'entry-chip-sent' : 'entry-chip-pending'"
                  >
                    {{ entry.status === "sent" ? t("sync.sent") : t("sync.notSent") }}
                  </span>
                </div>

                <span class="entry-chevron" aria-hidden="true">
                  <svg viewBox="0 0 16 16" focusable="false">
                    <path
                      d="M6 3.5l4.5 4.5L6 12.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
              </div>

              <!-- Card Middle Row: Speed & Latency Metrics -->
              <div class="entry-metrics">
                <div class="metric-item metric-down">
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
                  <span class="metric-val">{{ fmtSpeed(entry.download) }}</span>
                  <span class="metric-unit">{{ t("unit.mbps") }}</span>
                </div>

                <div class="metric-item metric-up">
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
                  <span class="metric-val">{{ fmtSpeed(entry.upload) }}</span>
                  <span class="metric-unit">{{ t("unit.mbps") }}</span>
                </div>

                <div class="metric-item metric-ping">
                  <span class="metric-val">{{ Math.round(entry.ping) }}</span>
                  <span class="metric-unit">{{ t("unit.ms") }}</span>
                </div>
              </div>

              <!-- Card Bottom Row: Server & Location -->
              <div v-if="entry.server || entry.place" class="entry-bottom">
                <span class="entry-server">
                  {{ entry.place ? `${entry.place} • ` : "" }}{{ entry.server }}
                </span>
              </div>
            </button>
          </li>
        </ul>
      </div>

      <!-- Pagination / Load More Controls -->
      <div v-if="hasMore || displayLimit > PAGE_SIZE" class="load-more-bar">
        <button
          v-if="hasMore"
          type="button"
          class="btn btn-ghost btn-block"
          @click="loadMore"
        >
          {{ t("history.loadMore", { count: remainingCount }) }}
        </button>
        <button
          v-if="hasMore"
          type="button"
          class="btn btn-quiet"
          @click="showAll"
        >
          {{ t("history.showAll") }}
        </button>
        <button
          v-if="!hasMore && displayLimit > PAGE_SIZE"
          type="button"
          class="btn btn-quiet"
          @click="collapseList"
        >
          {{ t("history.collapse") }}
        </button>
      </div>
    </div>

    <!-- Toast notification for export success -->
    <transition name="fade">
      <div v-if="exportSuccessMsg" class="export-toast-success" role="status">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3.5 8.5l3 3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ exportSuccessMsg }}</span>
      </div>
    </transition>

    <!-- Bottom Actions / Back -->
    <div class="actions">
      <p v-if="exportFailed" class="export-failed">{{ t("share.blocked") }}</p>
      <button type="button" class="btn btn-ghost btn-block" @click="goBack">
        {{ t("action.back") }}
      </button>
    </div>

    <!-- Detail Modal -->
    <HistoryDetailModal
      v-if="selectedEntry"
      :entry="selectedEntry"
      @close="closeDetails"
    />

    <!-- Export Modal -->
    <ExportModal
      v-if="showExportModal"
      :initial-type="exportType"
      @close="closeExport"
    />
  </section>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
}

.history-header {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.header-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}

.history-count-badge {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  padding: 2px var(--sp-2);
  border-radius: var(--radius-pill);
  font-weight: var(--fw-medium);
}

.sync-line {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin: 0;
}

/* History Controls: Quick Actions & Filter Tabs */
.history-controls {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.btn-tool {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-3);
  min-height: 34px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  cursor: pointer;
  transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
}

.btn-tool svg {
  width: 13px;
  height: 13px;
  flex: none;
}

.btn-tool:hover {
  background: var(--surface-raised);
  border-color: var(--border-strong);
  color: var(--text);
}

.btn-tool-danger {
  color: var(--danger);
  margin-left: auto;
}

.btn-tool-danger:hover {
  background: var(--danger-bg);
  border-color: var(--danger);
}

.filter-tabs {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  overflow-x: auto;
  padding-bottom: 2px;
  -webkit-overflow-scrolling: touch;
}

.filter-chip {
  padding: 3px var(--sp-3);
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast);
}

.filter-chip.active {
  background: var(--brand-tint);
  border-color: var(--brand-primary);
  color: var(--brand-ink);
  font-weight: var(--fw-semibold);
}

.filter-chip:hover:not(.active) {
  background: var(--surface-hover);
  color: var(--text-secondary);
}

.empty {
  color: var(--text-muted);
  text-align: center;
  padding: var(--sp-6) var(--sp-4);
  font-size: var(--fs-sm);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.date-group {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.date-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-1);
}

.date-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

.date-count {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.entry-wrapper {
  margin: 0;
  padding: 0;
}

/* Clickable Entry Card */
.entry {
  width: 100%;
  text-align: left;
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  cursor: pointer;
  position: relative;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.entry:hover {
  background: var(--surface-raised);
  border-color: var(--border-strong);
}

.entry:active {
  transform: scale(0.985);
}

.entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}

.entry-badges {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.entry-time {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--text);
}

.entry-chip {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  background: var(--surface-raised, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-pill);
  padding: 1px var(--sp-2);
  font-weight: var(--fw-medium);
}

.entry-chip-net {
  background: var(--surface-sunken);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.entry-chip-pending {
  color: var(--warning);
  background: var(--warning-tint);
}

.entry-chip-sent {
  color: var(--success);
  background: var(--success-tint);
}

.entry-chevron {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  flex: none;
  transition: transform var(--dur-fast), color var(--dur-fast);
}

.entry:hover .entry-chevron {
  color: var(--brand-primary);
  transform: translateX(2px);
}

.entry-chevron svg {
  width: 14px;
  height: 14px;
}

/* Metrics Row */
.entry-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: baseline;
  gap: var(--sp-2);
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  padding: 2px 0;
}

.metric-item {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  min-width: 0;
}

.metric-item svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
  align-self: center;
}

.metric-val {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
}

.metric-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  text-transform: uppercase;
}

.metric-down {
  color: var(--brand-download);
}

.metric-up {
  color: var(--brand-upload);
}

.metric-ping {
  color: var(--text-secondary);
  justify-content: flex-end;
}

.entry-bottom {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.entry-server {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Load more / Pagination bar */
.load-more-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

.actions .btn-block {
  width: 100%;
}

.export-failed {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sm);
  text-align: center;
}

.confirm {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
}

.confirm-text {
  font-size: var(--fs-sm);
}

.confirm-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
}

.export-toast-success {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 12px 16px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.4);
  border-radius: var(--radius-md);
  color: #34d399;
  font-size: var(--fs-sm);
  font-weight: 500;
  margin: var(--sp-2) 0;
}

.export-toast-success svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>

