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

function haveDocker() {
  try {
    execSync("docker version", { stdio: "pipe" });
    return true;
  } catch (e) {
    return false;
  }
}

/*
  The encoder arguments, in one place, because they are the same whether ffmpeg
  runs on this machine or inside a container - and because two copies would
  eventually differ in the flag that matters (-movflags +faststart).

  A synthetic clip is fine and a real one is not required: the stage measures
  time-to-first-frame and stalls, which are properties of the player and the
  link rather than of what is on screen.
*/
function ffmpegArgs(outPath) {
  return (
    "-y -f lavfi -i testsrc=size=1280x720:rate=30:duration=" + VIDEO_SECONDS +
    " -f lavfi -i sine=frequency=440:duration=" + VIDEO_SECONDS +
    " -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k" +
    " -movflags +faststart " + outPath
  );
}

/*
  Check the one property that cannot be seen by looking at the file size: the
  moov atom has to come before mdat. Without it a player cannot start until the
  whole clip has arrived, and every measurement reads as one long buffering
  event instead of a time-to-play - a wrong number rather than a missing one,
  which is the failure mode this project keeps refusing to ship.
*/
function checkFaststart(file) {
  const b = fs.readFileSync(file);
  let off = 0;
  const order = [];
  while (off < b.length - 8) {
    let size = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    if (size === 1) size = Number(b.readBigUInt64BE(off + 8));
    if (size < 8) break;
    order.push(type);
    off += size;
  }
  const moov = order.indexOf("moov");
  const mdat = order.indexOf("mdat");
  return moov !== -1 && mdat !== -1 && moov < mdat;
}

function reportVideo(videoPath) {
  const size = fs.statSync(videoPath).size;
  const fast = checkFaststart(videoPath);
  log(VIDEO_NAME + "  " + size.toLocaleString() + " bytes");
  if (fast) {
    log("  faststart verified: moov before mdat");
  } else {
    console.log(
      "\x1b[33m[test-assets] ⚠ moov is NOT before mdat. Playback cannot start\n" +
        "  until the whole clip arrives, so every run will read as one long\n" +
        "  buffering event rather than a time-to-play. Re-encode with\n" +
        "  -movflags +faststart.\x1b[0m"
    );
  }
}

const QUALITIES = [
  { name: "video-sample.mp4", size: "1280x720", crf: 23, duration: VIDEO_SECONDS },
  { name: "video-360p.mp4", size: "640x360", crf: 28, duration: 6 },
  { name: "video-720p.mp4", size: "1280x720", crf: 23, duration: 6 },
  { name: "video-1080p.mp4", size: "1920x1080", crf: 20, duration: 6 }
];

function ffmpegArgsFor(q, outPath) {
  return (
    "-y -f lavfi -i testsrc=size=" + q.size + ":rate=30:duration=" + q.duration +
    " -f lavfi -i sine=frequency=440:duration=" + q.duration +
    " -c:v libx264 -preset medium -crf " + q.crf + " -pix_fmt yuv420p -c:a aac -b:a 128k" +
    " -movflags +faststart " + outPath
  );
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const page = buildBrowsePage(BROWSE_BYTES);
  const pagePath = path.join(OUT_DIR, "browse-sample.html");
  fs.writeFileSync(pagePath, page);
  log("browse-sample.html  " + page.length.toLocaleString() + " bytes");

  const hasFfmpeg = haveFfmpeg();
  const hasDocker = !hasFfmpeg && haveDocker();

  for (const q of QUALITIES) {
    const videoPath = path.join(OUT_DIR, q.name);
    if (fs.existsSync(videoPath)) {
      log(q.name + " already present, left alone");
    } else if (hasFfmpeg) {
      log("ffmpeg found, generating " + q.name + " (" + q.size + ")...");
      try {
        execSync("ffmpeg " + ffmpegArgsFor(q, '"' + videoPath + '"'), { stdio: "pipe" });
        reportVideo(videoPath);
      } catch (e) {
        log("Failed generating " + q.name + ": " + e.message);
      }
    } else if (hasDocker) {
      log("using docker container for " + q.name + "...");
      try {
        execSync(
          'docker run --rm -v "' + OUT_DIR + '":/out linuxserver/ffmpeg:latest ' +
            ffmpegArgsFor(q, "/out/" + q.name),
          { stdio: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
        );
        reportVideo(videoPath);
      } catch (e) {
        log("Failed docker generation for " + q.name + ": " + e.message);
      }
    }
  }

  if (!hasFfmpeg && !hasDocker) {
    log("\x1b[33mffmpeg not found - the video samples were NOT created.\x1b[0m");
    console.log(
      "\nProduce them on a machine that has ffmpeg, or drop in any clip meeting:\n" +
        "  - MP4, H.264 video + AAC audio\n" +
        "  - faststart: the moov atom at the FRONT of the file.\n\n" +
        "  Then check it: the files must be served with CORS and Accept-Ranges.\n"
    );
  }

  console.log("\nNext: docs/test-assets.md - where to put these and what to set.\n");
}

main();
