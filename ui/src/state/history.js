import { ref } from "vue";

/*
  Local test history. docs/analysis-phase1.md §13 #16: the old UI stored
  nothing, so every result was lost the moment the page changed.

  Deliberately localStorage and nothing else. It keeps working offline, it
  needs no backend (there is none yet), and it never leaves the device - which
  matters because a result carries the user's IP and ISP.
*/

const STORAGE_KEY = "unitel-speedtest.history";
const MAX_ENTRIES = 100;

export const history = ref([]);

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // Corrupt or unavailable storage. An unusable history is not a reason to
    // block the test itself, so start empty.
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    // Quota or private mode. The in-memory list stays usable for this session.
  }
}

export function loadHistory() {
  history.value = read();
}

export function saveResult(result) {
  const entry = {
    at: new Date().toISOString(),
    download: result.download,
    upload: result.upload,
    ping: result.ping,
    jitter: result.jitter,
    server: result.server || "",
    connection: result.connection || ""
  };
  const next = [entry, ...history.value].slice(0, MAX_ENTRIES);
  history.value = next;
  write(next);
}

export function clearHistory() {
  history.value = [];
  write([]);
}

export function toCsv() {
  const header = "timestamp,download_mbps,upload_mbps,ping_ms,jitter_ms,server,connection";
  const rows = history.value.map((e) =>
    [
      e.at,
      e.download,
      e.upload,
      e.ping,
      e.jitter,
      csvField(e.server),
      csvField(e.connection)
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

function csvField(value) {
  const s = String(value || "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
