<script setup>
import BrandMark from "./BrandMark.vue";
import { useI18n } from "../i18n/index.js";
import { toggleTheme } from "../state/ui.js";

const { t, locale, setLocale, locales, localeName } = useI18n();
</script>

<template>
  <header class="header">
    <BrandMark />
    <div class="header-actions">
      <label class="sr-only" for="lang-select">{{ t("a11y.langSwitch") }}</label>
      <select
        id="lang-select"
        class="lang"
        :value="locale"
        @change="setLocale($event.target.value)"
      >
        <option v-for="code in locales" :key="code" :value="code">
          {{ localeName(code) }}
        </option>
      </select>
      <button
        type="button"
        class="icon-btn"
        :aria-label="t('a11y.themeSwitch')"
        @click="toggleTheme"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.lang {
  min-height: var(--tap-min);
  padding: 0 var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
}

.icon-btn {
  width: var(--tap-min);
  height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
}

.icon-btn svg {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
