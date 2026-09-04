<script setup>
import { computed, watch, nextTick } from "vue";
import { STAGE } from "../state/test.js";
import { useI18n } from "../i18n/index.js";

const props = defineProps({
  stage: { type: String, required: true },
  done: { type: Object, default: () => ({}) },
  available: { type: Array, default: () => [] }
});

const { t } = useI18n();

const steps = computed(() =>
  [
    { key: STAGE.PING, label: t("stage.ping") },
    { key: STAGE.DOWNLOAD, label: t("stage.download") },
    { key: STAGE.UPLOAD, label: t("stage.upload") },
    { key: STAGE.BROWSE, label: t("stage.browse") },
    { key: STAGE.VIDEO, label: t("stage.video") }
  ].filter((step) => props.available.includes(step.key))
);

const ORDER = [STAGE.PING, STAGE.DOWNLOAD, STAGE.UPLOAD, STAGE.BROWSE, STAGE.VIDEO];

function stateOf(key) {
  if (props.stage === key) return "active";
  if (props.done[key]) return "done";
  const current = ORDER.indexOf(props.stage);
  const mine = ORDER.indexOf(key);
  if (current > -1 && mine < current) return "done";
  return "pending";
}

watch(
  () => props.stage,
  async () => {
    await nextTick();
    if (typeof document !== "undefined") {
      const activeEl = document.querySelector(".step-active");
      if (activeEl && activeEl.scrollIntoView) {
        activeEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }
  }
);
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
  gap: 3px;
  list-style: none;
  margin: 0;
  padding: 3px;
  border-radius: var(--radius-pill);
  background: var(--surface);
  width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.stepper::-webkit-scrollbar {
  display: none;
}

.step {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 1.85rem;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  font-size: 0.76rem;
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  transition: color var(--dur-base) var(--ease-out);
  white-space: nowrap;
}

.step-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-dot {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: var(--radius-pill);
  background: currentColor;
  opacity: 0.6;
  flex: none;
}

.step-icon {
  width: 0.75rem;
  height: 0.75rem;
  flex: none;
}

.step-active {
  background-image: var(--brand-gradient);
  background-color: var(--brand-primary);
  color: var(--brand-on-primary);
  font-weight: var(--fw-bold);
  flex-shrink: 0;
}

.step-done {
  color: var(--text-secondary);
}
</style>
