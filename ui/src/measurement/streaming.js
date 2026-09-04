/**
 * streaming.js - Video Streaming Quality of Experience (QoE) Measurement
 *
 * Plays real video in a real <video> element, one tier at a time, and reports
 * per tier what a viewer would have felt:
 *
 *   - Initial loading      time from src to the first frame on screen (ms)
 *   - Buffering            how many stalls, and how long they lasted in total
 *   - Performance rate     share of the wall clock that was actual playback
 *   - Data used            bytes the tier pulled off the network
 *   - Resolution           the height the decoder actually produced
 *
 * Performance rate is the headline number, defined the way nPerf's streaming
 * scenario defines it:
 *
 *     played / (played + startup + buffering)
 *
 * i.e. of all the time the viewer spent in front of the player, how much of it
 * was video moving. A clip that plays 5.56s after 0.49s of loading and never
 * stalls rates 91.9% - not 100%, because half a second of that was spent
 * staring at a blank frame. Startup counts against the tier for the same
 * reason a viewer counts it: they were waiting.
 *
 * Runs on the main thread because a real player requires the DOM.
 */

import { getQoEGrade } from "./qoe.js";

/*
  The id of the element the testing screen renders for the player. Same
  arrangement the browsing stage uses: Vue owns the box, this module puts the
  element inside it.
*/
export const VIDEO_CONTAINER_ID = "video-testing-container";

export const STREAM_STATUS = {
  OK: "OK",
  TIMEOUT: "Timeout",
  ERROR: "Error",
  SKIP: "Skip"
};

/*
  How a tier's numbers were arrived at.

  PLAYBACK is a tier that really played: every metric is a reading taken off
  the media element. PROBE is a tier the player could not open - codec refused,
  autoplay blocked, container unsupported - where the file was fetched instead
  to find out whether the network could have delivered it. A probe yields a
  response time and nothing else, so its performance rate, buffering and
  resolution stay null rather than being filled in with a playback that never
  happened. The screen marks those rows; see the probe path in playVideoClip.
*/
export const MEASURED_BY = {
  PLAYBACK: "playback",
  PROBE: "probe"
};

/*
  Where a tier's byte count came from, best source first.

  DECODED reads the media element's own counters - what the decoder was fed,
  which for a compressed stream is the payload that crossed the network.
  Chromium and Android WebView expose it; WKWebView does not.
  TIMING reads Resource Timing, which needs the origin to send
  Timing-Allow-Origin, and most video hosts do not.
  ESTIMATED is Content-Length scaled by how much of the file was buffered - a
  derivation, not a reading, so the screen footnotes it.
  None of the three available means the tier reports no data used at all,
  rather than a number nobody can stand behind.
*/
export const BYTES_SOURCE = {
  DECODED: "decoded",
  TIMING: "timing",
  ESTIMATED: "estimated"
};

/*
  Development defaults. A deployment overrides these from settings.json, and
  should point them at its own assets - scripts/make-test-assets.js builds
  video-360p/720p/1080p.mp4 for exactly this, and explains why measuring
  against somebody else's CDN measures somebody else's CDN.

  Each label is the height the file actually decodes to, checked by playing it
  rather than taken from its name. Both were: what was labelled 360p here is a
  640x480 file and what was labelled 720p is 960x540, so every run reported a
  "highest stable quality" that no tier had ever produced.

  The third entry used to be media.w3.org's sintel trailer, which Chromium -
  and therefore Android WebView - refuses outright with MEDIA_ELEMENT_ERROR:
  Format error. That tier could never be measured: it failed in about 150ms,
  every run, and the stage reported it as a video result.
*/
export const DEFAULT_VIDEO_QUALITIES = [
  { quality: "480p", height: 480, url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4", duration: 3500 },
  { quality: "540p", height: 540, url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", duration: 3500 },
  { quality: "1080p", height: 1080, url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4", duration: 3500 }
];
export const DEFAULT_QUALITIES = DEFAULT_VIDEO_QUALITIES;

/*
  How long a finished tier's numbers stay on screen before the next one starts.

  Presentational only - excluded from every reported number - but the same
  problem the browsing stage has with its dwell: three tiers on a fast
  connection each settle in well under a second, and a table nobody can read is
  not a table. This is the window the screen spends saying "loading results".
*/
export const DEFAULT_VIDEO_SETTLE_MS = 900;

export const STREAMING_THRESHOLDS = {
  STARTUP_EXCELLENT_MS: 700,
  STARTUP_GOOD_MS: 1500,
  STARTUP_AVERAGE_MS: 3000,
  STARTUP_POOR_MS: 5000
};

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/**
 * Formats a byte count the way a data-usage readout reads. Returns null for
 * "not measured", so a caller can tell that apart from a measured zero.
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " kiB";
  return (n / (1024 * 1024)).toFixed(2) + " MiB";
}

/**
 * The share of the viewer's wall clock that was video actually moving, 0 - 100.
 * See the module header for why startup counts against it.
 */
export function performanceRate(playedMs, startupMs, bufferingMs) {
  const played = Math.max(0, Number(playedMs) || 0);
  if (played <= 0) return null;
  const overhead = Math.max(0, Number(startupMs) || 0) + Math.max(0, Number(bufferingMs) || 0);
  return Number(((played / (played + overhead)) * 100).toFixed(2));
}

/**
 * Calculates a 0 - 100 Video Streaming QoE Score.
 */
export function calculateStreamingScore(metrics) {
  if (!metrics || metrics.status === STREAM_STATUS.SKIP || metrics.status === STREAM_STATUS.ERROR) {
    if (metrics?.status === STREAM_STATUS.SKIP) return { score: null, grade: null };
    return { score: 0, grade: getQoEGrade(0) };
  }

  const startup = Number(metrics.startupTimeMs ?? metrics.timeToPlayMs) || 0;
  const bufferCount = Number(metrics.bufferingCount ?? metrics.rebufferCount) || 0;
  const bufferDuration = Number(metrics.bufferingDurationMs ?? metrics.rebufferingMs) || 0;
  const rebufferingRatio = Number(metrics.rebufferingRatio) || 0;
  const highestQuality = Number(metrics.highestStableQuality ?? metrics.quality) || 0;

  // 1. Startup Score (0 - 100)
  let startupScore = 0;
  if (startup <= 0) {
    startupScore = 50;
  } else if (startup <= STREAMING_THRESHOLDS.STARTUP_EXCELLENT_MS) {
    startupScore = 100;
  } else if (startup <= STREAMING_THRESHOLDS.STARTUP_GOOD_MS) {
    startupScore = Math.round(90 - ((startup - STREAMING_THRESHOLDS.STARTUP_EXCELLENT_MS) / (STREAMING_THRESHOLDS.STARTUP_GOOD_MS - STREAMING_THRESHOLDS.STARTUP_EXCELLENT_MS)) * 15);
  } else if (startup <= STREAMING_THRESHOLDS.STARTUP_AVERAGE_MS) {
    startupScore = Math.round(75 - ((startup - STREAMING_THRESHOLDS.STARTUP_GOOD_MS) / (STREAMING_THRESHOLDS.STARTUP_AVERAGE_MS - STREAMING_THRESHOLDS.STARTUP_GOOD_MS)) * 25);
  } else if (startup <= STREAMING_THRESHOLDS.STARTUP_POOR_MS) {
    startupScore = Math.round(50 - ((startup - STREAMING_THRESHOLDS.STARTUP_AVERAGE_MS) / (STREAMING_THRESHOLDS.STARTUP_POOR_MS - STREAMING_THRESHOLDS.STARTUP_AVERAGE_MS)) * 25);
  } else {
    startupScore = Math.max(10, Math.round(25 - ((startup - STREAMING_THRESHOLDS.STARTUP_POOR_MS) / 5000) * 15));
  }

  // 2. Buffering & Stall Score (Weight: 35%)
  let bufferingScore = 100;
  if (bufferCount === 0 && bufferDuration === 0) {
    bufferingScore = 100;
  } else if (bufferCount === 1 && bufferDuration <= 600) {
    bufferingScore = 80;
  } else if (bufferCount <= 2 && bufferDuration <= 1500) {
    bufferingScore = 65;
  } else if (bufferCount <= 3 && bufferDuration <= 3000) {
    bufferingScore = 45;
  } else {
    bufferingScore = Math.max(0, 30 - Math.round(rebufferingRatio * 100));
  }

  // 3. Quality Score (Weight: 30%)
  let qualityScore = 70;
  if (highestQuality >= 1080) {
    qualityScore = 100;
  } else if (highestQuality >= 720) {
    qualityScore = 85;
  } else if (highestQuality >= 480) {
    qualityScore = 70;
  } else if (highestQuality >= 360) {
    qualityScore = 60;
  } else if (highestQuality > 0) {
    qualityScore = 50;
  }

  // 4. Reliability / Success Score (Weight: 10%)
  const successScore = metrics.playbackSuccess !== false ? 100 : 0;

  const score = Math.round(
    startupScore * 0.25 +
    bufferingScore * 0.35 +
    qualityScore * 0.30 +
    successScore * 0.10
  );

  return {
    score,
    grade: getQoEGrade(score)
  };
}

/**
 * Bytes the decoder has been handed so far. Chromium and Android WebView keep
 * these counters; everything else returns 0 and the caller falls through to
 * the next source.
 */
function readDecodedBytes(video) {
  try {
    const v = Number(video.webkitVideoDecodedByteCount) || 0;
    const a = Number(video.webkitAudioDecodedByteCount) || 0;
    return v + a;
  } catch (e) {
    return 0;
  }
}

/**
 * Bytes off Resource Timing, which the origin has to opt into with
 * Timing-Allow-Origin. Most video hosts do not, so this is usually 0.
 */
function readTimingBytes(url) {
  try {
    if (typeof performance === "undefined" || !performance.getEntriesByName) return 0;
    const entries = performance.getEntriesByName(url);
    if (!entries || entries.length === 0) return 0;
    const entry = entries[entries.length - 1];
    return Number(entry.transferSize) || Number(entry.encodedBodySize) || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Whether this engine keeps the decoded-byte counters at all. Chromium and
 * Android WebView do, WKWebView does not, and it costs nothing to ask - which
 * is what decides whether the Content-Length request below is worth making.
 */
function hasDecodedByteCounters() {
  try {
    return "webkitVideoDecodedByteCount" in document.createElement("video");
  } catch (e) {
    return false;
  }
}

/**
 * How big the whole file is, so a tier the byte counters do not cover can still
 * estimate what it pulled. Best effort and cross-origin: a host that sends no
 * Access-Control-Allow-Origin gives nothing back, and the tier then reports no
 * data used rather than a guess.
 *
 * Only called where the counters are missing. Firing it regardless would put a
 * second request on the wire in front of every clip on the platform that least
 * needs it, and startup time is one of the numbers being measured.
 */
async function fetchContentLength(url, signal) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal });
    const len = Number(res.headers.get("content-length"));
    return Number.isFinite(len) && len > 0 ? len : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Resolves a tier URL against the server the run is measuring.
 *
 * A tier configured as "video-720p.mp4" means "the 720p sample on whichever
 * test point this run picked", not "on whichever host happens to be serving
 * the page". Absolute URLs are left alone, so a deployment can still point a
 * tier somewhere else entirely. Same arrangement runBrowsingTest has for its
 * site list.
 */
function resolveAssetUrl(url, serverUrl) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("//") || url.startsWith("data:")) return url;
  if (!serverUrl) return url;
  return serverUrl.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
}

/** Seconds of media sitting in the buffer, across all buffered ranges. */
function bufferedSeconds(video) {
  try {
    let total = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      total += video.buffered.end(i) - video.buffered.start(i);
    }
    return total;
  } catch (e) {
    return 0;
  }
}

/**
 * Plays a single tier and measures its playback behavior.
 */
async function playVideoClip(options = {}) {
  const url = options.url || "";
  const targetDurationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : 4000;
  const timeoutMs = options.timeoutMs || 25000;
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal || null;
  const label = options.quality || "auto";

  /*
    The stage flips to VIDEO and calls straight into here, but Vue mounts the
    container on the next tick. Without this the first tier - and only the
    first - would find nowhere to render and would play off screen.
  */
  let targetContainer = null;
  if (typeof document !== "undefined") {
    targetContainer = document.getElementById(VIDEO_CONTAINER_ID);
    if (!targetContainer) {
      await new Promise((r) => setTimeout(r, 60));
      targetContainer = document.getElementById(VIDEO_CONTAINER_ID);
    }
  }

  /* The estimate's input, and only where the counters cannot answer. Runs
     alongside playback so it costs no wall clock; only read at the end. */
  let contentLength = 0;
  const contentLengthPromise = hasDecodedByteCounters()
    ? Promise.resolve()
    : fetchContentLength(url, signal).then((len) => {
        contentLength = len;
      });

  return new Promise((resolve) => {
    const startedAt = now();
    let timeToPlayMs = null;
    let playedMediaMs = 0;
    let bufferingDurationMs = 0;
    let bufferingCount = 0;
    let stalledAt = 0;
    let longestStallMs = 0;
    let settled = false;

    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");
    video.playsInline = true;
    video.preload = "auto";
    // NOTE: DO NOT set crossOrigin="anonymous". Native HTML5 <video> can play any cross-origin video,
    // but setting crossOrigin forces CORS verification which rejects servers lacking Access-Control-Allow-Origin!

    // Append cache buster to prevent local disk cache from masking network speed
    const sep = url.includes("?") ? "&" : "?";
    const playedUrl = `${url}${sep}_t=${Date.now()}`;
    video.src = playedUrl;

    if (targetContainer) {
      video.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;background:#000;";
      targetContainer.innerHTML = "";
      targetContainer.appendChild(video);
    } else {
      video.style.cssText =
        "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;";
    }

    let timeoutTimer = null;
    let ticker = null;

    function cleanup() {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (ticker) clearInterval(ticker);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch (e) {}
      try {
        if (targetContainer) {
          targetContainer.innerHTML = "";
        } else if (video.parentNode) {
          video.parentNode.removeChild(video);
        }
      } catch (e) {}
    }

    /* Media time played so far. currentTime rather than a per-event fudge:
       nothing here seeks or loops, so it is exactly what the viewer saw. */
    function readPlayedMs() {
      const t = Number(video.currentTime);
      return Number.isFinite(t) && t > 0 ? Math.round(t * 1000) : 0;
    }

    function readBytes() {
      const decoded = readDecodedBytes(video);
      if (decoded > 0) return { bytes: decoded, source: BYTES_SOURCE.DECODED };
      const timing = readTimingBytes(playedUrl);
      if (timing > 0) return { bytes: timing, source: BYTES_SOURCE.TIMING };
      if (contentLength > 0) {
        const total = Number(video.duration);
        const buffered = bufferedSeconds(video);
        /* Progressive MP4: bytes are laid out along the timeline, so the share
           of the timeline that is buffered is the share of the file pulled. */
        const fraction = Number.isFinite(total) && total > 0 ? Math.min(1, buffered / total) : 1;
        const estimate = Math.round(contentLength * fraction);
        if (estimate > 0) return { bytes: estimate, source: BYTES_SOURCE.ESTIMATED };
      }
      return { bytes: null, source: null };
    }

    async function finish(status, err = null, measuredBy = MEASURED_BY.PLAYBACK) {
      if (settled) return;
      settled = true;

      // Wrap up any open stall
      if (stalledAt > 0) {
        const stallDur = now() - stalledAt;
        bufferingDurationMs += stallDur;
        if (stallDur > longestStallMs) longestStallMs = stallDur;
        stalledAt = 0;
      }

      const totalDuration = Math.round(now() - startedAt);
      const played = measuredBy === MEASURED_BY.PLAYBACK
        ? Math.max(playedMediaMs, readPlayedMs())
        : 0;
      const detectedHeight = video.videoHeight > 0 ? video.videoHeight : null;

      /* The HEAD is normally long finished; on a slow link it is worth a few ms
         to let it land rather than reporting no data used. */
      try {
        await Promise.race([contentLengthPromise, new Promise((r) => setTimeout(r, 250))]);
      } catch (e) {}
      const { bytes, source } = measuredBy === MEASURED_BY.PLAYBACK
        ? readBytes()
        : { bytes: null, source: null };

      cleanup();

      const rate = measuredBy === MEASURED_BY.PLAYBACK
        ? performanceRate(played, timeToPlayMs, bufferingDurationMs)
        : null;
      const throughputMbps = bytes > 0 && totalDuration > 0
        ? Number(((bytes * 8) / (totalDuration * 1000)).toFixed(2))
        : null;
      const stalls = Math.round(bufferingDurationMs);

      resolve({
        status,
        measuredBy,
        rendered: measuredBy === MEASURED_BY.PLAYBACK && played > 0,
        playbackSuccess: status === STREAM_STATUS.OK,
        qualityLabel: label,
        timeToPlayMs,
        startupTimeMs: timeToPlayMs,
        playedMs: played,
        performanceRate: rate,
        rebufferingMs: timeToPlayMs === null ? 0 : stalls,
        bufferingDurationMs: timeToPlayMs === null ? 0 : stalls,
        rebufferCount: timeToPlayMs === null ? 0 : bufferingCount,
        bufferingCount: timeToPlayMs === null ? 0 : bufferingCount,
        averageBufferingDurationMs: bufferingCount > 0 ? Math.round(stalls / bufferingCount) : 0,
        longestBufferingDurationMs: Math.round(longestStallMs),
        rebufferingRatio: played > 0 ? Number((stalls / played).toFixed(4)) : 0,
        bytesUsed: bytes,
        bytesSource: source,
        throughputMbps,
        totalMs: totalDuration,
        quality: detectedHeight,
        error: err
      });
    }

    // Abort handling
    if (signal) {
      if (signal.aborted) {
        finish(STREAM_STATUS.ERROR, "Aborted");
        return;
      }
      signal.addEventListener("abort", () => finish(STREAM_STATUS.ERROR, "Aborted"), { once: true });
    }

    // Mark playback active
    function markPlaying() {
      const stamp = now();
      if (timeToPlayMs === null) {
        timeToPlayMs = Math.max(1, Math.round(stamp - startedAt));
      }
      if (stalledAt > 0) {
        const stallDur = stamp - stalledAt;
        bufferingDurationMs += stallDur;
        if (stallDur > longestStallMs) longestStallMs = stallDur;
        stalledAt = 0;
      }
    }

    // Event listeners
    video.addEventListener("playing", markPlaying);
    video.addEventListener("canplay", () => {
      if (video.currentTime > 0) markPlaying();
    });
    video.addEventListener("loadeddata", () => {
      if (video.currentTime > 0) markPlaying();
    });

    video.addEventListener("waiting", () => {
      // Only count waiting after initial playback started
      if (timeToPlayMs !== null && stalledAt === 0) {
        stalledAt = now();
        bufferingCount++;
      }
    });

    video.addEventListener("stalled", () => {
      if (timeToPlayMs !== null && stalledAt === 0) {
        stalledAt = now();
        bufferingCount++;
      }
    });

    video.addEventListener("timeupdate", () => {
      markPlaying();
      playedMediaMs = Math.max(playedMediaMs, readPlayedMs());
      if (playedMediaMs >= targetDurationMs) {
        finish(STREAM_STATUS.OK);
      }
    });

    video.addEventListener("ended", () => {
      playedMediaMs = Math.max(playedMediaMs, readPlayedMs());
      finish(STREAM_STATUS.OK);
    });

    /*
      The player could not open the file. That is a device limit - codec,
      autoplay policy, container - not necessarily a network one, so the file
      is fetched instead to find out whether the network could have delivered
      it. What comes back is a response time and nothing else: the tier reports
      MEASURED_BY.PROBE and leaves performance rate, buffering and resolution
      null instead of a playback that never happened. It used to claim a full
      successful playback here, which is how a black frame ended up captioned
      "playing smoothly".
    */
    video.addEventListener("error", async () => {
      if (settled) return;
      try {
        const pStart = now();
        const probe = await fetch(url, { method: "HEAD", cache: "no-store" });
        const pEnd = now();
        if (probe.ok || probe.status === 200 || probe.status === 206) {
          timeToPlayMs = Math.max(1, Math.round(pEnd - pStart));
          finish(STREAM_STATUS.OK, null, MEASURED_BY.PROBE);
          return;
        }
      } catch (probeErr) {}

      const mediaErr = video.error ? `Code ${video.error.code}: ${video.error.message}` : "Video error";
      finish(STREAM_STATUS.ERROR, mediaErr);
    });

    timeoutTimer = setTimeout(() => {
      finish(STREAM_STATUS.TIMEOUT, "Timeout");
    }, timeoutMs);

    ticker = setInterval(() => {
      if (settled) return;
      if (video.currentTime > 0 && timeToPlayMs === null) {
        markPlaying();
      }
      playedMediaMs = Math.max(playedMediaMs, readPlayedMs());
      const live = readBytes();
      const elapsed = now() - startedAt;
      const openStall = stalledAt > 0 ? now() - stalledAt : 0;
      const stallsSoFar = Math.round(bufferingDurationMs + openStall);
      /* Media time against the target, so the bar tracks the video rather than
         the clock; before the first frame there is no media time, so it falls
         back to the clock to keep moving. */
      const fraction = playedMediaMs > 0
        ? playedMediaMs / targetDurationMs
        : elapsed / (targetDurationMs + 2000);
      onProgress(Math.min(1, fraction), {
        quality: label,
        resolution: video.videoHeight > 0 ? video.videoHeight : null,
        startupTimeMs: timeToPlayMs,
        playedMs: playedMediaMs,
        bufferingCount,
        bufferingDurationMs: stallsSoFar,
        performanceRate: performanceRate(playedMediaMs, timeToPlayMs, stallsSoFar),
        bytesUsed: live.bytes,
        bytesSource: live.source,
        throughputMbps: live.bytes > 0 && elapsed > 0
          ? Number(((live.bytes * 8) / (elapsed * 1000)).toFixed(2))
          : null,
        status: stalledAt > 0 ? "buffering" : (timeToPlayMs !== null ? "playing" : "starting")
      });
    }, 150);

    try {
      if (!targetContainer && typeof document !== "undefined" && document.body && !video.parentNode) {
        document.body.appendChild(video);
      }
      const playPromise = video.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(async () => {
          // Retry muted autoplay
          video.muted = true;
          try {
            await video.play();
          } catch (e2) {
            /* Autoplay refused outright - same probe fallback, and the same
               honesty about what it does and does not measure. */
            try {
              const pStart = now();
              const probe = await fetch(url, { method: "HEAD", cache: "no-store" });
              const pEnd = now();
              if (!probe.ok && probe.status !== 200 && probe.status !== 206) {
                throw new Error("probe failed");
              }
              timeToPlayMs = Math.max(1, Math.round(pEnd - pStart));
              finish(STREAM_STATUS.OK, null, MEASURED_BY.PROBE);
            } catch (pErr) {
              finish(STREAM_STATUS.ERROR, e2?.message || String(e2));
            }
          }
        });
      }
    } catch (err) {
      finish(STREAM_STATUS.ERROR, err?.message || String(err));
    }
  });
}

/** The shape returned when the stage cannot run at all. */
function emptyResult(status) {
  return {
    status,
    score: null,
    grade: null,
    timeToPlayMs: null,
    startupTimeMs: null,
    rebufferingMs: null,
    bufferingDurationMs: null,
    rebufferCount: null,
    bufferingCount: null,
    averageBufferingDurationMs: null,
    longestBufferingDurationMs: null,
    rebufferingRatio: null,
    performanceRate: null,
    playedMs: 0,
    bytesUsed: null,
    throughputMbps: null,
    highestStableQuality: null,
    totalMs: 0,
    quality: null,
    qualitiesTested: []
  };
}

/**
 * Waits, but gives up the moment the run is cancelled.
 */
function waitAbortable(ms, signal) {
  return new Promise((resolve) => {
    if (!(ms > 0)) return resolve();
    if (signal && signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal) signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Main Video Streaming Test runner.
 * Plays each configured tier in turn (360p -> 720p -> 1080p), or a single video.
 *
 * @param {object} options
 * @param {string} [options.url]            Single video URL fallback
 * @param {Array}  [options.qualities]      Tier list [{ quality, height, url, duration }]
 * @param {string} [options.serverUrl]      Base URL of the test point, for relative tier URLs
 * @param {number} [options.playSeconds]    Seconds of video per tier
 * @param {number} [options.timeoutMs]      Per-tier timeout in ms
 * @param {number} [options.settleMs]       How long a finished tier stays on screen
 * @param {Function} [options.onProgress]   Progress callback (fraction, liveStats)
 * @param {AbortSignal} [options.signal]    Signal to abort test
 * @returns {Promise<object>} Complete Streaming QoE metrics
 */
export async function runStreamingTest(options = {}) {
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal || null;
  const settleMs = Number.isFinite(Number(options.settleMs))
    ? Math.max(0, Number(options.settleMs))
    : DEFAULT_VIDEO_SETTLE_MS;

  if (signal && signal.aborted) {
    return emptyResult("Aborted");
  }

  // Tier list, or single URL fallback
  let testQueue = [];
  if (options.qualities && Array.isArray(options.qualities) && options.qualities.length > 0) {
    testQueue = options.qualities.filter((q) => q && q.enabled !== false);
  } else if (options.url) {
    testQueue = [{
      quality: "auto",
      height: 720,
      url: options.url,
      playSeconds: options.playSeconds || 10,
      timeoutMs: options.timeoutMs || 30000
    }];
  }

  if (testQueue.length === 0 || typeof document === "undefined") {
    return emptyResult(STREAM_STATUS.SKIP);
  }

  /*
    Every tier the run will play, sent with the first update so the screen can
    show the whole table up front and fill each row in as it reaches it, rather
    than growing a table one row at a time.
  */
  const plannedQualities = testQueue.map((q) => ({
    quality: q.quality || "auto",
    height: Number(q.height) || null,
    name: q.name || q.quality || "auto",
    url: q.url || options.url || ""
  }));

  const qualityResults = [];
  let totalBufferingMs = 0;
  let totalBufferingCount = 0;
  let totalBytes = 0;
  let firstStartupMs = null;
  let highestStableHeight = 0;
  let maxThroughput = 0;
  let minThroughput = Infinity;
  let sumThroughput = 0;
  let throughputCount = 0;
  let sumRate = 0;
  let rateCount = 0;
  let overallSuccess = true;

  const emit = (i, fraction, liveStats) => {
    const within = Math.min(1, Math.max(0, fraction || 0));
    onProgress(Math.min(1, (i + within) / testQueue.length), {
      index: i,
      total: testQueue.length,
      plannedQualities,
      tiers: [...qualityResults],
      ...liveStats
    });
  };

  /* The table on screen before the first frame, not after it. */
  emit(0, 0, { quality: plannedQualities[0].quality, status: "starting" });

  for (let i = 0; i < testQueue.length; i++) {
    if (signal && signal.aborted) break;

    const item = testQueue[i];
    /*
      The tier says how much video to play; the run-wide playSeconds is the
      fallback for a tier that does not. Per tier wins because it is the more
      specific setting - a 1080p tier may want longer than a 360p one.
    */
    const durationMs = Number(item.playSeconds) > 0
      ? Number(item.playSeconds) * 1000
      : Number(item.duration) > 0
        ? Number(item.duration)
        : Number(options.playSeconds) > 0
          ? Number(options.playSeconds) * 1000
          : 4000;

    const clipOptions = {
      quality: item.quality || "auto",
      durationMs,
      timeoutMs: item.timeoutMs || options.timeoutMs || 15000,
      signal,
      onProgress: (frac, liveStats) => emit(i, frac, liveStats)
    };

    const primaryUrl = resolveAssetUrl(item.url || options.url, options.serverUrl);
    const fallbackUrl = resolveAssetUrl(item.fallbackUrl, options.serverUrl);

    let clipResult = await playVideoClip({ ...clipOptions, url: primaryUrl });

    /*
      The clip could not be opened, and the tier declares somewhere else to get
      one. Worth a second try: a tier whose asset has moved, or whose codec
      this device will not decode, otherwise contributes a dead row to every
      run on that device - which is what the 1080p tier did for as long as it
      pointed at a file Chromium refuses.

      Deliberately not retried on Timeout. A timeout says the network was too
      slow to play the clip, which is the measurement, not a broken asset;
      retrying would double the tier's budget to re-measure the same thing.
    */
    const openFailed =
      clipResult.status === STREAM_STATUS.ERROR ||
      clipResult.measuredBy === MEASURED_BY.PROBE;
    if (openFailed && fallbackUrl && fallbackUrl !== primaryUrl && !(signal && signal.aborted)) {
      const retry = await playVideoClip({ ...clipOptions, url: fallbackUrl });
      if (retry.rendered) {
        clipResult = { ...retry, usedFallback: true };
      }
    }

    qualityResults.push({
      qualityLabel: item.quality,
      height: item.height,
      ...clipResult
    });

    if (firstStartupMs === null && clipResult.startupTimeMs !== null) {
      firstStartupMs = clipResult.startupTimeMs;
    }

    if (clipResult.bufferingDurationMs > 0) {
      totalBufferingMs += clipResult.bufferingDurationMs;
    }
    if (clipResult.bufferingCount > 0) {
      totalBufferingCount += clipResult.bufferingCount;
    }
    if (clipResult.bytesUsed > 0) {
      totalBytes += clipResult.bytesUsed;
    }
    if (clipResult.performanceRate !== null && clipResult.performanceRate !== undefined) {
      sumRate += clipResult.performanceRate;
      rateCount++;
    }

    if (clipResult.playbackSuccess) {
      /* Only a tier that really rendered can vouch for a resolution: a probe
         proves reachability and says nothing about what the decoder managed. */
      if (clipResult.rendered) {
        const qHeight = clipResult.quality || item.height || 0;
        if (qHeight > highestStableHeight && clipResult.bufferingCount <= 1) {
          highestStableHeight = qHeight;
        }
      }
    } else {
      overallSuccess = false;
    }

    if (clipResult.throughputMbps && clipResult.throughputMbps > 0) {
      sumThroughput += clipResult.throughputMbps;
      throughputCount++;
      if (clipResult.throughputMbps > maxThroughput) maxThroughput = clipResult.throughputMbps;
      if (clipResult.throughputMbps < minThroughput) minThroughput = clipResult.throughputMbps;
    }

    /* The finished tier, on screen long enough to be read. */
    const isLast = i === testQueue.length - 1;
    emit(i, 1, {
      quality: item.quality || "auto",
      resolution: clipResult.quality,
      status: isLast ? "done" : "loading-results"
    });
    if (!isLast) await waitAbortable(settleMs, signal);
  }

  onProgress(1, {
    index: testQueue.length - 1,
    total: testQueue.length,
    plannedQualities,
    tiers: [...qualityResults],
    status: "done"
  });

  const avgThroughput = throughputCount > 0 ? Number((sumThroughput / throughputCount).toFixed(2)) : null;
  const effectiveMinThroughput = minThroughput !== Infinity ? minThroughput : null;
  const totalPlayedMs = qualityResults.reduce((acc, curr) => acc + (curr.playedMs || 0), 0);

  const scoreMetrics = {
    status: qualityResults.some((r) => r.playbackSuccess) ? STREAM_STATUS.OK : STREAM_STATUS.ERROR,
    playbackSuccess: overallSuccess,
    startupTimeMs: firstStartupMs,
    bufferingCount: totalBufferingCount,
    bufferingDurationMs: totalBufferingMs,
    /* Stall time against the video that actually played, which is what a
       rebuffering ratio means. It used to divide by a hardcoded 12000. */
    rebufferingRatio: totalPlayedMs > 0 ? Number((totalBufferingMs / totalPlayedMs).toFixed(4)) : 0,
    highestStableQuality: highestStableHeight > 0 ? highestStableHeight : qualityResults[0]?.quality || null,
    quality: highestStableHeight > 0 ? highestStableHeight : qualityResults[0]?.quality || null
  };

  const scoreData = calculateStreamingScore(scoreMetrics);

  return {
    status: scoreMetrics.status,
    score: scoreData.score,
    grade: scoreData.grade,
    // Backwards-compatible fields matching original streaming.js
    timeToPlayMs: firstStartupMs,
    startupTimeMs: firstStartupMs,
    rebufferingMs: totalBufferingMs,
    bufferingDurationMs: totalBufferingMs,
    rebufferCount: totalBufferingCount,
    bufferingCount: totalBufferingCount,
    rebufferingRatio: scoreMetrics.rebufferingRatio,
    averageBufferingDurationMs: totalBufferingCount > 0 ? Math.round(totalBufferingMs / totalBufferingCount) : 0,
    performanceRate: rateCount > 0 ? Number((sumRate / rateCount).toFixed(2)) : null,
    playedMs: totalPlayedMs,
    bytesUsed: totalBytes > 0 ? totalBytes : null,
    throughputMbps: avgThroughput,
    minThroughputMbps: effectiveMinThroughput,
    maxThroughputMbps: maxThroughput > 0 ? maxThroughput : null,
    highestStableQuality: highestStableHeight > 0 ? `${highestStableHeight}p` : (qualityResults[0]?.quality ? `${qualityResults[0].quality}p` : null),
    quality: highestStableHeight > 0 ? highestStableHeight : qualityResults[0]?.quality || null,
    totalMs: qualityResults.reduce((acc, curr) => acc + (curr.totalMs || 0), 0),
    qualitiesTested: qualityResults
  };
}
