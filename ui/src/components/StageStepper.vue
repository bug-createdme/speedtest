<script setup>
import { computed } from "vue";
import { STAGE } from "../state/test.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps({
  stage: { type: String, required: true },
  done: { type: Object, default: () => ({}) }
});

const { t } = useI18n();

/*
  Order follows settings.json test_order "IP_D_U": ping first, then download,
  then upload. Ping moved ahead of the transfers when the Resource Timing bug
  was fixed - a full run overflows the timing buffer, so a ping measured
  afterwards was reading a stale entry.
*/
const steps = computed(() => [
  { key: STAGE.PING, label: t("stage.ping") },
  { key: STAGE.DOWNLOAD, label: t("stage.download") },
  { key: STAGE.UPLOAD, label: t("stage.upload") }
]);

const ORDER = [STAGE.PING, STAGE.DOWNLOAD, STAGE.UPLOAD];

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
      <span class="step-dot" aria-hidden="true"></span>
      <span class="step-label">{{ step.label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-4);
  list-style: none;
  margin: 0;
  padding: 0;
}

.step {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-muted);
}

.step-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  transition: background var(--dur-fast) var(--ease-out);
}

.step-active {
  color: var(--text);
  font-weight: var(--fw-semibold);
}

.step-active .step-dot {
  background: var(--brand-primary);
  box-shadow: 0 0 0 4px var(--brand-ring);
}

.step-done {
  color: var(--text-secondary);
}

.step-done .step-dot {
  background: var(--success);
}
</style>
