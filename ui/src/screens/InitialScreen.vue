<script setup>
import { computed } from "vue";
import { useI18n } from "../i18n/index.js";
import { test } from "../state/test.js";
import { SCREEN, connectionType, goTo } from "../state/ui.js";

defineEmits(["start"]);
const { t } = useI18n();

const serverName = computed(() => {
  const s = test.selectedServer;
  if (!s) return t("server.unknown");
  return s.name || s.server || t("server.unknown");
});

const hasChoice = computed(() => test.servers.length > 1);
</script>

<template>
  <section class="initial">
    <p class="subtitle">{{ t("app.subtitle") }}</p>

    <button
      type="button"
      class="server-pill"
      :disabled="!hasChoice"
      @click="goTo(SCREEN.SERVERS)"
    >
      <span class="label">{{ t("server.label") }}</span>
      <span class="server-name">{{ serverName }}</span>
      <span v-if="hasChoice" class="server-change">{{ t("action.change") }}</span>
    </button>

    <!--
      The Start button is never disabled.

      docs/analysis-phase1.md §13 #15: the old UI disabled it for the whole
      server-selection pass, which §9 measured at up to 36 seconds. Selection
      runs in the background here; pressing Start before it finishes uses the
      first server in the list and lets the pick settle behind the scenes.
    -->
    <button type="button" class="btn btn-primary btn-start" @click="$emit('start')">
      {{ t("action.start") }}
    </button>

    <p v-if="test.selection.running" class="selection-note" role="status">
      {{ t("status.findingServers") }}
      <span v-if="test.selection.total">
        — {{ t("status.serversChecked", { done: test.selection.done, total: test.selection.total }) }}
      </span>
    </p>

    <dl class="facts">
      <div v-if="connectionType" class="fact">
        <dt class="label">{{ t("net.connection") }}</dt>
        <dd>{{ connectionType }}</dd>
      </div>
      <div v-if="test.ip" class="fact">
        <dt class="label">IP</dt>
        <dd>{{ test.ip }}</dd>
      </div>
      <div v-if="test.isp" class="fact">
        <dt class="label">ISP</dt>
        <dd>{{ test.isp }}</dd>
      </div>
    </dl>

    <button type="button" class="btn btn-ghost" @click="goTo(SCREEN.HISTORY)">
      {{ t("action.history") }}
    </button>
  </section>
</template>

<style scoped>
.initial {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-5);
  flex: 1;
  justify-content: center;
  text-align: center;
}

.subtitle {
  color: var(--text-secondary);
  font-size: var(--fs-lg);
}

.server-pill {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  cursor: pointer;
  max-width: 100%;
}

.server-pill:disabled {
  cursor: default;
}

.server-name {
  font-weight: var(--fw-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-change {
  color: var(--brand-primary);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
}

.btn-start {
  width: 100%;
  max-width: 16rem;
  min-height: 3.5rem;
  font-size: var(--fs-xl);
}

.selection-note {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  margin: 0;
}

.facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-5);
  margin: 0;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.fact dd {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
</style>
