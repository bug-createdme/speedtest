import { ref } from "vue";

import { buildRecord, recordsToCsv } from "../measurement/record.js";
import { recordsToXlsx } from "../report/xlsx.js";
import {
  STATUS,
  allEntries,
  clearAll,
  clearSent,
  enqueue,
  syncState
} from "../sync/outbox.js";

/*
  The history screen's view of the outbox.

  This used to be the storage layer itself: a seven-field entry per run in
  localStorage, which was the only copy of a measurement and was deleted on
  sign-out. It is now a thin read over sync/outbox.js, so the list on screen
  and the queue waiting to reach the server are the same records rather than
  two stores that drift.

  The exported surface is unchanged apart from being asynchronous, because the
  underlying store is.
*/

/* Rows for the screen: the full record plus what the list actually renders. */
export const history = ref([]);
/* Re-exported so the screen can show queue state without importing the outbox. */
export { syncState };

function toRow(entry) {
  const r = entry.record || {};
  return {
    id: entry.id,
    at: entry.at,
    status: entry.status,
    attempts: entry.attempts,
    /* kbit/s in the record, Mbit/s on screen - see measurement/record.js. */
    download: r.SPEED_DOWNLOAD_AVG ? r.SPEED_DOWNLOAD_AVG / 1000 : 0,
    upload: r.SPEED_UPLOAD_AVG ? r.SPEED_UPLOAD_AVG / 1000 : 0,
    ping: r.SPEED_LATENCY_MIN || 0,
    jitter: r.SPEED_LATENCY_JITTER || 0,
    server: r.SPEED_SERVER_POOL_NAME || "",
    connection: r.NET_NAME || "",
    /*
      Location is null until the context layer lands. The screen renders
      nothing rather than a placeholder, so the gap stays visible instead of
      looking like a value.
    */
    lat: r.LOCATION_LAT,
    lng: r.LOCATION_LNG,
    place: r.LOCATION_AAL1 || null,
    record: r
  };
}

export async function loadHistory() {
  const entries = await allEntries();
  history.value = entries.map(toRow);
}

/**
 * Store one finished run.
 *
 * Builds the canonical record, puts it in the outbox (which persists it before
 * attempting any send), and refreshes the list.
 */
export async function saveResult(input) {
  const record = buildRecord(input);
  await enqueue(record);
  await loadHistory();
  return record;
}

/**
 * Clear the history the user can see.
 *
 * Deliberately two different operations behind one intent: everything the
 * server has acknowledged is deleted outright, and anything still queued is
 * kept, because deleting it would throw away the only copy of a measurement
 * that has not reached anyone yet. The screen says how many were kept.
 *
 * @param {boolean} includeUnsent true only from an explicit "delete unsent too"
 * @returns {number} how many entries were kept because they are still pending
 */
export async function clearHistory(includeUnsent) {
  if (includeUnsent) {
    await clearAll();
  } else {
    await clearSent();
  }
  await loadHistory();
  return history.value.filter((row) => row.status !== STATUS.SENT).length;
}

/**
 * The full records as CSV, not the four columns the screen shows.
 *
 * The old export carried seven fields. This one carries every column the
 * partner's report format defines, with empty cells for what has not been
 * collected yet - which is also the quickest way for anyone to see exactly
 * which columns are still missing.
 */
export function toCsv() {
  return recordsToCsv(history.value.map((row) => row.record));
}

/**
 * The same records, the same columns, as a real spreadsheet.
 *
 * Not a nicer CSV: Excel re-interprets a CSV on open, and the subscriber number
 * loses its leading zero, long identifiers turn into scientific notation, and in
 * a locale whose list separator is ";" the whole file lands in one column. An
 * .xlsx carries a type per cell, so what was written is what is read back. See
 * report/xlsx.js.
 *
 * @returns {Uint8Array}
 */
export function toXlsx() {
  return recordsToXlsx(history.value.map((row) => row.record));
}
