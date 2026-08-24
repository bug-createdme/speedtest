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
</script>

<template>
  <section class="servers">
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
        :aria-valuenow="test.selection.total ? Math.round((test.selection.done / test.selection.total) * 100) : 0"
      >
        <div
          class="progress-bar"
          :style="{ width: test.selection.total ? ((test.selection.done / test.selection.total) * 100).toFixed(0) + '%' : '0%' }"
        ></div>
      </div>
    </div>

    <ul class="server-list">
      <li v-for="server in sorted" :key="server.server">
        <button
          type="button"
          class="server-row"
          :class="{ 'server-selected': isSelected(server) }"
          @click="pick(server)"
        >
          <span class="server-name">{{ server.name || server.server }}</span>
          <span v-if="fastest && server.server === fastest.server && server.pingT >= 0" class="badge">
            {{ t("status.fastest") }}
          </span>
          <span class="server-ping">
            {{ server.pingT === undefined || server.pingT < 0 ? "--" : Math.round(server.pingT) }}
            {{ t("unit.ms") }}
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

.progress {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--brand-primary);
  transition: width var(--dur-base) var(--ease-out);
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
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  cursor: pointer;
  text-align: start;
}

.server-selected {
  border-color: var(--brand-primary);
  box-shadow: 0 0 0 3px var(--brand-ring);
}

.server-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--success);
}

.server-ping {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
</style>
