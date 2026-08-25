<script setup>
import { computed } from "vue";
import { chooseServer, test } from "../state/test.js";
import { SCREEN, goBack, goTo } from "../state/ui.js";
import { useI18n } from "../i18n/index.js";

const { t } = useI18n();

/*
  Sorted by measured ping, unreachable servers last. pingT is written onto each
  server object by the engine's own selection pass, so this list reflects real
  measurements rather than a static ordering.
*/
const sorted = computed(() => {
  const copy = test.servers.slice();
  copy.sort((a, b) => {
    const pa = a.pingT === undefined || a.pingT < 0 ? Infinity : a.pingT;
    const pb = b.pingT === undefined || b.pingT < 0 ? Infinity : b.pingT;
    return pa - pb;
  });
  return copy;
});

const fastest = computed(() => sorted.value[0]);

function pick(server) {
  chooseServer(server);
  goBack();
}

function isSelected(server) {
  return test.selectedServer && test.selectedServer.server === server.server;
}

function reachable(server) {
  return server.pingT !== undefined && server.pingT >= 0;
}

/*
  Latency as three bars, alongside the number.

  The figure alone means nothing to a subscriber choosing from a list of place
  names; the bars say "this one is closer" without asking anyone to know what
  40ms is. Thresholds are the ones the result screen already grades against.
*/
function bars(server) {
  if (!reachable(server)) return 0;
  if (server.pingT < 60) return 3;
  if (server.pingT < 150) return 2;
  return 1;
}

const selectionPercent = computed(() =>
  test.selection.total
    ? Math.round((test.selection.done / test.selection.total) * 100)
    : 0
);
</script>

<template>
  <section class="servers">
    <h2 class="section-title">{{ t("server.label") }}</h2>

    <div v-if="test.selection.running" class="selection">
      <p class="selection-text">
        {{ t("status.findingServers") }} —
        {{ t("status.serversChecked", { done: test.selection.done, total: test.selection.total }) }}
      </p>
      <div
        class="progress"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="selectionPercent"
      >
        <div class="progress-bar" :style="{ width: selectionPercent + '%' }"></div>
      </div>
    </div>

    <ul class="server-list">
      <li v-for="server in sorted" :key="server.server">
        <button
          type="button"
          class="server-row"
          :class="{ 'server-selected': isSelected(server) }"
          :aria-pressed="isSelected(server)"
          @click="pick(server)"
        >
          <span class="server-main">
            <span class="server-name">{{ server.name || server.server }}</span>
            <span
              v-if="fastest && server.server === fastest.server && reachable(server)"
              class="badge"
            >
              {{ t("status.fastest") }}
            </span>
          </span>

          <span class="server-latency">
            <span class="server-ping">
              {{ reachable(server) ? Math.round(server.pingT) : "--" }}
              <span class="server-ping-unit">{{ t("unit.ms") }}</span>
            </span>
            <span class="bars" aria-hidden="true">
              <span class="bar" :class="{ 'bar-on': bars(server) >= 1 }"></span>
              <span class="bar" :class="{ 'bar-on': bars(server) >= 2 }"></span>
              <span class="bar" :class="{ 'bar-on': bars(server) >= 3 }"></span>
            </span>
          </span>
        </button>
      </li>
    </ul>

    <button type="button" class="btn btn-ghost btn-block" @click="goTo(SCREEN.INITIAL)">
      {{ t("action.skipSelection") }}
    </button>
  </section>
</template>

<style scoped>
.servers {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  width: 100%;
}

.selection {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.selection-text {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}

.server-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-height: 60vh;
  overflow-y: auto;
}

.server-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 3.25rem;
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  cursor: pointer;
  text-align: start;
  transition: border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.server-row:hover {
  border-color: var(--border-strong);
}

.server-selected {
  border-color: var(--brand-primary);
  background: var(--brand-tint);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.server-main {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: 1;
  min-width: 0;
}

.server-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
}

.badge {
  flex: none;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
  background: var(--success-tint);
  color: var(--success);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
}

.server-latency {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: none;
}

.server-ping {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--text);
}

.server-ping-unit {
  font-weight: var(--fw-regular);
  color: var(--text-muted);
}

.bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 0.85rem;
}

.bar {
  width: 3px;
  border-radius: 1px;
  background: var(--border-strong);
}

.bar:nth-child(1) {
  height: 35%;
}

.bar:nth-child(2) {
  height: 65%;
}

.bar:nth-child(3) {
  height: 100%;
}

.bar-on {
  background: var(--brand-primary);
}
</style>
