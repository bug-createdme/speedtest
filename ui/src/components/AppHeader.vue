<script setup>
import BrandMark from "./BrandMark.vue";
import LanguageMenu from "./LanguageMenu.vue";
import LogoutButton from "./LogoutButton.vue";
import { useI18n } from "../i18n/index.js";

defineEmits(["home"]);
const { t } = useI18n();
</script>

<!--
  The header is two controls and a wordmark, and it has to survive a 320px
  screen with "Kiểm tra tốc độ" next to them - so the language control shows a
  flag rather than a language name. Both controls own their own popover; this
  component only places them.

  The wordmark is the way back to the start screen. Nothing else offered one:
  the result screen ended at "Test again" and "History", so once a run had
  finished the only route back was starting another 30-second test. What that
  press has to do beyond navigating - abandoning a run still in flight - is in
  App.vue with the rest of the screen transitions, which is why this emits
  rather than acts.
-->
<template>
  <header class="header">
    <button
      type="button"
      class="home"
      :aria-label="t('a11y.home')"
      @click="$emit('home')"
    >
      <BrandMark />
    </button>

    <div class="header-actions">
      <LanguageMenu />
      <LogoutButton />
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  min-height: var(--tap-min);
  /* The popovers hang out of the header's box; without this they are clipped
     by any ancestor that ends up scrolling. */
  position: relative;
  z-index: 30;
}

.home {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-min);
  min-width: 0;
  /* Padded for the thumb, then pulled back by the same amount so the wordmark
     still lines up with the page margin rather than sitting indented. */
  padding: var(--sp-1) var(--sp-2);
  margin-left: calc(var(--sp-2) * -1);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}

.home:hover {
  background: var(--surface-hover);
}

.home:active {
  background: var(--surface);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: none;
}
</style>
