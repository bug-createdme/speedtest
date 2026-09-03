<script setup>
defineProps({
  /* A locale code, not a country code - see the note below. */
  locale: { type: String, required: true }
});
</script>

<!--
  Flags for the three locales, drawn rather than fetched or emojified.

  Not emoji: 🇱🇦 renders as the letters "LA" on Windows, which has no flag
  glyphs at all, and Android's rendering varies by vendor font. A control whose
  entire job is to be recognisable at 20px cannot depend on that.

  Not images: three more requests on a page whose job is measuring slow
  connections, for 400 bytes of vector each.

  A flag is a country, and a language is not - "English" gets the UK's by the
  usual convention, and the accessible name is always the language name, never
  the country. If Unitel would rather show "LA / EN / VI" text than pick a
  country for a language, that is a one-component change.

  The Union Jack is the simplified, centred construction: its real diagonals
  are counterchanged (offset either side of the centre line). At 20px wide the
  difference is under half a pixel.
-->
<template>
  <svg
    class="flag"
    viewBox="0 0 30 20"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="locale === 'la' || locale === 'lo'">
      <rect width="30" height="20" fill="#ce1126" />
      <rect y="5" width="30" height="10" fill="#002868" />
      <circle cx="15" cy="10" r="4" fill="#ffffff" />
    </template>

    <template v-else-if="locale === 'vi'">
      <rect width="30" height="20" fill="#da251d" />
      <path
        d="M15 4.8 16.21 8.34 19.95 8.39 16.95 10.63 18.06 14.21 15 12.05 11.94 14.21 13.05 10.63 10.05 8.39 13.79 8.34Z"
        fill="#ffff00"
      />
    </template>

    <template v-else>
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#ffffff" stroke-width="4" />
      <path d="M0 0 30 20M30 0 0 20" stroke="#c8102e" stroke-width="2" />
      <path d="M15 0V20M0 10H30" stroke="#ffffff" stroke-width="6.7" />
      <path d="M15 0V20M0 10H30" stroke="#c8102e" stroke-width="4" />
    </template>
  </svg>
</template>

<style scoped>
.flag {
  width: 1.375rem;
  height: auto;
  aspect-ratio: 3 / 2;
  border-radius: 2px;
  flex: none;
  /* Keeps the flag an object against the surface behind it - cheaper than a
     border, and it does not change the 3:2 box. */
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.16);
}
</style>
