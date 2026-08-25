<script setup>
import { nextTick, ref } from "vue";
import { useI18n } from "../i18n/index.js";
import { useDismissable } from "../composables/useDismissable.js";
import { logout } from "../state/session.js";

const { t } = useI18n();

const open = ref(false);
const root = ref(null);
const confirmButton = ref(null);

useDismissable(open, root, close);

/*
  Confirmed, because it deletes the saved results and there is no undo. The
  confirmation is a popover rather than window.confirm() for the reason
  ErrorScreen.vue and HistoryScreen.vue already record: in a WebView the native
  dialog is unstyled, untranslatable and blocks the JS thread.
*/
async function toggle() {
  if (open.value) return close();
  open.value = true;
  await nextTick();
  /* Focus lands on Log out, not on Cancel. The user pressed a button labelled
     "log out"; making them travel to reach the thing they just asked for is
     friction, and the dismissal paths - Escape, tapping away, Cancel - are all
     one action from here. */
  if (confirmButton.value) confirmButton.value.focus();
}

function close(restoreFocus) {
  open.value = false;
  if (restoreFocus && root.value) {
    const trigger = root.value.querySelector(".logout-trigger");
    if (trigger) trigger.focus();
  }
}

function confirm() {
  logout();
  close(true);
}
</script>

<template>
  <div ref="root" class="logout">
    <button
      type="button"
      class="logout-trigger"
      :aria-label="t('action.logout')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M9.5 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h3M16 8l4 4-4 4M20 12H10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div
      v-if="open"
      class="popover logout-confirm"
      role="dialog"
      aria-modal="false"
      :aria-label="t('action.logout')"
    >
      <p class="logout-text">{{ t("logout.confirm") }}</p>
      <div class="logout-actions">
        <button type="button" class="btn btn-ghost logout-btn" @click="close(true)">
          {{ t("action.cancel") }}
        </button>
        <button
          ref="confirmButton"
          type="button"
          class="btn btn-danger logout-btn"
          @click="confirm"
        >
          {{ t("action.logout") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logout {
  position: relative;
}

.logout-trigger {
  width: var(--tap-min);
  height: var(--tap-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  flex: none;
  transition: background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.logout-trigger:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.logout-trigger svg {
  width: 1.25rem;
  height: 1.25rem;
}

.logout-confirm {
  width: 17rem;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.logout-text {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}

.logout-actions {
  display: flex;
  gap: var(--sp-2);
}

.logout-btn {
  flex: 1;
  min-width: 0;
  padding: 0 var(--sp-3);
  font-size: var(--fs-sm);
}
</style>
