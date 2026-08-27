/**
 * make-test-assets.js
 *
 * Builds the two files the Web and Video stages measure against, ready to be
 * copied onto the test server. Run: node scripts/make-test-assets.js
 *
 * ── WHY THESE ARE OURS AND NOT facebook.com ─────────────────────────────────
 *
 * The obvious configuration - point the Web stage at the real sites the partner
 * browses - cannot work, and fails in the worst way. The stage counts bytes with
 * fetch(), which needs the target to send CORS headers, and none of those sites
 * do. Measured from a browser: facebook.com, youtube.com, soundcloud.com,
 * instagram.com and apple.com all reject a cross-origin read outright, and the
 * no-cors fallback returns an opaque response with zero readable bytes.
 *
 * Configured anyway, the stage reports Error, and kpi.js counts an Error as a
 * failed measurement rather than a slow network - so the Web indicator would
 * quietly have no samples at all while the configuration looked complete. That
 * is worse than leaving it unset, which at least says "Skip" on screen.
 *
 * nPerf reads those sites because it is a native app driving its own webview.
 * This is JavaScript inside somebody else's WebView, and that difference is not
 * something configuration can close.
 *
 * So the stage measures the same indicator against a resource we serve. Same
 * measurement, same link, different source - and a report putting these numbers
 * next to nPerf's must say so.
 *
 * ── WHY THE PAYLOAD IS RANDOM ───────────────────────────────────────────────
 *
 * The stage counts bytes as they come out of the stream reader, which is AFTER
 * any transport compression has been undone. If the server gzips a compressible
 * page, the connection moves far fewer bytes than the counter reports and the
 * measurement flatters the link.
 *
 * Random padding raises the floor but does not remove the problem, and the real
 * number is worth stating rather than hand-waving: base64 of random bytes still
 * gzips to 75% (measured, 1,048,576 -> 789,819). So a compressing proxy in front
 * of this would have the counter reach 500,000 bytes after only ~377,000 bytes
 * had crossed the link - a third too fast.
 *
 * What actually guarantees the reading is compression being OFF, and both
 * backends do that: Go's FileServer never compresses, and backend/asset.php
 * disables it explicitly. Anyone putting a CDN in front of the test server must
 * turn compression off for these two files, or the Web indicator flatters every
 * connection it measures by that 33%.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "test-assets");

/*
  1 MB, comfortably above the 500,000-byte threshold the indicator is scored on.
  The margin matters: the stage stops at the threshold, so a resource that is
  only just big enough would make "reached 500 KB" and "downloaded the whole
  file" the same event, and a truncated transfer would look like a pass.
*/
const BROWSE_BYTES = 1_048_576;

const VIDEO_NAME = "video-sample.mp4";
const VIDEO_SECONDS = 10;

function log(msg) {
  console.log("\x1b[36m[test-assets]\x1b[0m " + msg);
}

/*
  A page, not a blob of noise: real markup, a real stylesheet, real structure -
  the sort of document the indicator is about - padded to size with an
  incompressible data URI, which is exactly how a real page carries its weight
  (images, already compressed).
*/
function buildBrowsePage(targetBytes) {
  const head =
    "<!doctype html>\n" +
    '<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>Unitel network survey - web access sample</title>\n" +
    "<style>\n" +
    "body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#0f1115;color:#e8ecf1}\n" +
    ".wrap{max-width:840px;margin:0 auto;padding:32px}\n" +
    "h1{font-size:28px;margin:0 0 12px}\n" +
    "p{color:#9aa7b4}\n" +
    ".card{background:#171b22;border:1px solid #262c36;border-radius:12px;padding:20px;margin:16px 0}\n" +
    "</style>\n</head>\n<body>\n<div class=\"wrap\">\n" +
    "<h1>Web access sample</h1>\n" +
    "<p>This page exists to be downloaded, not read. The web-access indicator asks\n" +
    "whether the connection moved the first 500 KB of a page inside four seconds;\n" +
    "this is a page of known size, served with CORS so its bytes can be counted.</p>\n" +
    '<div class="card">\n<p>Payload below is random and therefore incompressible, so the\n' +
    "bytes counted are the bytes that crossed the link.</p>\n</div>\n" +
    '<img alt="" width="1" height="1" src="data:image/png;base64,';

  const tail = '">\n</div>\n</body>\n</html>\n';

  const overhead = Buffer.byteLength(head) + Buffer.byteLength(tail);
  const padBytes = Math.max(0, targetBytes - overhead);
  /* base64 carries 3 bytes per 4 characters. */
  const raw = crypto.randomBytes(Math.ceil((padBytes * 3) / 4));
  let payload = raw.toString("base64");
  payload = payload.slice(0, padBytes);

  return Buffer.from(head + payload + tail, "utf8");
}

function haveFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "pipe" });
    return true;
  } catch (e) {
    return false;
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const page = buildBrowsePage(BROWSE_BYTES);
  const pagePath = path.join(OUT_DIR, "browse-sample.html");
  fs.writeFileSync(pagePath, page);
  log("browse-sample.html  " + page.length.toLocaleString() + " bytes");

  const videoPath = path.join(OUT_DIR, VIDEO_NAME);
  if (fs.existsSync(videoPath)) {
    log(VIDEO_NAME + " already present, left alone");
  } else if (haveFfmpeg()) {
    /*
      A synthetic clip is fine here and a real one is not required: the stage
      measures time-to-first-frame and stalls, which are properties of the
      player and the link, not of what is on screen. What DOES matter is that
      it is a normal H.264/AAC MP4 with its moov atom at the front, or playback
      cannot start until the whole file has arrived and every run reads as one
      long buffering event.
    */
    log("ffmpeg found, generating a " + VIDEO_SECONDS + "s 720p clip...");
    execSync(
      'ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=' + VIDEO_SECONDS +
        ' -f lavfi -i sine=frequency=440:duration=' + VIDEO_SECONDS +
        ' -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k' +
        ' -movflags +faststart "' + videoPath + '"',
      { stdio: "pipe" }
    );
    log(VIDEO_NAME + "  " + fs.statSync(videoPath).size.toLocaleString() + " bytes");
  } else {
    log("\x1b[33mffmpeg not found - the video sample was NOT created.\x1b[0m");
    console.log(
      "\nProduce it on a machine that has ffmpeg, or drop in any clip meeting:\n" +
        "  - MP4, H.264 video + AAC audio\n" +
        "  - about " + VIDEO_SECONDS + "s, 720p\n" +
        "  - faststart: the moov atom at the FRONT of the file. Without it playback\n" +
        "    cannot begin until the whole clip has arrived, and every measurement\n" +
        "    reads as one long buffering event instead of a time-to-play.\n\n" +
        "  ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30:duration=" + VIDEO_SECONDS + " \\\n" +
        "         -f lavfi -i sine=frequency=440:duration=" + VIDEO_SECONDS + " \\\n" +
        "         -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k \\\n" +
        "         -movflags +faststart test-assets/" + VIDEO_NAME + "\n\n" +
        "  Then check it: the file must be served with CORS and Accept-Ranges.\n"
    );
  }

  console.log("\nNext: docs/test-assets.md - where to put these and what to set.\n");
}

main();
