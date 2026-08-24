import { ref } from "vue";
import en from "./en.js";
import lo from "./lo.js";
import vi from "./vi.js";

const MESSAGES = { en, lo, vi };
export const LOCALES = ["lo", "en", "vi"];
const FALLBACK = "en";
const STORAGE_KEY = "unitel-speedtest.locale";

/*
  Key parity check, dev only. A locale that drifts from en.js otherwise fails
  silently as an English string in the middle of a Lao screen, which nobody
  notices until a user reports it.
*/
if (import.meta.env.DEV) {
  const reference = Object.keys(en);
  for (const code of LOCALES) {
    if (code === FALLBACK) continue;
    const keys = Object.keys(MESSAGES[code]);
    const missing = reference.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !reference.includes(k));
    if (missing.length) console.warn("[i18n] " + code + " is missing:", missing);
    if (extra.length) console.warn("[i18n] " + code + " has stale keys:", extra);
  }
}

function detectLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LOCALES.includes(saved)) return saved;
  } catch (e) {
    // Private mode / storage disabled. Fall through to browser detection.
  }
  const candidates = navigator.languages || [navigator.language || ""];
  for (const tag of candidates) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (LOCALES.includes(base)) return base;
  }
  return FALLBACK;
}

export const locale = ref(detectLocale());

export function setLocale(code) {
  if (!LOCALES.includes(code)) return;
  locale.value = code;
  document.documentElement.setAttribute("lang", code);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch (e) {
    // Not being able to remember the choice is not worth failing over.
  }
}

/*
  Translate one key. Params are substituted as {name}. A key with no
  translation falls back to English, then to the key itself - a visible key on
  screen is a better failure than an empty label, because it says what is
  missing.
*/
export function translate(key, params) {
  const table = MESSAGES[locale.value] || MESSAGES[FALLBACK];
  let text = table[key];
  if (text === undefined) text = MESSAGES[FALLBACK][key];
  if (text === undefined) return key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined ? match : String(params[name])
  );
}

/*
  Component-facing API. translate() reads locale.value on every call, so a
  template that calls t() during render registers a dependency on the locale
  ref and re-renders itself when the language changes. No event bus, no wrapper.
*/
export function useI18n() {
  return {
    t: translate,
    locale,
    setLocale,
    locales: LOCALES,
    localeName: (code) => MESSAGES[code]["lang.name"]
  };
}

document.documentElement.setAttribute("lang", locale.value);
