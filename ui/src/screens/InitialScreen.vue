<script setup>
import { computed, onMounted } from "vue";
import StartButton from "../components/StartButton.vue";
import { useI18n } from "../i18n/index.js";
import { fetchLocation } from "../context/location.js";
import { fetchClientIp, test } from "../state/test.js";
import { SCREEN, connectionType, goTo } from "../state/ui.js";

defineEmits(["start"]);
const { t } = useI18n();

onMounted(() => {
  if (!test.ip) {
    fetchClientIp();
  }
  if (!test.location) {
    fetchLocation(10000).then((loc) => {
      if (loc) test.location = loc;
    }).catch(() => {});
  }
});

const serverName = computed(() => {
  const s = test.selectedServer;
  if (!s) return t("server.unknown");
  return s.name || s.server || t("server.unknown");
});

const hasChoice = computed(() => test.servers.length > 1);

const facts = computed(() =>
  [
    { key: "conn", label: t("net.connection"), value: connectionType.value },
    { key: "isp", label: "ISP", value: test.isp },
    { key: "ip", label: "IP", value: test.ip }
  ].filter((fact) => fact.value)
);
</script>

<template>
  <section class="initial">
    <div class="instrument">
      <div class="instrument-body">
        <!--
          The ring stack occupies the same square the gauge will fill once the
          run starts, so pressing Start does not swap the layout out from under
          the thumb - the circle stays where it was and the arc takes over.
        -->
        <StartButton @click="$emit('start')" />

        <p class="tagline">{{ t("app.subtitle") }}</p>
      </div>

      <!--
        Server choice sits inside the hero because it changes what the numbers
        mean. Pushed to the bottom edge, it reads as a setting on the
        instrument rather than as another thing to decide before starting.
      -->
      <button
        type="button"
        class="server-pill"
        :disabled="!hasChoice"
        @click="goTo(SCREEN.SERVERS)"
      >
        <span class="label">{{ t("server.label") }}</span>
        <span class="server-name">{{ serverName }}</span>
        <svg
          v-if="hasChoice"
          class="server-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="m6 3.5 4.5 4.5L6 12.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>

    <!--
      The Start button is never disabled.

      docs/analysis-phase1.md §13 #15: the old UI disabled it for the whole
      server-selection pass, which §9 measured at up to 36 seconds. Selection
      runs in the background here; pressing Start before it finishes uses the
      first server in the list and lets the pick settle behind the scenes.
    -->
    <p v-if="test.selection.running" class="selection-note" role="status">
      <span class="spinner" aria-hidden="true"></span>
      {{ t("status.findingServers") }}
      <span v-if="test.selection.total">
        — {{ t("status.serversChecked", { done: test.selection.done, total: test.selection.total }) }}
      </span>
    </p>

    <dl v-if="facts.length" class="facts">
      <div v-for="fact in facts" :key="fact.key" class="fact chip">
        <dt class="fact-label">{{ fact.label }}</dt>
        <dd class="fact-value">{{ fact.value }}</dd>
      </div>
    </dl>

    <button type="button" class="btn btn-quiet history-link" @click="goTo(SCREEN.HISTORY)">
      {{ t("action.history") }}
    </button>
  </section>
</template>

<style scoped>
.initial {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  flex: 1;
  justify-content: center;
  text-align: center;
  width: 100%;
}

.instrument {
  width: 100%;
}

.tagline {
  color: var(--text-secondary);
  font-size: var(--fs-md);
}

.server-pill {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-4);
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: start;
}

.server-pill:disabled {
  cursor: default;
}

.server-name {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: end;
}

.server-chevron {
  width: 1rem;
  height: 1rem;
  flex: none;
  color: var(--brand-primary);
}

.selection-note {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--text-muted);
  font-size: var(--fs-sm);
  margin: 0;
}

.spinner {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: var(--radius-pill);
  border: 2px solid var(--border-strong);
  border-top-color: var(--brand-primary);
  flex: none;
  animation: spin 700ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 3s;
  }
}

.facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
  margin: 0;
}

.fact {
  gap: var(--sp-2);
}

.fact-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.fact-value {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-link {
  margin-top: calc(var(--sp-1) * -1);
}
</style>
