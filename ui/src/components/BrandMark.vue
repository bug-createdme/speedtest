<script setup>
import { useI18n } from "../i18n/index.js";
const { t } = useI18n();
</script>

<!--
  PLACEHOLDER MARK.

  Unitel's logo has not been supplied to this project. This is a neutral
  wordmark standing in for it so the layout is real rather than a gap. Replace
  the <svg> below with the official asset; nothing else references it.
-->
<template>
  <span class="brand">
    <svg
      class="brand-glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 17.5a1.5 1.5 0 0 1 0-3 1.5 1.5 0 0 1 0 3Zm0-5.2a1.2 1.2 0 0 1 0-2.4c5.6 0 10.1 4.5 10.1 10.1a1.2 1.2 0 0 1-2.4 0c0-4.3-3.4-7.7-7.7-7.7Zm0-5.1a1.2 1.2 0 0 1 0-2.4C11.4 4.8 18.2 11.6 18.2 20a1.2 1.2 0 0 1-2.4 0C15.8 12.9 10.1 7.2 3 7.2Z"
        fill="currentColor"
      />
    </svg>
    <span class="brand-name">{{ t("app.title") }}</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--brand-primary);
}

.brand-glyph {
  width: 1.5rem;
  height: 1.5rem;
}

.brand-name {
  font-size: var(--fs-lg);
  font-weight: var(--fw-bold);
  color: var(--text);
}
</style>
