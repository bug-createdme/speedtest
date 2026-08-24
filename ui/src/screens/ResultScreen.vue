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
/*
  Latency added by load, per phase.

  Both sides of the subtraction are averages on purpose. `test.ping` is the
  minimum of the idle samples, which is the right way to report an idle link
  but the wrong baseline here: subtracting a minimum from an average would
  book part of the difference between the two statistics as bufferbloat.
*/
function increase(loaded) {
  if (!(loaded > 0) || !(test.idlePingAvg > 0)) return 0;
  const delta = loaded - test.idlePingAvg;
  return delta > 0 ? delta : 0;
}

/*
  Severity bands for the increase, in milliseconds. These follow the grading
  in common use for bufferbloat tests rather than any Unitel-defined SLA - if
  operations has its own thresholds, this is the one place to change them.
*/
function severity(loaded) {
  const delta = increase(loaded);
  if (delta >= 100) return 'bad';
  if (delta >= 30) return 'warn';
  return 'ok';
}

const hasLoadedLatency = computed(() => test.probeCount > 0);

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

    <section v-if="hasLoadedLatency" class="loaded card">
      <h3 class="loaded-title">{{ t('loaded.title') }}</h3>
      <p class="loaded-explain">{{ t('loaded.explain') }}</p>

      <div class="loaded-row">
        <span class="loaded-label">{{ t('loaded.idle') }}</span>
        <span class="loaded-value">{{ fmt(test.idlePingAvg, 0) }} {{ t('unit.ms') }}</span>
        <span class="loaded-extra"></span>
      </div>

      <div v-if="test.dlPing > 0" class="loaded-row">
        <span class="loaded-label">{{ t('loaded.download') }}</span>
        <span class="loaded-value">
          {{ fmt(test.dlPing, 0) }} {{ t('unit.ms') }}
          <em class="delta" :class="'delta-' + severity(test.dlPing)">
            {{ t('loaded.increase', { value: fmt(increase(test.dlPing), 0) }) }}
          </em>
        </span>
        <span class="loaded-extra">{{ t('loaded.worst', { value: fmt(test.dlPingMax, 0) }) }}</span>
      </div>

      <div v-if="test.ulPing > 0" class="loaded-row">
        <span class="loaded-label">{{ t('loaded.upload') }}</span>
        <span class="loaded-value">
          {{ fmt(test.ulPing, 0) }} {{ t('unit.ms') }}
          <em class="delta" :class="'delta-' + severity(test.ulPing)">
            {{ t('loaded.increase', { value: fmt(increase(test.ulPing), 0) }) }}
          </em>
        </span>
        <span class="loaded-extra">{{ t('loaded.worst', { value: fmt(test.ulPingMax, 0) }) }}</span>
      </div>

      <div class="loaded-row">
        <span class="loaded-label">{{ t('loaded.loss') }}</span>
        <span class="loaded-value">{{ fmt(test.packetLoss, 2) }} {{ t('unit.percent') }}</span>
        <!--
          The sample count is shown, not hidden: a 0.00% drawn from 40 probes is
          a much weaker statement than the number alone suggests, and this is a
          figure operations will act on.
        -->
        <span class="loaded-extra">{{ t('loaded.lossSamples', { count: test.probeCount }) }}</span>
      </div>

      <p class="loaded-caveat">{{ t('loaded.lossCaveat') }}</p>
    </section>

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
      <div v-if="test.testId" class="detail">
        <dt class="label">{{ t("result.testId") }}</dt>
        <dd><code class="test-id">{{ test.testId }}</code></dd>
      </div>
    </dl>

    <p v-if="test.testId" class="id-hint">{{ t("result.testIdHint") }}</p>

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

.loaded {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.loaded-title {
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
}

.loaded-explain,
.loaded-caveat {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.loaded-caveat {
  margin-top: var(--sp-2);
  border-top: 1px solid var(--border);
  padding-top: var(--sp-2);
}

.loaded-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--sp-1) var(--sp-3);
}

.loaded-label {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}

.loaded-value {
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semibold);
  text-align: right;
}

.loaded-extra {
  grid-column: 2;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: right;
}

.delta {
  font-style: normal;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  margin-left: var(--sp-2);
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
}

.delta-ok {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.delta-warn {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.delta-bad {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
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

.test-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  user-select: all;
}

.id-hint {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
</style>
