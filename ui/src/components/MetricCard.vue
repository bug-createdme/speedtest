<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], required: true },
  unit: { type: String, default: "" },
  /* "download" | "upload" | "neutral" - sets the accent and the glyph. */
  variant: { type: String, default: "neutral" },
  /* Draws the number at result-hero size rather than card size. */
  large: { type: Boolean, default: false }
});
</script>

<template>
  <div class="metric card" :class="['metric-' + variant, { 'metric-large': large }]">
    <span class="metric-head">
      <!--
        Direction arrows, not decoration: download and upload are told apart by
        an orange and a blue in this design, and a user who cannot separate
        those two hues still has the arrow.
      -->
      <svg
        v-if="variant === 'download' || variant === 'upload'"
        class="metric-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          :d="variant === 'download' ? 'M8 3v9m0 0 4-4m-4 4-4-4' : 'M8 13V4m0 0 4 4M8 4 4 8'"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="label">{{ label }}</span>
    </span>

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
  /* The accent bar along the top edge: the one place the card carries the
     metric's colour at full strength, where it cannot fail a text contrast
     rule because there is no text on it. */
  border-top: 3px solid var(--accent, var(--border));
}

.metric-head {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--accent, var(--text-muted));
  min-width: 0;
}

.metric-icon {
  width: 0.9rem;
  height: 0.9rem;
  flex: none;
}

.metric-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-2xl);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--text);
}

.metric-large .metric-value {
  font-size: var(--fs-3xl);
}

.metric-unit {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
  margin-left: 0.2em;
  letter-spacing: 0;
}

.metric-download {
  --accent: var(--brand-download);
}

.metric-upload {
  --accent: var(--brand-upload);
}
</style>
