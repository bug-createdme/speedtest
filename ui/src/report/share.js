import { isSuperApp, shareContent, writeDiskFile } from "../bridge/windvane.js";

/*
  Getting a result off the device.

  The problem this exists for: a mini-app WebView often refuses an <a download>
  outright. The surveyor taps Export, nothing happens, and a morning's
  measurements stay on the handset.

  ── WHAT THE BRIDGE CAN AND CANNOT DO ───────────────────────────────────────

  The super-app exposes two share methods, and it is worth being exact about
  their shapes because the obvious assumption is wrong:

    CustomServiceJs.shareContent      { content: <text or URL> }
    CustomServiceJs.shareBase64Image  { base64Image: <base64> }

  Neither takes a FILE. Neither opens a share sheet with a spreadsheet in it.
  So these two solve "share this result" and do not solve "export the records",
  and pretending otherwise produces a button that looks like it exports and
  quietly shares a sentence instead - which is exactly what Android was doing.

  There is a third call, WVFile.write, which does put bytes on the device. It
  is not a share sheet and it carries text only; bridge/windvane.js has the
  detail and saveFile() below has the consequences.

  ── SO EACH THING TAKES THE ROUTE THAT ACTUALLY CARRIES IT ──────────────────

  A summary  -> the bridge, which is exactly what shareContent is for.
  A file     -> the Web Share API with a File attached where the WebView has it
                (iOS does), WVFile.write inside the Android container, and
                <a download> on the plain web. saveFile() picks.

  Both report whether they worked, so a caller can tell the user rather than
  leave them tapping a button that does nothing. Neither ever throws: a share
  that fails is a result, not an exception.

  ── WHAT WOULD MAKE THE FILE CASE ALWAYS WORK ───────────────────────────────

  Uploading the records and sharing a LINK - which is one call to shareContent
  and works on every platform. That needs somewhere to upload to, which is
  CHANGE-009 and does not exist yet: record_endpoint is empty, and the queue
  holds everything on the device. When it lands, shareLink() below is the whole
  of the work.
*/

/**
 * A result in one line, for pasting to network operations.
 *
 * Pure and value-based rather than reading state, so the wording can be tested
 * and so it cannot accidentally share a different run than the one on screen.
 *
 * @param {object} run
 * @param {string} [run.testId]   the id operations quotes to find this run
 * @param {number} [run.download] Mbit/s
 * @param {number} [run.upload]   Mbit/s
 * @param {number} [run.ping]     ms
 * @param {string} [run.server]   test point the run measured against
 * @param {string} [run.operator] carrier, when it could be determined
 * @param {string} [run.place]    province, when it could be determined
 * @param {string} [run.at]       ISO timestamp
 * @returns {string}
 */
export function summaryText(run) {
  const r = run || {};
  const num = (v, dp) => (typeof v === "number" && isFinite(v) ? v.toFixed(dp) : "-");
  const lines = [
    "Speed test result",
    "Download: " + num(r.download, 1) + " Mbps",
    "Upload: " + num(r.upload, 1) + " Mbps",
    "Ping: " + num(r.ping, 0) + " ms"
  ];
  if (r.qoeScore !== undefined && r.qoeScore !== null) {
    lines.push("Overall QoE: " + r.qoeScore + "/100" + (r.qoeGrade ? " (" + r.qoeGrade + ")" : ""));
  }
  if (r.browsingScore !== undefined && r.browsingScore !== null) {
    lines.push("Web Browsing: " + r.browsingScore + "/100");
  }
  if (r.streamingScore !== undefined && r.streamingScore !== null) {
    lines.push("Video Streaming: " + r.streamingScore + "/100");
  }
  if (r.server) lines.push("Server: " + r.server);
  if (r.operator) lines.push("Operator: " + r.operator);
  if (r.place) lines.push("Province: " + r.place);
  if (r.at) lines.push("Time: " + r.at);
  /* Last, because it is the line the recipient acts on. */
  if (r.testId) lines.push("Result ID: " + r.testId);
  return lines.join("\n");
}

/**
 * Safely copy text to clipboard with modern API and fallback.
 * Works across desktop browsers and embedded mobile WebViews.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fall through to legacy DOM copy
    }
  }

  if (typeof document !== "undefined") {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "-9999px";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      el.setSelectionRange(0, text.length);
      const successful = document.execCommand("copy");
      document.body.removeChild(el);
      if (successful) return true;
    } catch (e) {
      // Nothing left
    }
  }

  return false;
}

/**
 * Share a line of text - the super-app's sheet where there is one, the
 * browser's where there is not, the clipboard as a last resort.
 *
 * @param {string} text
 * @returns {Promise<"bridge"|"web"|"clipboard"|"none">} how it went out
 */
export async function shareSummary(text) {
  if (!text) return "none";

  if (isSuperApp()) {
    try {
      if (await shareContent(text)) return "bridge";
    } catch (e) {
      // Fall through: a bridge that refused is not a reason to give up.
    }
  }

  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ text });
      return "web";
    }
  } catch (e) {
    /* AbortError means the user closed the sheet themselves. That is not a
       failure and must not trigger a fallback that copies to the clipboard
       behind their back. */
    if (e && e.name === "AbortError") return "web";
  }

  try {
    if (await copyToClipboard(text)) {
      return "clipboard";
    }
  } catch (e) {
    // Nothing left to try.
  }
  return "none";
}

/**
 * Share a link to something already uploaded.
 *
 * Unused today - record_endpoint is empty, so nothing has a URL yet. Kept
 * because it is the one route that carries a file on every platform, and when
 * CHANGE-009 gives records an address this is the whole of the change.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function shareLink(url) {
  if (!url) return false;
  return (await shareSummary(url)) !== "none";
}

/**
 * The plain download, kept separate so the fallback is visible rather than
 * buried inside the share path.
 *
 * @returns {boolean} whether the attempt was made - NOT whether the WebView
 *          honoured it, which is not observable from here
 */
export function downloadFile(blob, filename) {
  if (typeof document === "undefined" || typeof URL === "undefined") return false;
  /*
    CRITICAL ANDROID SUPERAPP FIX:
    Inside the Unitel SuperApp / WindVane / mPaaS container WebView, clicking
    <a href="blob:..." download="..."> is intercepted by the container's
    shouldOverrideUrlLoading as an external application Intent.
    Since Android has no application handling the "blob:" scheme, it throws
    ActivityNotFoundException and displays a toast with the Unitel logo:
    "Sorry, the corresponding program was not found for your device".
    Never attempt blob: navigation in super-app.
  */
  if (isSuperApp()) return false;

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    /* Revoking immediately can cancel the download on some WebViews; a moment
       is enough for the navigation to have been picked up. */
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    return false;
  }
}

/*
  ── THE UPLOAD ROUTE ────────────────────────────────────────────────────────

  The route that works when none of the client-side ones do, which on Android
  is always: POST the export to backend/export.php, get back a URL, and hand
  the URL to shareContent - an API the container has already authorized, as
  the working "send as message" button proves.

  The endpoint is injected rather than imported so this module stays testable
  without the engine's settings, matching how sync/outbox.js is handed
  record_endpoint. Empty means the route is off.
*/
let exportEndpoint = "";

/**
 * Point the upload route at backend/export.php. Called once at boot.
 *
 * @param {string} url
 * @returns {void}
 */
export function setExportEndpoint(url) {
  exportEndpoint = typeof url === "string" ? url.trim() : "";
}

/**
 * Upload one export and get a download URL for it.
 *
 * @param {Blob}   blob
 * @param {string} filename
 * @returns {Promise<{ok: boolean, url?: string, expiresIn?: number, reason?: string}>}
 */
export async function uploadExport(blob, filename) {
  if (!exportEndpoint) return { ok: false, reason: "no-endpoint" };
  if (!blob || !filename) return { ok: false, reason: "empty" };
  if (typeof fetch !== "function") return { ok: false, reason: "no-fetch" };

  const url =
    exportEndpoint +
    (exportEndpoint.indexOf("?") === -1 ? "?" : "&") +
    "cors=true&name=" +
    encodeURIComponent(filename);

  try {
    const response = await fetch(url, {
      method: "POST",
      /* The bytes as the body, not multipart: nothing here needs a field name,
         and a raw body is one fewer thing to encode wrongly. */
      body: blob,
      headers: { "Content-Type": blob.type || "application/octet-stream" }
    });
    if (!response.ok) {
      return { ok: false, reason: "http-" + response.status };
    }
    const payload = await response.json();
    if (!payload || !payload.url) return { ok: false, reason: "no-url" };
    return { ok: true, url: String(payload.url), expiresIn: Number(payload.expires_in) || 0 };
  } catch (e) {
    /* A failed upload is a result, not an exception - the caller has a message
       to show and, on the web, a download still to try. */
    console.warn("[share] export upload failed", e);
    return { ok: false, reason: "network" };
  }
}

/**
 * Put a file where the user can find it, by whichever route this device has.
 *
 * ── THE FOUR ROUTES, AND WHO CAN TAKE THEM ──────────────────────────────────
 *
 *   share    navigator.share({files}). iOS WKWebView has it, and this is the
 *            route the working iOS export already takes.
 *   bridge   WVFile.write. Text only, and only once the container has granted
 *            the mini-app WVFile - see bridge/windvane.js.
 *   link     upload, then share the URL. The route that works on Android when
 *            the other two do not, which today is always.
 *   download <a download>. The plain web; refused inside the super-app.
 *
 * The order matters. Share first, because when it exists it produces a real
 * file the user picks a destination for, in either format, with nothing
 * leaving the handset. The upload comes after both local routes precisely
 * because it does send subscriber data to a server: it is the fallback, never
 * the first choice.
 *
 * ── WHY BINARY HAS NO BRIDGE ROUTE ──────────────────────────────────────────
 *
 * An .xlsx is a ZIP. WVFile.write stores the string it is handed and does not
 * base64-decode, so pushing base64 through it yields a text file full of
 * base64 with an .xlsx name - which is what the previous build shipped and why
 * Android "exported" something no spreadsheet would open. Callers pass
 * bridgeText only for formats that survive as text; a binary export skips the
 * bridge and goes to the link route rather than writing a corrupt file.
 *
 * @param {object}  opts
 * @param {Blob}    opts.blob        what the share, link and download routes send
 * @param {string}  opts.filename
 * @param {string}  [opts.mime]
 * @param {string}  [opts.bridgeText] the same content as text, when the format
 *                                    has a faithful text form. Omit for binary.
 * @returns {Promise<{ok: boolean, route: string, reason?: string, detail?: *}>}
 */
export async function saveFile(opts) {
  const { blob, filename, mime, bridgeText } = opts || {};
  if (!blob || !filename) return { ok: false, route: "none", reason: "empty" };

  try {
    if (typeof File === "function" && typeof navigator !== "undefined" && navigator.share) {
      const file = new File([blob], filename, { type: mime || blob.type });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return { ok: true, route: "share" };
      }
    }
  } catch (e) {
    /* The user closing the sheet is not a failure, and must not fall through
       to a second attempt they did not ask for. */
    if (e && e.name === "AbortError") return { ok: true, route: "share" };
  }

  if (isSuperApp()) {
    /* Local first. Only a text format can go this way, and only if the
       container has granted WVFile - a refusal here is expected, not an error,
       and the link route is what it falls through to. */
    let local = null;
    if (bridgeText) {
      local = await writeDiskFile(filename, bridgeText);
      if (local.ok) return { ok: true, route: "bridge", detail: local };
    }

    const uploaded = await uploadExport(blob, filename);
    if (uploaded.ok) {
      const how = await shareSummary(uploaded.url);
      if (how !== "none") {
        return { ok: true, route: "link", detail: { how, expiresIn: uploaded.expiresIn } };
      }
      return { ok: false, route: "none", reason: "link-not-shared", detail: uploaded };
    }

    /* Nothing carried it, so report the failure the reader can act on. When
       the link route is configured it is the one expected to work, so its
       reason wins; when it is switched off the local refusal is the whole
       story. */
    if ("no-endpoint" !== uploaded.reason) {
      return { ok: false, route: "none", reason: uploaded.reason, detail: uploaded };
    }
    if (local && !local.ok) {
      return { ok: false, route: "none", reason: local.reason, detail: local.detail };
    }
    return { ok: false, route: "none", reason: "binary-no-bridge-route", detail: uploaded };
  }

  if (downloadFile(blob, filename)) return { ok: true, route: "download" };
  return { ok: false, route: "none", reason: "blocked" };
}

