<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  unit: { type: String, default: "" },
  variant: { type: String, default: "neutral" }
});
</script>

<template>
  <div class="metric card" :class="'metric-' + variant">
    <span class="label">{{ label }}</span>
    <span class="metric-value">
      {{ value }}<span v-if="unit" class="metric-unit">{{ unit }}</span>
    </span>
    <slot />
  </div>
</template>

<style scoped>
.metric {
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.metric-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  color: var(--accent, var(--text));
}

.metric-unit {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
  margin-left: 0.15em;
}

.metric-download {
  --accent: var(--brand-download);
}

.metric-upload {
  --accent: var(--brand-upload);
}
</style>
