<script setup>
import { computed, ref } from "vue";
import { clearHistory, history, syncState, toCsv, toXlsx } from "../state/history.js";
import { XLSX_MIME } from "../report/xlsx.js";
import { shareFile } from "../report/share.js";
import { goBack } from "../state/ui.js";
import { useI18n } from "../i18n/index.js";

const { t, locale } = useI18n();

/*
  What the queue is doing, in one line.

  Worth showing rather than hiding: a surveyor out of coverage needs to know
  their morning's work is held and will go up, not wonder whether it vanished.
  While no server endpoint is configured this says so plainly instead of
  pretending to sync.
*/
const syncLabel = computed(() => {
  const s = syncState.value;
  if (s.waitingForEndpoint) {
    return s.pending > 0 ? t("sync.storedLocally", { count: s.pending }) : "";
  }
  if (s.pending > 0) return t("sync.pending", { count: s.pending });
  if (s.sent > 0) return t("sync.allSent");
  return "";
});

/* Two-step inline confirm rather than window.confirm(): same reason the error
   screen exists - a native dialog in a WebView is unstyled and untranslatable. */
const confirming = ref(false);

/* Set when both the share sheet and the download refused, which is a real
   outcome in a locked-down WebView and must not look like success. */
const exportFailed = ref(false);

const grouped = computed(() => {
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
      dayLabel,
      timeLabel: at.toLocaleTimeString(locale.value, {
        hour: "2-digit",
        minute: "2-digit"
      })
    };
  });
});

/*
  Hand a file to the user.

  Share sheet first, download second. A mini-app WebView often refuses an
  <a download> outright, and the whole export is worthless if the file cannot
  leave the handset - so the platform's own share sheet is tried first, where it
  will take a file. See report/share.js: the super-app bridge is no help for
  this particular case, because neither of its share methods accepts a file.
*/
async function save(blob, filename, mime) {
  const how = await shareFile(blob, filename, mime);
  /* "none" means both routes refused. Saying so beats a button that looks like
     it worked. */
  exportFailed.value = how === "none";
}

function downloadCsv() {
  save(new Blob([toCsv()], { type: "text/csv;charset=utf-8" }), "speedtest-history.csv", "text/csv");
}

/*
  The spreadsheet the partner actually opens. Same records and same columns as
  the CSV; what differs is that every cell carries its type, so Excel cannot
  rewrite a subscriber number or a timestamp on the way in.
*/
function downloadXlsx() {
  save(new Blob([toXlsx()], { type: XLSX_MIME }), "speedtest-history.xlsx", XLSX_MIME);
}

/*
  Deletes what the server already has and KEEPS what it does not.

  Clearing used to mean losing measurements that had never reached anyone. The
  count of what survived is reported back so the user sees that rather than
  assuming the list failed to clear.
*/
const keptAfterClear = ref(0);
async function doClear() {
  keptAfterClear.value = await clearHistory(false);
  confirming.value = false;
}

/* Same digit budget as the gauge and the result screen. */
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
    <h2 class="section-title">{{ t("history.title") }}</h2>
    <p v-if="syncLabel" class="sync-line" role="status">{{ syncLabel }}</p>
    <p v-if="keptAfterClear" class="sync-line">{{ t("sync.kept", { count: keptAfterClear }) }}</p>

    <p v-if="!grouped.length" class="empty card">{{ t("history.empty") }}</p>

    <ul v-else class="entries">
      <li v-for="(entry, index) in grouped" :key="entry.at + index" class="entry card">
        <div class="entry-when">
          <span class="entry-day">{{ entry.dayLabel }}</span>
          <span class="entry-time">{{ entry.timeLabel }}</span>
        </div>

        <div class="entry-metrics">
          <span class="entry-metric metric-down">
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
            {{ fmtSpeed(entry.download) }}
          </span>
          <span class="entry-metric metric-up">
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
            {{ fmtSpeed(entry.upload) }}
          </span>
          <span class="entry-metric metric-ping">
            {{ Math.round(entry.ping) }} <span class="entry-unit">{{ t("unit.ms") }}</span>
          </span>
        </div>

        <p class="entry-meta">
          <!-- Connection type was stored from the first version and never
               shown; the specification asks for it in this list. -->
          <span v-if="entry.connection" class="entry-chip">{{ entry.connection }}</span>
          <span v-if="entry.place" class="entry-chip">{{ entry.place }}</span>
          <span v-if="entry.status !== 'sent'" class="entry-chip entry-chip-pending">
            {{ t("sync.notSent") }}
          </span>
          <span v-if="entry.server" class="entry-server">{{ entry.server }}</span>
        </p>
      </li>
    </ul>

    <div class="actions">
      <p v-if="exportFailed" class="export-failed">{{ t("share.blocked") }}</p>
      <button
        v-if="grouped.length"
        type="button"
        class="btn btn-ghost btn-block"
        @click="downloadXlsx"
      >
        {{ t("action.exportExcel") }}
      </button>
      <button
        v-if="grouped.length"
        type="button"
        class="btn btn-ghost btn-block"
        @click="downloadCsv"
      >
        {{ t("action.exportCsv") }}
      </button>
      <button type="button" class="btn btn-ghost btn-block" @click="goBack">
        {{ t("action.back") }}
      </button>
      <button
        v-if="grouped.length && !confirming"
        type="button"
        class="btn btn-quiet clear-link"
        @click="confirming = true"
      >
        {{ t("action.clearHistory") }}
      </button>
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
    </div>
  </section>
</template>

<style scoped>
.sync-line {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin: calc(-1 * var(--sp-2)) 0 0;
}

.entry-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
}

.entry-chip {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
  border-radius: var(--radius-pill);
  padding: 0 var(--sp-2);
}

.entry-chip-pending {
  color: var(--warning);
  background: var(--warning-tint);
}

.history {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  width: 100%;
}

.empty {
  color: var(--text-muted);
  text-align: center;
  padding: var(--sp-6) var(--sp-4);
  font-size: var(--fs-sm);
}

.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.entry {
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.entry-when {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.entry-day {
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
}

.entry-metrics {
  display: flex;
  align-items: baseline;
  gap: var(--sp-4);
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-bold);
}

.entry-metric {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}

.entry-metric svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
}

.entry-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
}

/* Direction arrow beside each figure: the two speeds are told apart by an
   orange and a blue, and the arrow is what carries that for anyone who cannot
   separate the hues. */
.metric-down {
  color: var(--brand-ink);
}

.metric-up {
  color: var(--brand-upload);
}

.metric-ping {
  color: var(--text-secondary);
  font-weight: var(--fw-semibold);
}

.entry-server {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
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

.clear-link {
  color: var(--danger);
}

.clear-link:hover {
  background: var(--danger-bg);
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
</style>
