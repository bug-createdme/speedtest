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

/*
  Same digit budget as the gauge: hundredths below 10 Mbps, tenths up to a
  gigabit, whole numbers above it. A four-digit number with a decimal is what
  broke the old readout's layout, and the tenth of a Mbps it bought was never
  a real difference at that speed.
*/
function fmtSpeed(value) {
  const v = Number(value || 0);
  if (!(v > 0)) return "0.00";
  if (v < 10) return v.toFixed(2);
  if (v < 1000) return v.toFixed(1);
  return v.toFixed(0);
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

const details = computed(() =>
  [
    { key: "server", label: t("server.label"), value: serverName.value },
    { key: "conn", label: t("net.connection"), value: connectionType.value },
    { key: "ip", label: "IP", value: test.ip },
    { key: "isp", label: "ISP", value: test.isp }
  ]
    .filter((row) => row.value)
    .concat(
      timings.value.map((row) => ({
        key: row.key,
        label: row.key,
        value: fmtTiming(row.value) + " " + t("unit.ms")
      }))
    )
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

    <!--
      The answer, on the instrument panel the run was watched on.

      Both figures at once and at the same size: the old screen opened with two
      equal white cards in a grid, which said nothing about which number the
      user came for, and buried the server the numbers belong to eight rows
      further down.
    -->
    <div class="instrument">
      <div class="result-head">
        <span class="done-badge">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M3.5 8.5 6.5 11.5 12.5 5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {{ t("status.done") }}
        </span>
        <span class="result-server">{{ serverName }}</span>
      </div>

      <div class="readouts">
        <div class="readout readout-download">
          <span class="readout-label">
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
            {{ t("metric.download") }}
          </span>
          <span class="readout-value">{{ fmtSpeed(test.download) }}</span>
          <span class="readout-unit">{{ t("unit.mbps") }}</span>
          <SparkLine :points="test.dlSamples" variant="download" />
        </div>

        <div class="readout readout-upload">
          <span class="readout-label">
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
            {{ t("metric.upload") }}
          </span>
          <span class="readout-value">{{ fmtSpeed(test.upload) }}</span>
          <span class="readout-unit">{{ t("unit.mbps") }}</span>
          <SparkLine :points="test.ulSamples" variant="upload" />
        </div>
      </div>
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
      <h3 class="section-title">{{ t('loaded.title') }}</h3>
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
      <div v-for="row in details" :key="row.key" class="detail">
        <dt class="label">{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </div>
      <div v-if="test.testId" class="detail detail-id">
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

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
}

.done-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--success);
  flex: none;
}

.done-badge svg {
  width: 1rem;
  height: 1rem;
}

.result-server {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.readouts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.readout {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-4);
  min-width: 0;
}

/* A hairline between the two, rather than a gap: they are one reading of one
   link, not two unrelated cards. */
.readout-upload {
  border-left: 1px solid var(--border);
}

.readout-label {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.readout-label svg {
  width: 0.85rem;
  height: 0.85rem;
  flex: none;
}

.readout-download .readout-label {
  color: var(--gauge-download-from);
}

.readout-upload .readout-label {
  color: var(--gauge-upload-from);
}

.readout-value {
  font-family: var(--font-numeric);
  font-size: clamp(2rem, 11vw, 2.75rem);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  color: var(--text);
}

.readout-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
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
  background: var(--success-tint);
}

.delta-warn {
  color: var(--warning);
  background: var(--warning-tint);
}

.delta-bad {
  color: var(--danger);
  background: var(--danger-bg);
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

.detail-id {
  border-top: 1px solid var(--border);
  padding-top: var(--sp-3);
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
