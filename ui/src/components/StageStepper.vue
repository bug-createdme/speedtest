<script setup>
import { computed } from "vue";
import { STAGE } from "../state/test.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps({
  stage: { type: String, required: true },
  done: { type: Object, default: () => ({}) },
  available: { type: Array, default: () => [] }
});

const { t } = useI18n();

/*
  Order follows settings.json test_order "IP_D_U": ping first, then download,
  then upload. Ping moved ahead of the transfers when the Resource Timing bug
  was fixed - a full run overflows the timing buffer, so a ping measured
  afterwards was reading a stale entry.
*/
/*
  Only the stages this run will actually perform.

  Web and video are skipped when no URL is configured for them, and a stepper
  that shows a step nothing will ever reach reads as a run that got stuck.
  `available` comes from the parent, which knows the settings.
*/
const steps = computed(() =>
  [
    { key: STAGE.PING, label: t("stage.ping") },
    { key: STAGE.BROWSE, label: t("stage.browse") },
    { key: STAGE.DOWNLOAD, label: t("stage.download") },
    { key: STAGE.UPLOAD, label: t("stage.upload") },
    { key: STAGE.VIDEO, label: t("stage.video") }
  ].filter((step) => props.available.includes(step.key))
);

const ORDER = [STAGE.PING, STAGE.BROWSE, STAGE.DOWNLOAD, STAGE.UPLOAD, STAGE.VIDEO];

function stateOf(key) {
  if (props.stage === key) return "active";
  if (props.done[key]) return "done";
  const current = ORDER.indexOf(props.stage);
  const mine = ORDER.indexOf(key);
  if (current > -1 && mine < current) return "done";
  return "pending";
}
</script>

<template>
  <ol class="stepper" :aria-label="t('a11y.progress')">
    <li
      v-for="step in steps"
      :key="step.key"
      class="step"
      :class="'step-' + stateOf(step.key)"
      :aria-current="stateOf(step.key) === 'active' ? 'step' : undefined"
    >
      <!--
        A tick for finished stages, a dot for the rest. State was carried by
        colour alone before, which is exactly the distinction a red-green
        colour-blind user cannot make on a small dot.
      -->
      <svg
        v-if="stateOf(step.key) === 'done'"
        class="step-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M3.5 8.5 6.5 11.5 12.5 5"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span v-else class="step-dot" aria-hidden="true"></span>
      <span class="step-label">{{ step.label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: stretch;
  gap: var(--sp-1);
  list-style: none;
  margin: 0;
  padding: var(--sp-1);
  border-radius: var(--radius-pill);
  background: var(--surface);
  width: 100%;
}

.step {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: 2rem;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-pill);
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  /* Colour only. Transitioning `background` too fades the flat fallback colour
     out over 220ms while the gradient on top of it vanishes on the first
     frame, so a step that has just finished spends a fifth of a second as a
     washed-out orange slab. */
  transition: color var(--dur-base) var(--ease-out);
}

.step-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: var(--radius-pill);
  background: currentColor;
  opacity: 0.6;
  flex: none;
}

.step-icon {
  width: 0.9rem;
  height: 0.9rem;
  flex: none;
}

.step-active {
  background-image: var(--brand-gradient);
  background-color: var(--brand-primary);
  color: var(--brand-on-primary);
  font-weight: var(--fw-bold);
}

.step-done {
  color: var(--text-secondary);
}
</style>
