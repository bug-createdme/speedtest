/*
  Video test ("streaming", TEST_TYPE=streaming in the partner's export).

  Two of the five in-scope indicators come from here:

    "Tỷ lệ video có Time to play tốt ≤4s"   -> STREAM_PRELOADING_TIME <= 4000
    "Tỷ lệ video không bị dừng hình"        -> STREAM_REBUFFERING_TIME === 0

  Both thresholds were recovered from their own 25,210-row export rather than
  guessed; see measurement/kpi.js for the working and for the one number that
  is still open.

  ── WHY THIS IS NOT IN THE WORKER ───────────────────────────────────────────

  Everything else the engine measures lives in speedtest_worker.js. This cannot:
  time-to-play and rebuffering are properties of a real player - they depend on
  demuxing, decoding and buffer management - and a Web Worker has no DOM and so
  no <video>. Computing them from raw byte arrival would be inventing numbers
  that look like player metrics and are not.

  So it runs on the main thread, orchestrated by state/test.js as its own
  stage, and the worker never knows about it.

  ── WHAT IT MEASURES, AND WHAT THEIRS DOES ──────────────────────────────────

  Their samples carry STREAM_CODE "668nUCeBHyY" - an eleven-character YouTube
  id - and a STREAM_QUALITY of 480 or 720. They play a YouTube video and read
  the quality the player settled on.

  We cannot. The YouTube iframe player is cross-origin; its buffering state is
  not readable from outside, and embedding it inside a mini-app WebView is not
  something to build a measurement on. What IS exact from a plain <video>
  element pointed at a file we control:

    - time to play: play() until the first frame is presented
    - rebuffering: the sum of every stall between frames
    - quality: videoHeight, which is the real decoded height

  That is the same measurement of the same link, against a different source.
  A report comparing these numbers to nPerf's must say so.

  video_url is empty by default. Unset, the stage reports Skip and costs
  nothing.
*/

export const STREAM_STATUS = {
  OK: "OK",
  TIMEOUT: "Timeout",
  ERROR: "Error",
  SKIP: "Skip"
};

function emptyResult(status) {
  return {
    status,
    timeToPlayMs: null,
    rebufferingMs: null,
    rebufferCount: null,
    totalMs: null,
    quality: null
  };
}

/**
 * Play a short clip and report how it behaved.
 *
 * Resolves - never rejects. A video that cannot play is a result ("Error"),
 * not an exception: the run around it must continue and store what it has.
 *
 * @param {object}   options
 * @param {string}   options.url            video to play; "" skips the stage
 * @param {number}   [options.playSeconds]  how much playback to require
 * @param {number}   [options.timeoutMs]    give up after this long overall
 * @param {function} [options.onProgress]   called with 0-1
 * @returns {Promise<object>} status, timeToPlayMs, rebufferingMs, rebufferCount, totalMs, quality
 */
export function runStreamingTest(options) {
  const url = (options && options.url) || "";
  const playSeconds = (options && options.playSeconds) || 10;
  const timeoutMs = (options && options.timeoutMs) || 30000;
  const onProgress = (options && options.onProgress) || function () {};

  if (!url || typeof document === "undefined") {
    return Promise.resolve(emptyResult(STREAM_STATUS.SKIP));
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let playingSince = 0;
    let timeToPlayMs = null;
    let rebufferingMs = 0;
    let rebufferCount = 0;
    let stalledAt = 0;
    let settled = false;

    const video = document.createElement("video");
    video.muted = true;
    /* Autoplay is only permitted muted, and only inline on iOS. Both are
       required or play() rejects and the stage reports Error on every device. */
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.src = url;
    /*
      Off-screen but NOT display:none and NOT hidden: several engines refuse to
      decode a video they consider invisible, which would turn every run into a
      false Timeout. One pixel, clipped, still counts as rendered.
    */
    video.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;";

    let timer = null;
    let ticker = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (ticker) clearInterval(ticker);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch (e) {
        // Tearing down a player that never started is not an error.
      }
      try {
        if (video.parentNode) video.parentNode.removeChild(video);
      } catch (e) {}
    }

    function finish(status) {
      if (settled) return;
      settled = true;
      /* A stall still open when time runs out counts up to now, or it would be
         the one stall that never appears in the total. */
      if (stalledAt > 0) {
        rebufferingMs += Date.now() - stalledAt;
        stalledAt = 0;
      }
      const result = {
        status,
        timeToPlayMs: timeToPlayMs,
        rebufferingMs: timeToPlayMs === null ? null : rebufferingMs,
        rebufferCount: timeToPlayMs === null ? null : rebufferCount,
        totalMs: Date.now() - startedAt,
        quality: video.videoHeight > 0 ? video.videoHeight : null
      };
      cleanup();
      resolve(result);
    }

    /*
      Time to play is measured from the moment playback is REQUESTED, not from
      the first byte: the indicator is what the viewer waits through, and that
      includes connecting, buffering and decoding the first frame.
    */
    video.addEventListener("playing", () => {
      if (timeToPlayMs === null) {
        timeToPlayMs = Date.now() - startedAt;
      }
      if (stalledAt > 0) {
        rebufferingMs += Date.now() - stalledAt;
        stalledAt = 0;
      }
      playingSince = Date.now();
    });

    /* "waiting" is the player saying it ran dry - which is what "dừng hình"
       means to whoever is watching. */
    video.addEventListener("waiting", () => {
      if (timeToPlayMs === null) return; // still the initial buffer, not a stall
      if (stalledAt === 0) {
        stalledAt = Date.now();
        rebufferCount++;
      }
    });

    video.addEventListener("error", () => finish(STREAM_STATUS.ERROR));

    video.addEventListener("timeupdate", () => {
      if (settled) return;
      onProgress(Math.min(video.currentTime / playSeconds, 1));
      if (video.currentTime >= playSeconds) finish(STREAM_STATUS.OK);
    });

    /* A clip shorter than the requested window is a complete playback, not a
       failure. */
    video.addEventListener("ended", () => finish(STREAM_STATUS.OK));

    timer = setTimeout(() => {
      /*
        Timeout, not Error. The difference matters for the KPI: a video that
        never started is a verdict on the link, while a broken URL is a failed
        measurement that must not be counted as a slow network.
      */
      finish(STREAM_STATUS.TIMEOUT);
    }, timeoutMs);

    /* Progress while nothing is playing yet, so the UI is not frozen during
       the very buffering the test exists to measure. */
    ticker = setInterval(() => {
      if (settled || timeToPlayMs !== null) return;
      onProgress(Math.min((Date.now() - startedAt) / timeoutMs, 0.3));
    }, 200);

    try {
      document.body.appendChild(video);
      const attempt = video.play();
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(() => finish(STREAM_STATUS.ERROR));
      }
    } catch (e) {
      finish(STREAM_STATUS.ERROR);
    }

    /* Referenced so a linter cannot call it unused; it also documents that
       playingSince exists for future per-segment reporting. */
    void playingSince;
  });
}
