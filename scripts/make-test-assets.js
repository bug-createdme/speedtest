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
  /* The file just written, not VIDEO_NAME: this runs once per quality, and
     naming them all "video-sample.mp4" made the faststart line - the one thing
     here worth reading - unattributable to the file it checked. */
  log(path.basename(videoPath) + "  " + size.toLocaleString() + " bytes");
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

/*
  The quality ladder, by the only property that decides whether a tier measures
  anything: the bitrate it demands.

  These were CRF-encoded testsrc colour bars, and that made every tier useless.
  Synthetic bars carry almost no detail, so x264 hit the requested quality at a
  fraction of the bits real footage needs: the "1080p" tier came out at 370
  kbps and the "360p" one at 176. A 370 kbps clip plays smoothly over almost
  any connection, so the stage would report "highest stable quality: 1080p" for
  a link that could not carry a real 1080p stream for a second - a wrong number
  rather than a missing one.

  So each tier is now pinned to the bitrate the real thing costs, taken from
  the streaming ladders these resolutions are actually delivered at, and the
  encoder is held to it with minrate=maxrate=b:v. What the clip shows still
  does not matter - the stage measures time-to-first-frame and stalls, which
  are properties of the player and the link - but how many bits it takes to
  deliver is the whole measurement.

  Noise is what makes the number honest. Told to spend 6 Mbps on colour bars,
  x264 pads with near-empty frames that a compressing proxy could squeeze back
  out; grain gives it detail that genuinely costs that much to encode. Same
  reasoning as the incompressible padding in the browse sample above.
*/
const QUALITIES = [
  { name: "video-sample.mp4", size: "1280x720", bitrate: "3000k", duration: VIDEO_SECONDS },
  { name: "video-360p.mp4", size: "640x360", bitrate: "800k", duration: 6 },
  { name: "video-720p.mp4", size: "1280x720", bitrate: "3000k", duration: 6 },
  { name: "video-1080p.mp4", size: "1920x1080", bitrate: "6000k", duration: 6 }
];

/*
  The clip the tiers are cut from, if one has been supplied.

  Real footage rather than colour bars, because these play on screen during the
  test and a tester watching a rainbow of bars reasonably wonders whether the
  thing is broken. It changes nothing about the measurement - what is measured
  is time to first frame, stalls, and how many bits had to arrive - but it is
  the difference between a screen that looks finished and one that does not.

  NOT downloaded by this script. The asset ships inside an operator's app, so
  which clip and under which licence is a decision to make deliberately, once,
  rather than something a build step quietly resolves off somebody's CDN - and
  a hardcoded URL is the failure this project has already had twice.

  Supply one as VIDEO_SOURCE=/path/to/clip.mp4, or drop any video into
  test-assets/source/. Without one the synthetic pattern is used, so the script
  still works on a machine that has no clip and CI stays self-contained.

  The source has to be at least as large as the biggest tier (1920x1080) and at
  least as long as the longest duration below, or the tier it feeds is upscaled
  or cut short. See docs/test-assets.md.
*/
function findSource() {
  const explicit = process.env.VIDEO_SOURCE;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error("VIDEO_SOURCE points at " + explicit + ", which does not exist");
    }
    return explicit;
  }
  const dir = path.join(OUT_DIR, "source");
  if (!fs.existsSync(dir)) return null;
  const clip = fs
    .readdirSync(dir)
    .filter((f) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(f))
    .sort()[0];
  return clip ? path.join(dir, clip) : null;
}

function ffmpegArgsFor(q, outPath, source) {
  const bufsize = parseInt(q.bitrate, 10) * 2 + "k";
  /*
    Held to the bitrate either way. That is the whole point of the tier - see
    the note on QUALITIES - and it is what stops a well-compressing clip from
    turning the 1080p tier back into something any link can carry.
  */
  const rate =
    " -c:v libx264 -preset veryfast -b:v " + q.bitrate +
    " -minrate " + q.bitrate + " -maxrate " + q.bitrate + " -bufsize " + bufsize +
    /*
      nal-hrd=cbr, or the tier does not cost what it claims.

      -minrate is advisory to x264: told to spend 6 Mbps on real footage
      downscaled from a good master, it stops at the quality it considers
      enough and hands back 5.27. Measured on this ladder, ABR under-ran the
      1080p tier by 12% and a slower preset did not help; CBR reached 5.94.

      What fills the gap is filler NAL units rather than picture, and that is
      the right trade for a measurement asset: those bytes cross the link and
      have to arrive on time exactly like picture bytes, so the tier still asks
      the question it claims to ask - can this connection sustain 6 Mbps - and
      now it asks it identically whichever clip is supplied. Under ABR, swapping
      the source silently changes what every tier costs.
    */
    ' -x264opts "nal-hrd=cbr:force-cfr=1"' +
    " -pix_fmt yuv420p -c:a aac -b:a 128k" +
    " -movflags +faststart " + outPath;

  if (source) {
    /* lanczos because these are downscales from a much larger master, and the
       default bilinear leaves them soft enough to look like a bad encode. */
    return (
      '-y -i "' + source + '"' +
      " -f lavfi -i sine=frequency=440:duration=" + q.duration +
      " -map 0:v:0 -map 1:a:0 -t " + q.duration +
      ' -vf "scale=' + q.size.replace("x", ":") + ':flags=lanczos"' +
      rate
    );
  }

  return (
    "-y -f lavfi -i testsrc2=size=" + q.size + ":rate=30:duration=" + q.duration +
    " -f lavfi -i sine=frequency=440:duration=" + q.duration +
    ' -filter_complex "[0:v]noise=alls=28:allf=t+u[v]" -map "[v]" -map 1:a' +
    rate
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

  const source = findSource();
  if (source) {
    log("source clip: " + path.relative(ROOT, source));
  } else {
    log("no source clip - using the synthetic pattern. See findSource().");
  }

  for (const q of QUALITIES) {
    const videoPath = path.join(OUT_DIR, q.name);
    if (fs.existsSync(videoPath)) {
      log(q.name + " already present, left alone");
    } else if (hasFfmpeg) {
      log("ffmpeg found, generating " + q.name + " (" + q.size + ")...");
      try {
        execSync("ffmpeg " + ffmpegArgsFor(q, '"' + videoPath + '"', source), { stdio: "pipe" });
        reportVideo(videoPath);
      } catch (e) {
        log("Failed generating " + q.name + ": " + e.message);
      }
    } else if (hasDocker) {
      log("using docker container for " + q.name + "...");
      try {
        execSync(
          'docker run --rm -v "' + OUT_DIR + '":/out linuxserver/ffmpeg:latest ' +
            ffmpegArgsFor(q, "/out/" + q.name, source ? "/out/source/" + path.basename(source) : null),
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
