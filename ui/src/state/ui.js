import { ref, watch } from "vue";

import { networkType as bridgeNetworkType } from "../bridge/windvane.js";

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

/*
  There is no theme switch any more.

  The app is dark only (src/styles/tokens.css §2), so the ref, the two setters
  and the localStorage key that used to live here had nothing left to choose
  between. They are deleted rather than left exported and inert: an
  applyTheme("light") that silently does nothing is worse than no function at
  all. If a light palette ever comes back, it comes back in tokens.css first
  and this is the file that regains a switch.

  Devices that stored "unitel-speedtest.theme" under the old build keep an
  orphan key. Harmless, and cheaper than shipping a migration for a preference
  that no longer exists.
*/

/*
  Connection type, when the platform will say. navigator.connection is Chromium
  only and absent on iOS Safari, so this is strictly an enhancement - never a
  precondition for running a test. In the mini-app this is where
  WVNetwork.getNetworkType plugs in (docs/bridge.md), replacing the guess with
  the real radio type.
*/
export const connectionType = ref("");

/*
  WHERE that string came from, which matters more than the string.

  "bridge"        the super-app told us the real radio type. Trustworthy.
  "effectiveType" navigator.connection.effectiveType. NOT a network type: it is
                  a round-trip-and-throughput bucket, so it answers "4g" for a
                  fast wifi link and for a desktop on fibre, and it never says
                  "5g" at all. Usable as a hint on screen, and unusable as the
                  NET_TYPE / NET_CELL_GEN a report groups by.
  ""              nothing known.

  Recorded separately rather than encoded into the string because the two
  sources produce overlapping values ("4G" from either) while meaning
  completely different things. measurement/record.js reads this to decide
  whether it is allowed to classify the run as mobile at all - misfiling a
  wifi measurement as 3G mobile would put a wrong row into exactly the
  per-network breakdown the report exists to produce.
*/
export const connectionSource = ref("");

/*
  The super-app knows the real radio type; navigator.connection is a guess at
  best and absent entirely on iOS. Whenever the bridge answers, its value
  replaces whatever was detected here.
*/
watch(bridgeNetworkType, value => {
  if (value) {
    connectionType.value = value;
    connectionSource.value = "bridge";
  }
});

export function detectConnection() {
  const c =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return;
  const update = () => {
    // Never downgrade a real answer from the bridge back to a guess.
    if (connectionSource.value === "bridge") return;
    connectionType.value = c.effectiveType
      ? String(c.effectiveType).toUpperCase()
      : "";
    connectionSource.value = connectionType.value ? "effectiveType" : "";
  };
  update();
  if (typeof c.addEventListener === "function") {
    c.addEventListener("change", update);
  }
}
