import { ref } from "vue";

/*
  Screen navigation without a router.

  docs/bridge.md records this as a hard constraint, not a preference: the
  mini-app host does not cope with URL-based SPA routing, and the reference
  project had to tear vue-router back out. Starting without it costs nothing
  now and removes that rework later.
*/

export const SCREEN = {
  INITIAL: "initial",
  SERVERS: "servers",
  TESTING: "testing",
  RESULT: "result",
  ERROR: "error",
  HISTORY: "history"
};

export const screen = ref(SCREEN.INITIAL);
/* Where "Back" returns to, so History can be opened from more than one place. */
export const previousScreen = ref(SCREEN.INITIAL);

export function goTo(next) {
  if (next === screen.value) return;
  previousScreen.value = screen.value;
  screen.value = next;
}

export function goBack() {
  screen.value = previousScreen.value;
}

const THEME_KEY = "unitel-speedtest.theme";
/* null = follow the system setting, which is the default. */
export const theme = ref(null);

export function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") applyTheme(saved);
  } catch (e) {
    // Storage unavailable: the system setting still applies.
  }
}

export function applyTheme(next) {
  theme.value = next;
  if (next) document.documentElement.setAttribute("data-theme", next);
  else document.documentElement.removeAttribute("data-theme");
  try {
    if (next) localStorage.setItem(THEME_KEY, next);
    else localStorage.removeItem(THEME_KEY);
  } catch (e) {
    // Not remembering the choice is acceptable; the toggle still works.
  }
}

export function toggleTheme() {
  const systemDark =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
  const current = theme.value || (systemDark ? "dark" : "light");
  applyTheme(current === "dark" ? "light" : "dark");
}

/*
  Connection type, when the platform will say. navigator.connection is Chromium
  only and absent on iOS Safari, so this is strictly an enhancement - never a
  precondition for running a test. In the mini-app this is where
  WVNetwork.getNetworkType plugs in (docs/bridge.md), replacing the guess with
  the real radio type.
*/
export const connectionType = ref("");

export function detectConnection() {
  const c =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return;
  const update = () => {
    connectionType.value = c.effectiveType
      ? String(c.effectiveType).toUpperCase()
      : "";
  };
  update();
  if (typeof c.addEventListener === "function") {
    c.addEventListener("change", update);
  }
}
