<script setup>
import { computed } from "vue";

const props = defineProps({
  value: { type: Number, default: 0 },
  /* Drives the accent colour: "download" | "upload" | "neutral". */
  variant: { type: String, default: "neutral" },
  label: { type: String, default: "" },
  unit: { type: String, default: "Mbps" },
  ariaLabel: { type: String, default: "" }
});

/*
  SVG gauge, replacing the two gauges the old UIs shipped: a hand-drawn <canvas>
  in index-classic.html and a CSS transform: rotate() stack in index-modern.html.
  Both redrew unconditionally on a 60fps rAF loop (docs/analysis-phase1.md §13).
  Here the arc is one <path> whose stroke-dashoffset is bound to the value, so
  the only work per update is a single attribute write, and the browser
  interpolates the rest off the main thread.

  Geometry: a 270 degree arc, from 135 degrees (lower left) clockwise to 45
  degrees (lower right), leaving the bottom open for the readout.
*/
const CX = 100;
const CY = 100;
const R = 82;
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

function polar(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
}

const arcPath = computed(() => {
  const from = polar(START_ANGLE);
  const to = polar(START_ANGLE + SWEEP);
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${R} ${R} 0 1 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
});

const dashOffset = computed(
  () => ARC_LENGTH * (1 - speedToFraction(props.value))
);

/* Decade markers, placed on the same log curve as the arc itself. */
const ticks = computed(() =>
  [1, 10, 100, 1000].map((speed) => {
    const angle = START_ANGLE + SWEEP * speedToFraction(speed);
    const inner = polarAt(angle, R - 11);
    const outer = polarAt(angle, R - 3);
    const text = polarAt(angle, R - 22);
    return { speed, inner, outer, text };
  })
);

function polarAt(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

/*
  Under 10 Mbps two decimals carry real information; above it they are noise
  that also makes the number jitter visibly on every update.
*/
const display = computed(() => {
  const v = props.value;
  if (!(v > 0)) return "0.00";
  return v < 10 ? v.toFixed(2) : v.toFixed(1);
});
</script>

<template>
  <div class="gauge" :class="'gauge-' + variant">
    <svg viewBox="0 0 200 200" role="img" :aria-label="ariaLabel" focusable="false">
      <path class="gauge-track" :d="arcPath" :stroke-dasharray="ARC_LENGTH" />
      <path
        class="gauge-fill"
        :d="arcPath"
        :stroke-dasharray="ARC_LENGTH"
        :stroke-dashoffset="dashOffset"
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
    <div class="gauge-readout">
      <span class="gauge-value">{{ display }}</span>
      <span class="gauge-unit">{{ unit }}</span>
      <span v-if="label" class="gauge-label label">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  width: 100%;
  max-width: 20rem;
  margin: 0 auto;
  aspect-ratio: 1 / 1;
}

.gauge svg {
  width: 100%;
  height: 100%;
  display: block;
}

.gauge-track {
  fill: none;
  stroke: var(--surface-sunken);
  stroke-width: 12;
  stroke-linecap: round;
}

.gauge-fill {
  fill: none;
  stroke: var(--accent, var(--brand-primary));
  stroke-width: 12;
  stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-base) var(--ease-out);
}

.gauge-ticks line {
  stroke: var(--border-strong);
  stroke-width: 2;
  stroke-linecap: round;
}

.gauge-ticks text {
  fill: var(--text-muted);
  font-size: 9px;
  font-family: var(--font-numeric);
}

.gauge-download {
  --accent: var(--brand-download);
}

.gauge-upload {
  --accent: var(--brand-upload);
}

.gauge-readout {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  pointer-events: none;
}

.gauge-value {
  font-family: var(--font-numeric);
  font-size: var(--fs-readout);
  font-weight: var(--fw-bold);
  line-height: var(--lh-tight);
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.gauge-unit {
  font-size: var(--fs-md);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}

.gauge-label {
  margin-top: var(--sp-2);
}
</style>
