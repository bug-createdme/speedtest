<script setup>
import { nextTick, ref } from "vue";
import FlagIcon from "./FlagIcon.vue";
import { useI18n } from "../i18n/index.js";
import { useDismissable } from "../composables/useDismissable.js";

const { t, locale, setLocale, locales, localeName } = useI18n();

const open = ref(false);
const root = ref(null);

useDismissable(open, root, close);

/*
  Roving focus, the menu pattern: the popover is a `menu`, each row a
  `menuitemradio`, and real DOM focus moves between them. The alternative -
  a listbox with aria-activedescendant - keeps focus on the container and is
  the fiddlier of the two to get right in a WebView, for no gain on a
  three-option picker.
*/
/* Read out of the DOM rather than collected through template refs: a v-for
   ref array has to be reset every render or it keeps unmounted nodes, and this
   popover renders at most three rows. */
function options() {
  return root.value ? Array.from(root.value.querySelectorAll(".lang-option")) : [];
}

function focusAt(index) {
  const list = options();
  if (!list.length) return;
  list[(index + list.length) % list.length].focus();
}

function indexOfFocused() {
  return options().findIndex((el) => el === document.activeElement);
}

async function toggle() {
  if (open.value) return close();
  open.value = true;
  await nextTick();
  /* Opening onto the current choice, not onto the first row: the menu answers
     "which one is it" before it answers "what else is there". */
  focusAt(Math.max(locales.indexOf(locale.value), 0));
}

function close(restoreFocus) {
  open.value = false;
  if (restoreFocus && root.value) {
    const trigger = root.value.querySelector(".lang-trigger");
    if (trigger) trigger.focus();
  }
}

function pick(code) {
  setLocale(code);
  close(true);
}

function onTriggerKey(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    toggle();
  }
}

function onMenuKey(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusAt(indexOfFocused() + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    focusAt(indexOfFocused() - 1);
  } else if (event.key === "Home") {
    event.preventDefault();
    focusAt(0);
  } else if (event.key === "End") {
    event.preventDefault();
    focusAt(locales.length - 1);
  } else if (event.key === "Tab") {
    /* Tab out means done here; leaving the popover open behind the next
       focused control is how orphaned menus happen. */
    close();
  }
}
</script>

<template>
  <div ref="root" class="lang">
    <button
      type="button"
      class="lang-trigger"
      :aria-label="t('a11y.langSwitch') + ': ' + localeName(locale)"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <FlagIcon :locale="locale" />
      <svg class="lang-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="m4 6.5 4 4 4-4"
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
      class="popover lang-menu"
      role="menu"
      :aria-label="t('a11y.langSwitch')"
      @keydown="onMenuKey"
    >
      <button
        v-for="code in locales"
        :key="code"
        type="button"
        class="lang-option"
        role="menuitemradio"
        :aria-checked="code === locale"
        tabindex="-1"
        @click="pick(code)"
      >
        <FlagIcon :locale="code" />
        <span class="lang-option-name">{{ localeName(code) }}</span>
        <svg
          v-if="code === locale"
          class="lang-check"
          viewBox="0 0 16 16"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M3.5 8.5 6.5 11.5 12.5 5"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.lang {
  position: relative;
}

.lang-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  height: var(--tap-min);
  padding: 0 var(--sp-2) 0 var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out);
}

.lang-trigger:hover {
  border-color: var(--border-strong);
}

.lang-chevron {
  width: 1rem;
  height: 1rem;
  color: var(--text-muted);
  flex: none;
}

.lang-menu {
  min-width: 11rem;
}

.lang-option {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: var(--tap-min);
  padding: 0 var(--sp-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  text-align: start;
  cursor: pointer;
}

.lang-option:hover,
.lang-option:focus-visible {
  background: var(--surface-hover);
}

.lang-option[aria-checked="true"] {
  font-weight: var(--fw-semibold);
}

.lang-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lang-check {
  width: 1rem;
  height: 1rem;
  flex: none;
  color: var(--brand-ink);
}
</style>
