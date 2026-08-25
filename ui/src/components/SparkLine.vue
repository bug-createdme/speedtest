<script setup>
import { computed } from "vue";

const props = defineProps({
  points: { type: Array, default: () => [] },
  variant: { type: String, default: "neutral" }
});

const W = 100;
const H = 32;

/*
  Shape of the run, not a chart: no axes, no ticks, no tooltip. Its job is to
  answer "was this steady or did it collapse halfway" at a glance, which a
  single averaged number cannot.

  Scaled to the run's own peak rather than a fixed ceiling, so the shape stays
  readable on a 4 Mbps link and a 900 Mbps one alike.
*/
const coords = computed(() => {
  const values = props.points;
  if (values.length < 2) return [];
  const peak = Math.max(...values);
  if (!(peak > 0)) return [];
  const step = W / (values.length - 1);
  return values.map((value, i) => ({
    x: i * step,
    y: H - (value / peak) * (H - 3) - 1.5
  }));
});

const path = computed(() =>
  coords.value
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ")
);

/* The same line closed along the baseline, so it can carry a fade underneath.
   A bare stroke on a dark panel reads as a stray hair; with the fill under it
   the sample series reads as a quantity. */
const area = computed(() => {
  const pts = coords.value;
  if (!pts.length) return "";
  const last = pts[pts.length - 1];
  return `${path.value} L ${last.x.toFixed(1)} ${H} L 0 ${H} Z`;
});
</script>

<template>
  <svg
    v-if="path"
    class="spark"
    :class="'spark-' + variant"
    :viewBox="`0 0 ${W} ${H}`"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <!-- stop-color via CSS class: var() does not resolve in a presentation
         attribute. Same reason as SpeedGauge.vue. -->
    <defs>
      <linearGradient :id="'spark-fade-' + variant" x1="0" y1="0" x2="0" y2="1">
        <stop class="spark-stop-top" offset="0%" />
        <stop class="spark-stop-bottom" offset="100%" />
      </linearGradient>
    </defs>
    <path class="spark-area" :d="area" :fill="'url(#spark-fade-' + variant + ')'" />
    <path class="spark-line" :d="path" />
  </svg>
</template>

<style scoped>
.spark {
  width: 100%;
  height: 2rem;
  display: block;
}

.spark-line {
  fill: none;
  stroke: var(--accent, var(--brand-primary));
  stroke-width: 1.75;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.spark-area {
  stroke: none;
}

.spark-stop-top {
  stop-color: var(--accent, var(--brand-primary));
  stop-opacity: 0.16;
}

.spark-stop-bottom {
  stop-color: var(--accent, var(--brand-primary));
  stop-opacity: 0;
}

.spark-download {
  --accent: var(--gauge-download-from);
}

.spark-upload {
  --accent: var(--gauge-upload-from);
}
</style>
