<script setup>
import { computed } from "vue";
import MetricCard from "../components/MetricCard.vue";
import SparkLine from "../components/SparkLine.vue";
import { test } from "../state/test.js";
import { SCREEN, connectionType, goTo } from "../state/ui.js";
import { useI18n } from "../i18n/index.js";

defineEmits(["again"]);
const { t } = useI18n();

function fmt(value, decimals) {
  return Number(value || 0).toFixed(decimals);
}

/*
  Connection-setup timings are routinely sub-millisecond against a nearby
  server, and rounding those to a whole number prints "0 ms" - which reads as
  "not measured", right next to rows that were dropped for being exactly that.
  One decimal below 10ms keeps a real reading distinguishable from a missing one.
*/
function fmtTiming(value) {
  const v = Number(value || 0);
  return v < 10 ? v.toFixed(1) : v.toFixed(0);
}

/* usedServer, not selectedServer: see state/test.js - Start may fire before
   server selection has settled, and the result must name the server the
   numbers actually came from. */
const serverName = computed(() => {
  const s = test.usedServer || test.selectedServer;
  return s ? s.name || s.server : t("server.unknown");
});

/*
  Connection setup breakdown, added by Phase 4 item 7. Only rendered when the
  numbers are actually there: cross-origin they need Timing-Allow-Origin from
  the backend, and in the multi-point flow the connection is usually already
  warm from server selection, in which case DNS and TCP legitimately read 0.
  Showing a row of zeroes would read as "0ms, excellent" rather than "not
  measured", so the whole block is dropped instead.
*/
const timings = computed(() =>
  [
    { key: "DNS", value: test.dns },
    { key: "TCP", value: test.tcp },
    { key: "TLS", value: test.tls },
    { key: "TTFB", value: test.ttfb }
  ].filter((row) => row.value > 0)
);
</script>

<template>
  <section class="result">
    <p class="sr-only" role="status" aria-live="polite">
      {{ t("result.summary", {
        download: fmt(test.download, 1),
        upload: fmt(test.upload, 1),
        ping: fmt(test.ping, 0)
      }) }}
    </p>

    <div class="grid-2">
      <MetricCard
        :label="t('metric.download')"
        :value="fmt(test.download, 1)"
        :unit="t('unit.mbps')"
        variant="download"
      >
        <SparkLine :points="test.dlSamples" variant="download" />
      </MetricCard>
      <MetricCard
        :label="t('metric.upload')"
        :value="fmt(test.upload, 1)"
        :unit="t('unit.mbps')"
        variant="upload"
      >
        <SparkLine :points="test.ulSamples" variant="upload" />
      </MetricCard>
    </div>

    <div class="grid-2">
      <MetricCard
        :label="t('metric.ping')"
        :value="fmt(test.ping, 0)"
        :unit="t('unit.ms')"
      />
      <MetricCard
        :label="t('metric.jitter')"
        :value="fmt(test.jitter, 0)"
        :unit="t('unit.ms')"
      />
    </div>

    <dl class="details card">
      <div class="detail">
        <dt class="label">{{ t("server.label") }}</dt>
        <dd>{{ serverName }}</dd>
      </div>
      <div v-if="connectionType" class="detail">
        <dt class="label">{{ t("net.connection") }}</dt>
        <dd>{{ connectionType }}</dd>
      </div>
      <div v-if="test.ip" class="detail">
        <dt class="label">IP</dt>
        <dd>{{ test.ip }}</dd>
      </div>
      <div v-if="test.isp" class="detail">
        <dt class="label">ISP</dt>
        <dd>{{ test.isp }}</dd>
      </div>
      <div v-for="row in timings" :key="row.key" class="detail">
        <dt class="label">{{ row.key }}</dt>
        <dd>{{ fmtTiming(row.value) }} {{ t("unit.ms") }}</dd>
      </div>
    </dl>

    <div class="actions">
      <button type="button" class="btn btn-primary btn-block" @click="$emit('again')">
        {{ t("action.testAgain") }}
      </button>
      <button type="button" class="btn btn-ghost btn-block" @click="goTo(SCREEN.HISTORY)">
        {{ t("action.history") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.result {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  width: 100%;
}

.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}

.details {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  margin: 0;
}

.detail {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
}

.detail dd {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  text-align: right;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
</style>
