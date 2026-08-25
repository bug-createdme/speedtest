<script setup>
import { useI18n } from "../i18n/index.js";

defineEmits(["click"]);
const { t } = useI18n();

/*
  The Start control: seven concentric hairlines with the label at the core.

  The viewBox, the centre and the outermost radius are SpeedGauge.vue's, not
  arbitrary: r=84 in a 220 box is exactly where that component draws its arc.
  Measured, the outermost ring and the gauge track come out the same diameter
  to the pixel at every width - so pressing Start does not resize the circle
  under the thumb, the ring the eye is already on becomes the thing that fills
  up. It does settle about 27px upward, because the testing screen adds the
  stage stepper above it; that is a change of state, not a jump. If the gauge
  geometry ever changes, this has to follow it.

  Inward from there the step is 6, leaving the label a box a little over 40%
  of the control wide - enough for "Bắt đầu" on one line.

  Rings are listed OUTER first; the pulse runs the other way, see the
  animation-delay ladder in the stylesheet.
*/
const CX = 110;
const CY = 110;
const RINGS = [
  { i: 1, r: 84 },
  { i: 2, r: 78 },
  { i: 3, r: 72 },
  { i: 4, r: 66 },
  { i: 5, r: 60 },
  { i: 6, r: 54 },
  { i: 7, r: 48 }
];
</script>

<template>
  <button type="button" class="start" @click="$emit('click')">
    <svg class="start-rings" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
      <!-- Barely-there disc inside the innermost ring. An outline-only control
           on a dark panel reads as an illustration; this gives the centre just
           enough surface to read as pressable. -->
      <circle class="start-core" :cx="CX" :cy="CY" r="48" />
      <circle
        v-for="ring in RINGS"
        :key="ring.i"
        class="ring"
        :class="'ring-' + ring.i"
        :cx="CX"
        :cy="CY"
        :r="ring.r"
      />
    </svg>
    <span class="start-label">{{ t("action.start") }}</span>
  </button>
</template>

<style scoped>
.start {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  /* Same box as SpeedGauge, so the hero does not change height between the
     two screens either. */
  max-width: 19rem;
  aspect-ratio: 1 / 1;
  margin: 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: var(--radius-pill);
  cursor: pointer;
  /* The rings are hairlines; nudging the whole stack is the press feedback,
     because there is no fill to darken. */
  transition: transform var(--dur-fast) var(--ease-out);
}

.start:active {
  transform: scale(0.97);
}

.start-rings {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
  display: block;
}

.start-core {
  fill: rgba(255, 255, 255, 0.025);
  transition: fill var(--dur-base) var(--ease-out);
}

.start:hover .start-core {
  fill: rgba(242, 101, 34, 0.09);
}

.ring {
  fill: none;
  stroke-width: 2;
  /* Pins the hairline to 2 device-independent pixels at every size, so the
     rings do not fatten up on a large screen or vanish on a small one. */
  vector-effect: non-scaling-stroke;
  opacity: var(--ring-base);
  /* Explicit user-space origin rather than transform-box: fill-box. Both work
     on the WebViews in scope, but this one has been safe since Chrome 45 and
     the failure mode of the other is a ring flying off the panel. */
  transform-origin: 110px 110px;
  animation: ring-pulse 2.4s var(--ease-in-out) infinite;
}

/*
  The pulse travels outward: the innermost ring fires first and each ring
  outside it follows 120ms later, so the wave leaves the label and runs to the
  rim. It brightens and swells by 3%, then settles - the rest of the 2.4s cycle
  is deliberate silence, so it reads as a heartbeat rather than a spinner.
*/
@keyframes ring-pulse {
  0% {
    opacity: var(--ring-base);
    transform: scale(1);
  }
  18% {
    opacity: var(--ring-peak);
    transform: scale(1.03);
  }
  46% {
    opacity: var(--ring-base);
    transform: scale(1);
  }
  100% {
    opacity: var(--ring-base);
    transform: scale(1);
  }
}

.ring-1 {
  stroke: var(--start-ring-1);
  --ring-base: 0.3;
  --ring-peak: 0.62;
  animation-delay: 720ms;
}

.ring-2 {
  stroke: var(--start-ring-2);
  --ring-base: 0.36;
  --ring-peak: 0.7;
  animation-delay: 600ms;
}

.ring-3 {
  stroke: var(--start-ring-3);
  --ring-base: 0.44;
  --ring-peak: 0.78;
  animation-delay: 480ms;
}

.ring-4 {
  stroke: var(--start-ring-4);
  --ring-base: 0.54;
  --ring-peak: 0.86;
  animation-delay: 360ms;
}

.ring-5 {
  stroke: var(--start-ring-5);
  --ring-base: 0.66;
  --ring-peak: 0.94;
  animation-delay: 240ms;
}

.ring-6 {
  stroke: var(--start-ring-6);
  --ring-base: 0.78;
  --ring-peak: 1;
  animation-delay: 120ms;
}

.ring-7 {
  stroke: var(--start-ring-7);
  --ring-base: 0.9;
  --ring-peak: 1;
  animation-delay: 0ms;
}

.start-label {
  grid-area: 1 / 1;
  /* The innermost ring is r=48 of a 220 box, i.e. 43.6% of the control wide.
     Staying inside 38% keeps a long translation off the line rather than
     letting it cross one. */
  max-width: 38%;
  color: var(--brand-primary);
  font-size: clamp(1.25rem, 6.5vw, 1.75rem);
  font-weight: var(--fw-bold);
  line-height: 1.15;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  pointer-events: none;
}

/*
  The duration tokens do not reach a @keyframes rule, so reduced motion has to
  be handled here explicitly. Stopping at the resting opacity leaves the design
  intact and only removes the movement.
*/
@media (prefers-reduced-motion: reduce) {
  .ring {
    animation: none;
    opacity: var(--ring-base);
  }
}
</style>
