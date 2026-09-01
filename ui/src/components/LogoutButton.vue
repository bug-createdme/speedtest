<script setup>
import { useI18n } from "../i18n/index.js";
import { logout } from "../state/session.js";

const { t } = useI18n();

function handleLogout(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  console.log("[LogoutButton] User tapped logout");
  logout();
}
</script>

<template>
  <button
    type="button"
    class="logout-trigger"
    :aria-label="t('action.logout')"
    :title="t('action.logout')"
    @click="handleLogout"
    @touchend="handleLogout"
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
</template>

<style scoped>
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
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.logout-trigger:hover {
  background: var(--danger-bg);
  color: var(--danger);
}

.logout-trigger:active {
  transform: scale(0.94);
}

.logout-trigger svg {
  width: 1.25rem;
  height: 1.25rem;
}
</style>
