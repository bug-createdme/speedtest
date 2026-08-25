<script setup>
import { useI18n } from "../i18n/index.js";
const { t } = useI18n();
</script>

<!--
  The Unitel wordmark, inlined.

  The paths are the wordmark half of Unitel's own logo_mobile.svg from
  unitel.com.la, with the Lao tagline cropped out of the viewBox - at header
  size the tagline is 4px tall and reads as a smudge. The untouched two-line
  asset is kept at ui/src/assets/unitel-logo.svg for anywhere it can be shown
  large enough to be legible.

  It is drawn in currentColor rather than a hard-coded #f06022 so it stays one
  token away from whatever Unitel's design team confirms, and so it can go
  white on a dark surface if a mono lockup is ever required. This is a working
  reproduction from a public asset, not a file handed over by the brand team;
  swapping in the official one is a matter of replacing this component.
-->
<template>
  <span class="brand">
    <svg
      class="brand-logo"
      viewBox="147 227 322 118"
      role="img"
      aria-label="Unitel"
      focusable="false"
    >
      <path fill="currentColor" d="m194.98 298.83q0 4.82-1.67 8.05-1.67 3.25-4.6 4.88-2.93 1.63-6.75 1.63-5.8 0-9.01-3.51-3.21-3.52-3.21-10v-38.93h-18.32v42.2q0 8.15 2.87 13.94 2.86 5.81 8.11 8.86 5.24 3.05 12.28 3.05 8.76 0 14.4-4.78 3.83-3.24 6.43-8.29l0.08 11.9h17.71v-66.88h-18.32z" />
      <path fill="currentColor" d="m273.22 263.56q-5.24-3.05-12.28-3.05-8.82 0-14.46 4.78-3.81 3.23-6.37 8.2l-0.08-11.87h-17.71v66.88h18.33v-37.88q-0.01-4.82 1.66-8.05 1.66-3.24 4.6-4.85 2.93-1.6 6.75-1.6 5.8 0 9.01 3.52 3.21 3.51 3.21 9.99v38.87h18.32v-42.14q0-8.2-2.86-13.97-2.87-5.77-8.12-8.83z" />
      <path fill="currentColor" d="m453.72 314.05q-3.52 0-4.94-1.38-1.41-1.39-1.41-4.72v-45.61-14.45c0-3.52-3.81-5.72-6.85-3.96l-11.42 6.59v48.35 11.42q0 9.13 5.25 13.7 5.24 4.57 15.85 4.57h10.37v-14.51z" />
      <path fill="currentColor" d="m415.08 318.87c2.69-3.04 4.49-7.88 5.39-11.87h-15.89q-0.82 2.48-2.62 4.29-1.8 1.81-4.38 2.78c-1.73 0.64-3.69 0.65-5.89 0.65-3.06 0-5.72-0.36-7.97-1.71q-3.38-2.02-5.21-5.85-0.39-0.82-0.69-1.71 0 0 0 0l43.44-12.27h0.02v-0.01h0.01l-0.01-0.03q-0.13-7.35-2.28-13.19-2.3-6.22-6.42-10.56-4.12-4.35-9.73-6.62-5.63-2.26-12.27-2.26-9.25 0-16.22 4.35-6.97 4.34-10.88 12.01-3.92 7.67-3.92 17.69 0 10.15 3.89 17.79 3.88 7.64 11 11.9 7.12 4.25 16.83 4.25 7.6 0 13.68-2.54 6.09-2.54 10.12-7.09zm-36.68-37.14q1.7-3.6 4.84-5.61c2.11-1.35 4.63-1.83 7.57-1.83 2.98 0 5.52 0.47 7.59 1.79q3.12 2 4.77 5.68 0.32 0.7 0.56 1.45 0 0.01 0 0.01l-26.71 7.54v-0.66c0-3.18 0.23-5.97 1.38-8.37z" />
      <path fill="currentColor" d="m356.22 275.07v-14.56h-13.2v-13.79c0-3.53-3.81-5.74-6.85-3.97l-11.42 6.62v11.21h-13.21-1.22-17.76v67.92h18.98v-53.74h13.21v35.24q0 9.27 5.25 13.91 5.25 4.65 15.85 4.65h10.37v-14.74h-6.85q-3.52 0-4.94-1.41-1.41-1.41-1.41-4.8v-32.54z" />
      <path fill="currentColor" d="m302.05 253.98c6.55 0 11.85-5.31 11.85-11.86 0-6.55-5.3-11.85-11.85-11.85-6.55 0-11.86 5.3-11.86 11.85 0 6.55 5.31 11.86 11.86 11.86z" />
    </svg>
    <span class="brand-divider" aria-hidden="true"></span>
    <span class="brand-name">{{ t("app.title") }}</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.brand-logo {
  height: 1.4rem;
  /* 322:118 is the cropped wordmark's own ratio; letting the browser derive
     the width from it keeps the letterforms from stretching at any size. */
  width: auto;
  aspect-ratio: 322 / 118;
  color: var(--brand-primary);
  flex: none;
}

.brand-divider {
  width: 1px;
  height: 1.1rem;
  background: var(--border-strong);
  flex: none;
}

.brand-name {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
  Below ~360px the language select and the theme button leave the descriptor
  about three characters of room, and it renders as "Sp...". The wordmark plus
  the page's own <title> carry it from there; a truncated label carries
  nothing.
*/
@media (max-width: 360px) {
  .brand-divider,
  .brand-name {
    display: none;
  }
}
</style>
