<script setup>
import { computed, ref } from "vue";
import { clearHistory, history, toCsv } from "../state/history.js";
import { goBack } from "../state/ui.js";
import { useI18n } from "../i18n/index.js";

const { t, locale } = useI18n();

/* Two-step inline confirm rather than window.confirm(): same reason the error
   screen exists - a native dialog in a WebView is unstyled and untranslatable. */
const confirming = ref(false);

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

function download() {
  const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "speedtest-history.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking immediately can cancel the download on some WebViews; one frame
  // is enough for the navigation to have been picked up.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function doClear() {
  clearHistory();
  confirming.value = false;
}
</script>

<template>
  <section class="history">
    <h2 class="history-title">{{ t("history.title") }}</h2>

    <p v-if="!grouped.length" class="empty">{{ t("history.empty") }}</p>

    <ul v-else class="entries">
      <li v-for="(entry, index) in grouped" :key="entry.at + index" class="entry card">
        <div class="entry-when">
          <span class="entry-day">{{ entry.dayLabel }}</span>
          <span class="entry-time">{{ entry.timeLabel }}</span>
        </div>
        <div class="entry-metrics">
          <span class="down">{{ entry.download.toFixed(1) }} ↓</span>
          <span class="up">{{ entry.upload.toFixed(1) }} ↑</span>
          <span class="ping">{{ Math.round(entry.ping) }} {{ t("unit.ms") }}</span>
        </div>
        <p v-if="entry.server" class="entry-server">{{ entry.server }}</p>
      </li>
    </ul>

    <div class="actions">
      <button
        v-if="grouped.length"
        type="button"
        class="btn btn-ghost btn-block"
        @click="download"
      >
        {{ t("action.exportCsv") }}
      </button>
      <button
        v-if="grouped.length && !confirming"
        type="button"
        class="btn btn-ghost btn-block"
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
      <button type="button" class="btn btn-ghost btn-block" @click="goBack">
        {{ t("action.back") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  width: 100%;
}

.history-title {
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
}

.empty {
  color: var(--text-muted);
  text-align: center;
  padding: var(--sp-6) var(--sp-4);
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
  gap: var(--sp-1);
}

.entry-when {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}

.entry-day {
  font-weight: var(--fw-semibold);
  color: var(--text);
}

.entry-metrics {
  display: flex;
  gap: var(--sp-4);
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semibold);
}

.down {
  color: var(--brand-download);
}

.up {
  color: var(--brand-upload);
}

.ping {
  color: var(--text-secondary);
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
  gap: var(--sp-2);
}

.confirm {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.confirm-text {
  font-size: var(--fs-sm);
}

.confirm-actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
}

.btn-danger {
  background: var(--danger);
  color: #fff;
}
</style>
