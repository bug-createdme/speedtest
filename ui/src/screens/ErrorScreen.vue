<script setup>
import { computed, ref } from "vue";
import { test } from "../state/test.js";
import { SCREEN, goTo } from "../state/ui.js";
import { useI18n } from "../i18n/index.js";

defineEmits(["retry"]);
const { t } = useI18n();

const showDetails = ref(false);

/*
  Replaces the native alert() the old UI raised when no server answered
  (frontend/javascript/index.js). In a WebView that dialog is unstyled, cannot
  be translated, blocks the JS thread, and offers exactly one action: OK. This
  screen says what failed, what the user can actually do about it, and keeps
  both recovery paths reachable.
*/
const kind = computed(() => (test.error && test.error.kind) || "");
const isNoServer = computed(() => kind.value === "no-server");

/*
  Say which side of the problem the user is on.

  Every failure used to read "Can't reach the test server", which points at
  infrastructure. For the two commonest field failures - no signal at all, and
  the app being backgrounded mid-run - that is simply the wrong answer, and it
  sends the person looking in a direction where there is nothing to find. The
  fix is on their screen in both cases.
*/
const KINDS = {
  offline: { title: "error.offlineTitle", body: "error.offlineBody" },
  "offline-during": { title: "error.offlineTitle", body: "error.offlineDuringBody" },
  backgrounded: { title: "error.backgroundedTitle", body: "error.backgroundedBody" },
  "no-server": { title: "error.noServerTitle", body: "error.noServerBody" }
};

const title = computed(() => t(KINDS[kind.value] ? KINDS[kind.value].title : "error.title"));
const body = computed(() => t(KINDS[kind.value] ? KINDS[kind.value].body : "error.body"));

/* Choosing a different server cannot help when the device has no link. */
const isLocalProblem = computed(
  () => kind.value === "offline" || kind.value === "offline-during" || kind.value === "backgrounded"
);

const canChooseServer = computed(() => test.servers.length > 1 && !isLocalProblem.value);

const hints = computed(() => {
  if (kind.value === "backgrounded") {
    return [t("error.hintStayOpen"), t("error.hintRetry")];
  }
  if (isLocalProblem.value) {
    return [t("error.hintNetwork"), t("error.hintCoverage"), t("error.hintRetry")];
  }
  return [t("error.hintNetwork"), t("error.hintVpn"), t("error.hintRetry")];
});
</script>

<template>
  <section class="error">
    <div class="error-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          d="M12 8v5m0 3.5v.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>

    <h2 class="error-title">{{ title }}</h2>
    <p class="error-body">{{ body }}</p>

    <ul class="hints card">
      <li v-for="hint in hints" :key="hint" class="hint">
        <span class="hint-dot" aria-hidden="true"></span>
        <span>{{ hint }}</span>
      </li>
    </ul>

    <div class="actions">
      <button type="button" class="btn btn-primary btn-block" @click="$emit('retry')">
        {{ t("action.retry") }}
      </button>
      <button
        v-if="canChooseServer"
        type="button"
        class="btn btn-ghost btn-block"
        @click="goTo(SCREEN.SERVERS)"
      >
        {{ t("action.chooseServer") }}
      </button>
      <button
        v-if="test.error && test.error.detail"
        type="button"
        class="btn btn-quiet"
        :aria-expanded="showDetails"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? t("action.hideDetails") : t("action.showDetails") }}
      </button>
    </div>

    <pre v-if="showDetails && test.error" class="detail-box">{{ test.error.detail }}</pre>
  </section>
</template>

<style scoped>
.error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  flex: 1;
  justify-content: center;
  text-align: center;
  width: 100%;
}

/* The glyph in a tinted disc rather than loose on the background: at 3rem on
   an otherwise empty screen a bare outline reads as a broken image. */
.error-icon {
  width: 4.5rem;
  height: 4.5rem;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--danger-bg);
  color: var(--danger);
}

.error-icon svg {
  width: 2.25rem;
  height: 2.25rem;
}

.error-title {
  font-size: var(--fs-xl);
  font-weight: var(--fw-bold);
  max-width: 20rem;
}

.error-body {
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  max-width: 28rem;
}

.hints {
  margin: 0;
  padding: var(--sp-4);
  list-style: none;
  font-size: var(--fs-sm);
  text-align: start;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  width: 100%;
}

.hint {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  color: var(--text-secondary);
}

.hint-dot {
  width: 0.4rem;
  height: 0.4rem;
  margin-top: 0.55em;
  border-radius: var(--radius-pill);
  background: var(--brand-primary);
  flex: none;
}

.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
}

.detail-box {
  width: 100%;
  margin: 0;
  padding: var(--sp-3);
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
  font-size: var(--fs-xs);
  text-align: start;
  overflow-x: auto;
}
</style>
