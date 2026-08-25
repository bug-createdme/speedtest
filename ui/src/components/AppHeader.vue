<script setup>
import BrandMark from "./BrandMark.vue";
import LanguageMenu from "./LanguageMenu.vue";
import LogoutButton from "./LogoutButton.vue";
</script>

<!--
  The header is two controls and a wordmark, and it has to survive a 320px
  screen with "Kiểm tra tốc độ" next to them - so the language control shows a
  flag rather than a language name. Both controls own their own popover; this
  component only places them.
-->
<template>
  <header class="header">
    <BrandMark />

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

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex: none;
}
</style>
