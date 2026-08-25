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

/*
  What has already been measured, kept on screen for the rest of the run.

  Before, each stage replaced the previous one outright: the ping figure was
  visible for four seconds and then gone until the result screen. On a test
  this long that reads as though the earlier stage was discarded.
*/
const settled = computed(() =>
  [
    {
      key: STAGE.PING,
      label: t("stage.ping"),
      value: test.ping > 0 ? test.ping.toFixed(0) : null,
      unit: t("unit.ms"),
      variant: "neutral"
    },
    {
      key: STAGE.DOWNLOAD,
      label: t("stage.download"),
      value:
        test.download > 0 && test.stage !== STAGE.DOWNLOAD
          ? test.download.toFixed(1)
          : null,
      unit: t("unit.mbps"),
      variant: "download"
    },
    {
      key: STAGE.UPLOAD,
      label: t("stage.upload"),
      value:
        test.upload > 0 && test.stage !== STAGE.UPLOAD ? test.upload.toFixed(1) : null,
      unit: t("unit.mbps"),
      variant: "upload"
    }
  ].filter((row) => row.value)
);
</script>

<template>
  <section class="testing">
    <div class="instrument">
      <div class="instrument-body">
        <StageStepper :stage="test.stage" :done="doneStages" />

        <!--
          One polite live region for the whole run, carrying the stage name only.

          The gauge itself is aria-hidden from live updates on purpose: it changes
          five times a second, and a screen reader announcing every value makes the
          page unusable. The numbers are announced once, on the result screen.
        -->
        <p class="sr-only" role="status" aria-live="polite">{{ headline }}</p>

        <!--
          The same ring in every stage, including ping. It used to be replaced
          by a bare number during ping and then appear from nowhere, moving
          everything below it down the screen mid-test.
        -->
        <SpeedGauge
          :value="showGauge ? value : 0"
          :variant="variant"
          :idle="!showGauge"
          :unit="t('unit.mbps')"
          :aria-label="t('a11y.gauge', { value: value.toFixed(1) })"
        >
          <template v-if="!showGauge">
            <span
              class="ping-value"
              :class="{ 'ping-value-pending': !test.ping }"
            >{{ test.ping ? test.ping.toFixed(0) : "—" }}</span>
            <span class="ping-unit">{{ t("unit.ms") }}</span>
          </template>
        </SpeedGauge>

        <p class="headline" aria-hidden="true">{{ headline }}</p>

        <SparkLine
          v-if="showGauge"
          :points="samples"
          :variant="variant"
        />
      </div>

      <div class="instrument-footer">
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
      </div>
    </div>

    <ul v-if="settled.length" class="settled">
      <li v-for="row in settled" :key="row.key" class="settled-row" :class="'settled-' + row.variant">
        <span class="settled-label">{{ row.label }}</span>
        <span class="settled-value">{{ row.value }} <span class="settled-unit">{{ row.unit }}</span></span>
      </li>
    </ul>

    <button type="button" class="btn btn-ghost btn-block" @click="$emit('cancel')">
      {{ t("action.cancel") }}
    </button>
  </section>
</template>

<style scoped>
.testing {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  flex: 1;
  justify-content: center;
  width: 100%;
}

.headline {
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  text-align: center;
}

.ping-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-readout);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--text);
}

/* The placeholder is not a number and must not be typeset as one: at readout
   size an em dash is just a white bar. */
.ping-value-pending {
  font-size: var(--fs-2xl);
  color: var(--text-muted);
}

.ping-unit {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.instrument-footer {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.elapsed {
  color: var(--text-muted);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.settled {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: var(--sp-2);
}

/* Label and figure on one line: with only the ping settled, a stacked card
   spanning the full width reads as an empty panel waiting to be filled. */
.settled-row {
  flex: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent, var(--border-strong));
  min-width: 0;
}

.settled-download {
  --accent: var(--brand-download);
}

.settled-upload {
  --accent: var(--brand-upload);
}

.settled-label {
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.settled-value {
  white-space: nowrap;
  font-family: var(--font-numeric);
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-bold);
  color: var(--text);
}

.settled-unit {
  font-size: var(--fs-xs);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}
</style>
