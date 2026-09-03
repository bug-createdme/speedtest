import { ref } from "vue";
import en from "./en.js";
import la from "./la.js";
import vi from "./vi.js";
import { fetchAppLanguage } from "../bridge/windvane.js";

const MESSAGES = { la, en, vi, lo: la };
export const LOCALES = ["la", "en", "vi"];
const FALLBACK = "en";
const STORAGE_KEY = "unitel-speedtest.locale";
const LEGACY_STORAGE_KEY = "language";

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

/**
 * Normalizes input language string into supported locale code ("la", "vi", "en").
 * Maps variants:
 * - "la", "lo", "lao", "la-LA", "lo-LA" -> "la"
 * - "vi", "vie", "vi-VN" -> "vi"
 * - "en", "eng", "en-US" -> "en"
 */
export function normalizeLocale(raw) {
  if (!raw || typeof raw !== "string") return "";
  const clean = raw.toLowerCase().trim().replace(/_/g, "-");
  if (clean.startsWith("la") || clean.startsWith("lo")) return "la";
  if (clean.startsWith("vi")) return "vi";
  if (clean.startsWith("en")) return "en";
  return "";
}

/**
 * Checks URL query parameters for language/locale hints passed by SuperApp
 * (e.g. ?lang=la, ?language=lo, ?locale=vi).
 */
export function getUrlLocale() {
  if (typeof window === "undefined" || !window.location || !window.location.search) return "";
  try {
    const params = new URLSearchParams(window.location.search);
    const candidate = params.get("lang") || params.get("language") || params.get("locale");
    return normalizeLocale(candidate);
  } catch (e) {
    return "";
  }
}

export function detectLocale() {
  // 1. URL parameters (highest priority, direct from SuperApp launch)
  const fromUrl = getUrlLocale();
  if (fromUrl) {
    try {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      localStorage.setItem(LEGACY_STORAGE_KEY, fromUrl);
    } catch (e) {}
    return fromUrl;
  }

  // 2. Saved locale in localStorage
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const normalizedSaved = normalizeLocale(saved);
    if (normalizedSaved && LOCALES.includes(normalizedSaved)) return normalizedSaved;
  } catch (e) {
    // Private mode / storage disabled. Fall through to browser detection.
  }

  // 3. Browser / system language
  if (typeof navigator !== "undefined") {
    const candidates = navigator.languages || [navigator.language || ""];
    for (const tag of candidates) {
      const normalized = normalizeLocale(tag);
      if (normalized && LOCALES.includes(normalized)) return normalized;
    }
  }

  return FALLBACK;
}

export const locale = ref(detectLocale());

export function setLocale(code) {
  const target = normalizeLocale(code);
  if (!target || !LOCALES.includes(target)) return;
  locale.value = target;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("lang", target);
  }
  try {
    localStorage.setItem(STORAGE_KEY, target);
    localStorage.setItem(LEGACY_STORAGE_KEY, target);
  } catch (e) {
    // Not being able to remember the choice is not worth failing over.
  }
}

/**
 * Synchronize language with SuperApp (URL param or CustomServiceJs.getAppSetting bridge).
 * Updates reactive locale ref on change.
 */
export async function syncSuperAppLanguage() {
  const urlLang = getUrlLocale();
  if (urlLang) {
    setLocale(urlLang);
    return urlLang;
  }

  try {
    const bridgeLang = await fetchAppLanguage(3000);
    if (bridgeLang) {
      setLocale(bridgeLang);
      return bridgeLang;
    }
  } catch (e) {
    console.warn("[i18n] SuperApp language sync failed:", e);
  }

  return locale.value;
}

/*
  Translate one key. Params are substituted as {name}. A key with no
  translation falls back to English, then to the key itself - a visible key on
  screen is a better failure than an empty label, because it says what is
  missing.
*/
export function translate(key, params) {
  const table = MESSAGES[locale.value] || MESSAGES[FALLBACK];
  let text = table ? table[key] : undefined;
  if (text === undefined) text = MESSAGES[FALLBACK] ? MESSAGES[FALLBACK][key] : undefined;
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
    localeName: (code) => {
      const normalized = normalizeLocale(code) || code;
      return (MESSAGES[normalized] && MESSAGES[normalized]["lang.name"]) || code;
    }
  };
}

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.setAttribute("lang", locale.value);
}

// Automatically listen for system or SuperApp container lifecycle changes
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    syncSuperAppLanguage();
  });
  if (typeof document !== "undefined") {
    document.addEventListener("resume", () => {
      syncSuperAppLanguage();
    });
  }
}
