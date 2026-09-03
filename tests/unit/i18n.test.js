import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  LOCALES,
  detectLocale,
  getUrlLocale,
  locale,
  normalizeLocale,
  setLocale,
  syncSuperAppLanguage,
  translate,
  useI18n
} from "../../ui/src/i18n/index.js";
import en from "../../ui/src/i18n/en.js";
import la from "../../ui/src/i18n/la.js";
import vi from "../../ui/src/i18n/vi.js";

function createMemoryStorage() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
}

describe("i18n key parity", () => {
  it("has identical keys across en, la, and vi", () => {
    const enKeys = Object.keys(en).sort();
    const laKeys = Object.keys(la).sort();
    const viKeys = Object.keys(vi).sort();

    const missingLa = enKeys.filter((k) => !laKeys.includes(k));
    const extraLa = laKeys.filter((k) => !enKeys.includes(k));
    const missingVi = enKeys.filter((k) => !viKeys.includes(k));
    const extraVi = viKeys.filter((k) => !enKeys.includes(k));

    expect(missingLa, "la is missing keys").toEqual([]);
    expect(extraLa, "la has extra keys").toEqual([]);
    expect(missingVi, "vi is missing keys").toEqual([]);
    expect(extraVi, "vi has extra keys").toEqual([]);
  });
});

describe("normalizeLocale", () => {
  it("normalizes Lao variants to la", () => {
    expect(normalizeLocale("la")).toBe("la");
    expect(normalizeLocale("lo")).toBe("la");
    expect(normalizeLocale("LA")).toBe("la");
    expect(normalizeLocale("LO")).toBe("la");
    expect(normalizeLocale("la-LA")).toBe("la");
    expect(normalizeLocale("lo_LA")).toBe("la");
    expect(normalizeLocale("lao")).toBe("la");
  });

  it("normalizes Vietnamese variants to vi", () => {
    expect(normalizeLocale("vi")).toBe("vi");
    expect(normalizeLocale("VI")).toBe("vi");
    expect(normalizeLocale("vi-VN")).toBe("vi");
    expect(normalizeLocale("vi_VN")).toBe("vi");
    expect(normalizeLocale("vie")).toBe("vi");
  });

  it("normalizes English variants to en", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("EN")).toBe("en");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("en_US")).toBe("en");
    expect(normalizeLocale("eng")).toBe("en");
  });

  it("returns empty string for non-string or unknown values", () => {
    expect(normalizeLocale("")).toBe("");
    expect(normalizeLocale(null)).toBe("");
    expect(normalizeLocale(undefined)).toBe("");
    expect(normalizeLocale("fr")).toBe("");
    expect(normalizeLocale("zh-CN")).toBe("");
  });
});

describe("getUrlLocale", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    globalThis.window = {
      location: { search: "" }
    };
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it("extracts lang parameter", () => {
    globalThis.window.location.search = "?lang=la";
    expect(getUrlLocale()).toBe("la");
  });

  it("extracts and normalizes lo to la", () => {
    globalThis.window.location.search = "?lang=lo";
    expect(getUrlLocale()).toBe("la");
  });

  it("extracts language parameter", () => {
    globalThis.window.location.search = "?language=vi";
    expect(getUrlLocale()).toBe("vi");
  });

  it("returns empty string when no search param matches", () => {
    globalThis.window.location.search = "?foo=bar";
    expect(getUrlLocale()).toBe("");
  });
});

describe("setLocale and reactivity", () => {
  const originalStorage = globalThis.localStorage;

  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage();
  });

  afterEach(() => {
    globalThis.localStorage = originalStorage;
  });

  it("updates locale ref and writes to both storage keys", () => {
    setLocale("la");
    expect(locale.value).toBe("la");
    expect(globalThis.localStorage.getItem("unitel-speedtest.locale")).toBe("la");
    expect(globalThis.localStorage.getItem("language")).toBe("la");

    setLocale("vi");
    expect(locale.value).toBe("vi");
    expect(globalThis.localStorage.getItem("unitel-speedtest.locale")).toBe("vi");
    expect(globalThis.localStorage.getItem("language")).toBe("vi");
  });

  it("normalizes 'lo' to 'la' when setting locale", () => {
    setLocale("lo");
    expect(locale.value).toBe("la");
    expect(globalThis.localStorage.getItem("unitel-speedtest.locale")).toBe("la");
    expect(globalThis.localStorage.getItem("language")).toBe("la");
  });

  it("ignores unsupported locale codes", () => {
    setLocale("en");
    setLocale("fr");
    expect(locale.value).toBe("en");
  });

  it("provides correct translation and reactive helper", () => {
    setLocale("en");
    expect(translate("action.start")).toBe("Start");

    setLocale("vi");
    expect(translate("action.start")).toBe("Bắt đầu");

    setLocale("la");
    expect(translate("action.start")).toBe("ເລີ່ມ");
  });

  it("exposes useI18n helper with locales and names", () => {
    const i18n = useI18n();
    expect(i18n.locales).toEqual(["la", "en", "vi"]);
    expect(i18n.localeName("la")).toBe("ລາວ");
    expect(i18n.localeName("lo")).toBe("ລາວ");
    expect(i18n.localeName("en")).toBe("English");
    expect(i18n.localeName("vi")).toBe("Tiếng Việt");
  });
});
