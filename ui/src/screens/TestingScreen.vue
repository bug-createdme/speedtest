<script setup>
import { computed } from "vue";
import SpeedGauge from "../components/SpeedGauge.vue";
import SparkLine from "../components/SparkLine.vue";
import StageStepper from "../components/StageStepper.vue";
import { STAGE, stageDuration, test } from "../state/test.js";
import { useI18n } from "../i18n/index.js";

defineEmits(["cancel"]);
const { t } = useI18n();

const variant = computed(() => {
  if (test.stage === STAGE.DOWNLOAD) return "download";
  if (test.stage === STAGE.UPLOAD) return "upload";
  return "neutral";
});

const value = computed(() => {
  if (test.stage === STAGE.DOWNLOAD) return test.download;
  if (test.stage === STAGE.UPLOAD) return test.upload;
  return 0;
});

const samples = computed(() =>
  test.stage === STAGE.UPLOAD ? test.ulSamples : test.dlSamples
);

const progress = computed(() => {
  if (test.stage === STAGE.DOWNLOAD) return test.dlProgress;
  if (test.stage === STAGE.UPLOAD) return test.ulProgress;
  if (test.stage === STAGE.PING) return test.pingProgress;
  return 0;
});

const duration = computed(() => stageDuration(test.stage));

const headline = computed(() => {
  if (test.stage === STAGE.PING) return t("status.measuringPing");
  if (test.stage === STAGE.DOWNLOAD) return t("status.measuringDownload");
  if (test.stage === STAGE.UPLOAD) return t("status.measuringUpload");
  return t("status.idle");
});

const doneStages = computed(() => ({
  [STAGE.PING]: test.ping > 0,
  [STAGE.DOWNLOAD]: test.download > 0 && test.stage !== STAGE.DOWNLOAD,
  [STAGE.UPLOAD]: test.upload > 0 && test.stage !== STAGE.UPLOAD
}));

const showGauge = computed(
  () => test.stage === STAGE.DOWNLOAD || test.stage === STAGE.UPLOAD
);
</script>

<template>
  <section class="testing">
    <StageStepper :stage="test.stage" :done="doneStages" />

    <!--
      One polite live region for the whole run, carrying the stage name only.

      The gauge itself is aria-hidden from live updates on purpose: it changes
      five times a second, and a screen reader announcing every value makes the
      page unusable. The numbers are announced once, on the result screen.
    -->
    <p class="sr-only" role="status" aria-live="polite">{{ headline }}</p>
    <p class="headline" aria-hidden="true">{{ headline }}</p>

    <SpeedGauge
      v-if="showGauge"
      :value="value"
      :variant="variant"
      :unit="t('unit.mbps')"
      :aria-label="t('a11y.gauge', { value: value.toFixed(1) })"
    />
    <div v-else class="ping-readout">
      <span class="ping-value">{{ test.ping ? test.ping.toFixed(0) : "--" }}</span>
      <span class="ping-unit">{{ t("unit.ms") }}</span>
    </div>

    <SparkLine v-if="showGauge" :points="samples" :variant="variant" />

    <div
      class="progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(progress * 100)"
      :aria-label="t('a11y.progress')"
    >
      <div class="progress-bar" :style="{ width: (progress * 100).toFixed(1) + '%' }"></div>
    </div>
    <p v-if="duration" class="elapsed" aria-hidden="true">
      {{ t("status.elapsed", { elapsed: (progress * duration).toFixed(1), total: duration }) }}
    </p>

    <button type="button" class="btn btn-ghost" @click="$emit('cancel')">
      {{ t("action.cancel") }}
    </button>
  </section>
</template>

<style scoped>
.testing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  flex: 1;
  justify-content: center;
  width: 100%;
}

.headline {
  color: var(--text-secondary);
  font-size: var(--fs-md);
}

.ping-readout {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-7) 0;
}

.ping-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-readout);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
}

.ping-unit {
  font-size: var(--fs-lg);
  color: var(--text-secondary);
}

.progress {
  width: 100%;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--brand-primary);
  border-radius: var(--radius-pill);
  transition: width var(--dur-base) var(--ease-out);
}

.elapsed {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
}
</style>
