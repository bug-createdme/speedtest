<script setup>
import { computed } from "vue";

const props = defineProps({
  value: { type: Number, default: 0 },
  /* Drives the accent colour: "download" | "upload" | "neutral". */
  variant: { type: String, default: "neutral" },
  unit: { type: String, default: "Mbps" },
  ariaLabel: { type: String, default: "" },
  /* Dims the arc and the readout while nothing is being measured yet. */
  idle: { type: Boolean, default: false }
});

/*
  SVG gauge, replacing the two gauges the old UIs shipped: a hand-drawn <canvas>
  in index-classic.html and a CSS transform: rotate() stack in index-modern.html.
  Both redrew unconditionally on a 60fps rAF loop (docs/analysis-phase1.md §13).
  Here the arc is one <path> whose stroke-dashoffset is bound to the value, so
  the only work per update is a single attribute write, and the browser
  interpolates the rest off the main thread.

  Geometry: a 270 degree arc, from 135 degrees (lower left) clockwise to 45
  degrees (lower right), leaving the bottom open for the stage label.

  The decade labels sit OUTSIDE the arc. Inside - where they used to be - they
  were overrun by the readout the moment the number reached four digits.
*/
const CX = 110;
const CY = 110;
const R = 84;
const TRACK_WIDTH = 13;
const START_ANGLE = 135;
const SWEEP = 270;
const ARC_LENGTH = (SWEEP / 360) * 2 * Math.PI * R;

/*
  Speed to arc fraction. Same log curve the previous UI used
  (frontend/javascript/index.js mbpsToRotation): a linear gauge spends almost
  its entire sweep on speeds nobody has, and a 4 Mbps link would sit pinned at
  zero. Keeping the identical curve also means a screenshot from the old UI and
  one from this one are directly comparable.
*/
const MAX_SPEED = 10000; // 10 Gbps pins the gauge
const LOG_MAX = Math.log10(MAX_SPEED + 1);

function speedToFraction(speed) {
  if (!(speed > 0)) return 0;
  const fraction = Math.log10(speed + 1) / LOG_MAX;
  return Math.min(Math.max(fraction, 0), 1);
}

function polarAt(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

const arcPath = computed(() => {
  const from = polarAt(START_ANGLE, R);
  const to = polarAt(START_ANGLE + SWEEP, R);
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${R} ${R} 0 1 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
});

const fraction = computed(() => speedToFraction(props.value));

const dashOffset = computed(() => ARC_LENGTH * (1 - fraction.value));

/* The head of the arc, marked with a dot. It is what the eye tracks while the
   number itself is changing too fast to read. */
const head = computed(() => polarAt(START_ANGLE + SWEEP * fraction.value, R));

/* Decade markers, placed on the same log curve as the arc itself. */
const ticks = computed(() =>
  [1, 10, 100, 1000].map((speed) => {
    const angle = START_ANGLE + SWEEP * speedToFraction(speed);
    return {
      speed,
      inner: polarAt(angle, R + TRACK_WIDTH / 2 + 3),
      outer: polarAt(angle, R + TRACK_WIDTH / 2 + 8),
      text: polarAt(angle, R + TRACK_WIDTH / 2 + 17)
    };
  })
);

const gradientId = computed(() => "gauge-" + props.variant);

/*
  Decimals that carry information, and no more.

  Under 10 Mbps the hundredths are a real difference between two links. Over a
  gigabit they are noise - and, worse, they were what pushed the readout past
  the width of the ring: "6642.4" at the old 16vw size ran clean over the
  decade labels. Capping the digit count is what keeps the number inside the
  gauge at every speed rather than only at the ones a test bench produces.
*/
const display = computed(() => {
  const v = props.value;
  if (!(v > 0)) return "0.00";
  if (v < 10) return v.toFixed(2);
  if (v < 1000) return v.toFixed(1);
  return v.toFixed(0);
});

/* Belt and braces: five or more characters (10000, or a locale that formats
   differently) steps the type down rather than overflowing. */
const sizeClass = computed(() =>
  display.value.length >= 5 ? "readout-sm" : "readout-lg"
);
</script>

<template>
  <div class="gauge" :class="['gauge-' + variant, { 'gauge-idle': idle }]">
    <svg viewBox="0 0 220 220" role="img" :aria-label="ariaLabel" focusable="false">
      <!--
        The stop colours come from CSS classes, not stop-color attributes:
        var() does not resolve inside an SVG presentation attribute, so
        stop-color="var(--x)" silently paints black. In a CSS declaration it
        resolves normally.
      -->
      <defs>
        <linearGradient id="gauge-download" x1="0" y1="1" x2="1" y2="0">
          <stop class="stop-dl-from" offset="0%" />
          <stop class="stop-dl-to" offset="100%" />
        </linearGradient>
        <linearGradient id="gauge-upload" x1="0" y1="1" x2="1" y2="0">
          <stop class="stop-ul-from" offset="0%" />
          <stop class="stop-ul-to" offset="100%" />
        </linearGradient>
        <linearGradient id="gauge-neutral" x1="0" y1="1" x2="1" y2="0">
          <stop class="stop-n-from" offset="0%" />
          <stop class="stop-n-to" offset="100%" />
        </linearGradient>
      </defs>

      <path class="gauge-track" :d="arcPath" :stroke-width="TRACK_WIDTH" />

      <!--
        The glow is a second copy of the arc at double width and low opacity,
        not an SVG filter. feGaussianBlur on a path that changes every 200ms is
        a repeated raster on exactly the low-end WebViews this has to run on.
        It has to stay faint: above roughly 10% it stops reading as a halo and
        starts reading as a second, hard-edged ring.
      -->
      <path
        class="gauge-glow"
        :d="arcPath"
        :stroke="'url(#' + gradientId + ')'"
        :stroke-width="TRACK_WIDTH * 2.1"
        :stroke-dasharray="ARC_LENGTH"
        :stroke-dashoffset="dashOffset"
      />
      <path
        class="gauge-fill"
        :d="arcPath"
        :stroke="'url(#' + gradientId + ')'"
        :stroke-width="TRACK_WIDTH"
        :stroke-dasharray="ARC_LENGTH"
        :stroke-dashoffset="dashOffset"
      />

      <circle
        v-if="fraction > 0.008"
        class="gauge-head"
        :cx="head.x"
        :cy="head.y"
        :r="TRACK_WIDTH / 2 + 2"
      />

      <g class="gauge-ticks">
        <line
          v-for="tick in ticks"
          :key="tick.speed"
          :x1="tick.inner.x"
          :y1="tick.inner.y"
          :x2="tick.outer.x"
          :y2="tick.outer.y"
        />
        <text
          v-for="tick in ticks"
          :key="'t' + tick.speed"
          :x="tick.text.x"
          :y="tick.text.y"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ tick.speed }}
        </text>
      </g>
    </svg>

    <div class="gauge-center">
      <!--
        Overridable so the ping stage can put its own reading in the middle of
        the same ring. Before, ping had no gauge at all and the whole layout
        jumped the moment the download phase started.
      -->
      <slot>
        <span class="gauge-value" :class="sizeClass">{{ display }}</span>
        <span class="gauge-unit">{{ unit }}</span>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  width: 100%;
  max-width: 19rem;
  margin: 0 auto;
  aspect-ratio: 1 / 1;
}

.gauge svg {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

.stop-dl-from {
  stop-color: var(--gauge-download-from);
}

.stop-dl-to {
  stop-color: var(--gauge-download-to);
}

.stop-ul-from {
  stop-color: var(--gauge-upload-from);
}

.stop-ul-to {
  stop-color: var(--gauge-upload-to);
}

.stop-n-from {
  stop-color: var(--gauge-neutral-from);
}

.stop-n-to {
  stop-color: var(--gauge-neutral-to);
}

.gauge-track {
  fill: none;
  stroke: var(--track);
  stroke-linecap: round;
}

.gauge-fill {
  fill: none;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-base) var(--ease-out);
}

.gauge-glow {
  fill: none;
  stroke-linecap: round;
  opacity: 0.09;
  transition: stroke-dashoffset var(--dur-base) var(--ease-out);
}

.gauge-head {
  fill: var(--text);
  transition: cx var(--dur-base) var(--ease-out),
    cy var(--dur-base) var(--ease-out);
}

.gauge-idle .gauge-glow,
.gauge-idle .gauge-head {
  opacity: 0;
}

.gauge-ticks line {
  stroke: var(--border);
  stroke-width: 2;
  stroke-linecap: round;
}

.gauge-ticks text {
  fill: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-numeric);
}

.gauge-center {
  position: absolute;
  inset: 18% 16%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  pointer-events: none;
  text-align: center;
}

.gauge-value {
  font-family: var(--font-numeric);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--text);
}

.readout-lg {
  font-size: var(--fs-readout);
}

.readout-sm {
  font-size: var(--fs-readout-sm);
}

.gauge-unit {
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--text-muted);
}

.gauge-download .gauge-unit {
  color: var(--brand-primary);
}

.gauge-upload .gauge-unit {
  color: var(--gauge-upload-from);
}
</style>
