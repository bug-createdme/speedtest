<script setup>
import { computed } from "vue";

const props = defineProps({
  points: { type: Array, default: () => [] },
  variant: { type: String, default: "neutral" }
});

const W = 100;
const H = 28;

/*
  Shape of the run, not a chart: no axes, no ticks, no tooltip. Its job is to
  answer "was this steady or did it collapse halfway" at a glance, which a
  single averaged number cannot.

  Scaled to the run's own peak rather than a fixed ceiling, so the shape stays
  readable on a 4 Mbps link and a 900 Mbps one alike.
*/
const path = computed(() => {
  const values = props.points;
  if (values.length < 2) return "";
  const peak = Math.max(...values);
  if (!(peak > 0)) return "";
  const step = W / (values.length - 1);
  return values
    .map((value, i) => {
      const x = i * step;
      const y = H - (value / peak) * (H - 2) - 1;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
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
    <path :d="path" />
  </svg>
</template>

<style scoped>
.spark {
  width: 100%;
  height: 1.75rem;
  display: block;
}

.spark path {
  fill: none;
  stroke: var(--accent, var(--brand-primary));
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.spark-download {
  --accent: var(--brand-download);
}

.spark-upload {
  --accent: var(--brand-upload);
}
</style>
