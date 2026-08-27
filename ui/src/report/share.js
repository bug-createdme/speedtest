import { isSuperApp, shareContent } from "../bridge/windvane.js";

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

  Neither takes a FILE. There is no bridge call that hands the platform a
  spreadsheet. So the bridge solves "share this result" and does not solve
  "export the records", and pretending otherwise would produce a button that
  looks like it exports and quietly shares a sentence instead.

  ── SO EACH THING TAKES THE ROUTE THAT ACTUALLY CARRIES IT ──────────────────

  A summary  -> the bridge, which is exactly what shareContent is for.
  A file     -> the Web Share API with a File attached, which some WebViews do
                support, falling back to <a download>.

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
  /*
    Everything below is omitted when absent rather than printed empty. A shared
    line reading "Province: -" says the app failed to fill it in; a line that is
    not there says nothing, which is the truth.
  */
  if (r.server) lines.push("Server: " + r.server);
  if (r.operator) lines.push("Operator: " + r.operator);
  if (r.place) lines.push("Province: " + r.place);
  if (r.at) lines.push("Time: " + r.at);
  /* Last, because it is the line the recipient acts on. */
  if (r.testId) lines.push("Result ID: " + r.testId);
  return lines.join("\n");
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
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
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
 * Get a file off the device.
 *
 * The bridge cannot carry one, so this is the Web Share API with a File
 * attached where the platform supports it, and a download link where it does
 * not. canShare({files}) is checked rather than assumed: a WebView that has
 * navigator.share for text but refuses files would otherwise throw on every
 * export.
 *
 * @param {Blob}   blob
 * @param {string} filename
 * @param {string} [mime]
 * @returns {Promise<"share"|"download"|"none">}
 */
export async function shareFile(blob, filename, mime) {
  if (!blob) return "none";

  try {
    if (typeof File === "function" && typeof navigator !== "undefined" && navigator.share) {
      const file = new File([blob], filename, { type: mime || blob.type });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return "share";
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "share"; // the user closed it
    // Anything else: fall through to the download.
  }

  return downloadFile(blob, filename) ? "download" : "none";
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
