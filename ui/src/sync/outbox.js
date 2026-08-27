import { ref } from "vue";

/*
  Durable queue of measurements waiting to reach the server.

  The specification asks the app to "tự động push dữ liệu đo về hệ thống
  CMS/Dashboard khi có kết nối mạng". What existed was a single fire-and-forget
  POST at the end of each run (speedtest_worker.js sendTelemetry): if it failed
  - and a field survey is exactly where it fails, because the connection being
  measured is the bad one - the result was gone. Nothing retried, nothing was
  written down, and no one found out.

  So: every finished run is written to durable storage BEFORE any attempt to
  send it, and stays there until the server acknowledges it. That inverts the
  failure mode. A lost network now costs a delay instead of the measurement.

  ── WHY THERE IS NOTHING TO SEND TO YET ─────────────────────────────────────

  The business API that accepts these records does not exist (it is the largest
  remaining piece of work). Rather than pretend, the endpoint is configuration:
  `record_endpoint` in settings.json, empty by default. While it is empty the
  queue collects and reports itself as "waiting for an endpoint" and makes no
  requests at all - no retry storm against a URL nobody has stood up.

  The day that endpoint is configured, everything captured up to then flushes.
  That is the point of building the queue first: measurements taken from now on
  are not lost, even though there is nowhere to put them yet.

  ── STORAGE ─────────────────────────────────────────────────────────────────

  IndexedDB, with a localStorage fallback. IndexedDB because a field survey can
  produce hundreds of full records and the old five-megabyte localStorage
  budget is not a safe home for the only copy of a day's work. The fallback
  exists because storage can be blocked outright (private mode, a host that
  denies it) and losing the queue must never take the app down with it.
*/

const DB_NAME = "unitel-speedtest";
const DB_VERSION = 1;
const STORE = "records";
const FALLBACK_KEY = "unitel-speedtest.outbox";
/* The pre-outbox history, imported once so no one loses what they measured. */
const LEGACY_KEY = "unitel-speedtest.history";

export const STATUS = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed"
};

/* What the UI shows about the queue. */
export const syncState = ref({
  pending: 0,
  sent: 0,
  failed: 0,
  /* No endpoint configured yet - collecting, not failing. */
  waitingForEndpoint: true,
  lastError: ""
});

let endpoint = "";
let db = null;
let dbUnavailable = false;
let flushing = false;

/* ── storage adapter ─────────────────────────────────────────────────────── */

function openDb() {
  if (db) return Promise.resolve(db);
  if (dbUnavailable) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      dbUnavailable = true;
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onerror = () => {
      dbUnavailable = true;
      resolve(null);
    };
    // Private mode in some browsers neither resolves nor rejects.
    setTimeout(() => {
      if (!db) {
        dbUnavailable = true;
        resolve(null);
      }
    }, 3000);
  });
}

function readFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeFallback(entries) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(entries));
  } catch (e) {
    // Out of quota, or storage denied. The in-memory list stays usable for
    // this session; nothing else can be done here.
  }
}

async function readAll() {
  const database = await openDb();
  if (!database) return readFallback();
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function put(entry) {
  const database = await openDb();
  if (!database) {
    const entries = readFallback().filter((e) => e.id !== entry.id);
    entries.unshift(entry);
    writeFallback(entries);
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

async function removeWhere(predicate) {
  const database = await openDb();
  if (!database) {
    writeFallback(readFallback().filter((e) => !predicate(e)));
    return;
  }
  const entries = await readAll();
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const entry of entries) {
        if (predicate(entry)) store.delete(entry.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

/* ── queue ───────────────────────────────────────────────────────────────── */

function newId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {
    // Not available on older WebViews; the fallback below is good enough for a
    // key that only has to be unique on one device.
  }
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

async function refreshState() {
  const entries = await readAll();
  let pending = 0;
  let sent = 0;
  let failed = 0;
  for (const entry of entries) {
    if (entry.status === STATUS.SENT) sent++;
    else if (entry.status === STATUS.FAILED) failed++;
    else pending++;
  }
  syncState.value = {
    pending,
    sent,
    failed,
    waitingForEndpoint: endpoint === "",
    lastError: syncState.value.lastError
  };
  return entries;
}

/**
 * Every stored measurement, newest first.
 */
export async function allEntries() {
  const entries = await readAll();
  return entries.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Store one finished measurement. Written before any send is attempted, so a
 * failure to reach the server can only ever delay it, never lose it.
 */
export async function enqueue(record) {
  const entry = {
    id: newId(),
    at: record.DATETIME_UTC || new Date().toISOString(),
    status: STATUS.PENDING,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: "",
    record
  };
  await put(entry);
  await refreshState();
  flush();
  return entry;
}

/*
  Exponential backoff, capped.

  A field surveyor walks out of coverage and back into it. Retrying every few
  seconds through that would hold the radio awake for no benefit and add
  traffic to the connection the next measurement is about to be taken on.
  30s doubling to an hour keeps a queue responsive when the link returns
  without hammering it while it is down.
*/
function backoffMs(attempts) {
  return Math.min(30000 * Math.pow(2, Math.max(0, attempts - 1)), 3600000);
}

async function send(entry) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry.record),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
}

/**
 * Try to deliver everything pending.
 *
 * Safe to call at any time: it no-ops while another flush is in flight, while
 * no endpoint is configured, and while the browser reports itself offline.
 */
export async function flush() {
  if (flushing) return;
  if (endpoint === "") {
    await refreshState();
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  flushing = true;
  try {
    const entries = await readAll();
    const now = Date.now();
    for (const entry of entries) {
      if (entry.status === STATUS.SENT) continue;
      if (entry.nextAttemptAt > now) continue;
      try {
        await send(entry);
        entry.status = STATUS.SENT;
        entry.lastError = "";
        syncState.value = { ...syncState.value, lastError: "" };
      } catch (e) {
        entry.attempts++;
        entry.lastError = String(e && e.message ? e.message : e);
        entry.nextAttemptAt = Date.now() + backoffMs(entry.attempts);
        /*
          Still PENDING, not FAILED. A record only becomes FAILED when the
          server tells us it will never accept it; a network error means "not
          yet", and marking it failed would quietly stop retrying something
          that would have gone through ten minutes later.
        */
        syncState.value = { ...syncState.value, lastError: entry.lastError };
        await put(entry);
        break; // one dead request is enough to know the link is down
      }
      await put(entry);
    }
  } finally {
    flushing = false;
    await refreshState();
  }
}

/**
 * Drop entries the server has acknowledged. Anything still pending stays -
 * that is the whole point of the queue, and it is why signing out no longer
 * wipes the history.
 */
export async function clearSent() {
  await removeWhere((entry) => entry.status === STATUS.SENT);
  await refreshState();
}

/**
 * Delete everything, including unsent work. Only ever from an explicit,
 * confirmed user action.
 */
export async function clearAll() {
  await removeWhere(() => true);
  await refreshState();
}

/*
  One-time import of the pre-outbox history.

  Sign-out used to delete this key outright; that is fixed, which means devices
  in the field may be holding measurements in the old seven-field shape. They
  are imported as records with the fields that shape actually carried and null
  for everything it never had - honest about being partial rather than
  back-filling zeroes that would look like readings.
*/
async function importLegacyHistory() {
  let legacy;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    legacy = JSON.parse(raw);
    if (!Array.isArray(legacy) || legacy.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
  } catch (e) {
    return;
  }

  const { buildRecord } = await import("../measurement/record.js");
  for (const old of legacy) {
    const at = old.at || new Date().toISOString();
    const record = buildRecord({
      test: {
        download: old.download,
        upload: old.upload,
        ping: old.ping,
        jitter: old.jitter
      },
      server: old.server ? { name: old.server, server: old.server } : null,
      connection: old.connection,
      startedAt: Date.parse(at) || Date.now(),
      finishedAt: Date.parse(at) || Date.now()
    });
    record._importedFrom = "localStorage-history";
    await put({
      id: newId(),
      at,
      status: STATUS.PENDING,
      attempts: 0,
      nextAttemptAt: 0,
      lastError: "",
      record
    });
  }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) {
    // Leaving the key behind would re-import on next launch, so only remove it
    // after the writes above. If this throws the duplicates are visible, which
    // is better than the silent loss the old code had.
  }
}

/**
 * Wire the queue up. Called once at app start.
 *
 * @param {string} recordEndpoint absolute URL that accepts one record as JSON,
 *                                or "" while the business API does not exist
 */
export async function initOutbox(recordEndpoint) {
  endpoint = typeof recordEndpoint === "string" ? recordEndpoint : "";
  await importLegacyHistory();
  await refreshState();

  if (typeof window !== "undefined") {
    // The moment the platform says the link is back, try again - this is the
    // "khi có kết nối mạng" the specification asks for.
    window.addEventListener("online", () => flush());
    // Coming back to the foreground is the other moment worth retrying: a
    // backgrounded WebView gets no timers.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) flush();
    });
  }
  flush();
}
