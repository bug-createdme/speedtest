import { ref } from "vue";

import { connectionSource, connectionType } from "../state/ui.js";

/*
  What the network looked like at a moment in time, and whether it stayed that
  way for the length of a run.

  The reason this exists is a failure mode that produces no error at all. A
  measurement takes about thirty seconds; over that window a handset can change
  cell, fall from LTE to 3G, hand over to wifi, or lose coverage entirely. The
  run completes either way and the numbers look ordinary. Stored without a
  check, that row is filed as "4G in Attapeu" when half of it was 3G, and it is
  averaged into a per-province figure nobody can afterwards tell was wrong.

  The nPerf export the report is built on takes the same view - it carries
  MOBILE_RSRP_START and MOBILE_RSRP_END, MOBILE_RSSI_START and _END, and so on
  through every radio field. Reading conditions once is not enough to know what
  a measurement measured.

  So: snapshot before, snapshot after, compare, and mark the record rather than
  discard it. Marked and counted beats silently missing - a row that says "I
  changed network halfway" is a fact operations can filter on, while a run that
  quietly deleted itself is indistinguishable from one that never happened.
*/

/*
  navigator.onLine, kept live.

  Worth stating what it does and does not mean: true only says the device has
  *a* network interface up. It goes false reliably when the radio drops, and it
  can stay true on a connection that reaches nothing at all - a captive portal,
  a dead APN. So it is trustworthy as a negative signal and not as a positive
  one, which is exactly how it is used below: never started while it is false,
  never trusted to mean the link is good while it is true.
*/
export const online = ref(true);

function readOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Everything known about the network right now.
 *
 * @returns {{type: string, source: string, online: boolean, at: number}}
 */
export function networkSnapshot() {
  return {
    type: connectionType.value || "",
    source: connectionSource.value || "",
    online: readOnline(),
    at: Date.now()
  };
}

/**
 * Did the network hold still for the whole run?
 *
 * @param {object} start snapshot taken before the run
 * @param {object} end   snapshot taken after it
 * @returns {null|{reason: string, detail: string}} null when nothing changed
 */
export function compareNetwork(start, end) {
  if (!start || !end) return null;

  if (start.online && !end.online) {
    return {
      reason: "went-offline",
      detail: "The device lost its connection during the measurement."
    };
  }

  const before = String(start.type || "").toUpperCase();
  const after = String(end.type || "").toUpperCase();

  /*
    An empty reading is not a change. The platform simply may not have
    answered - on iOS Safari navigator.connection does not exist at all - and
    treating "we do not know" as "it changed" would flag every run on those
    devices as suspect, which would make the flag useless by making it
    universal.
  */
  if (before === "" || after === "") return null;
  if (before === after) return null;

  return {
    reason: "network-changed",
    detail: "Network changed from " + before + " to " + after + " during the measurement."
  };
}

/**
 * Start watching. Called once at app start.
 *
 * @param {function} onLost called when the link drops while something cares
 */
export function watchNetwork(onLost) {
  online.value = readOnline();
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => {
    online.value = true;
  });
  window.addEventListener("offline", () => {
    online.value = false;
    if (typeof onLost === "function") onLost();
  });
}
