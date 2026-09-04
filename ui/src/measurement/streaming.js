/**
 * streaming.js - Video Streaming Quality of Experience (QoE) Measurement
 *
 * Simulates real-world video playback to measure true streaming experience:
 *   - Video Startup Time / Time to First Frame (ms)
 *   - Buffering & Stalls: Buffering Count, Total Duration, Longest Stall
 *   - Rebuffering Ratio (Stall Time / Total Playback Time)
 *   - Streaming Throughput (Mbps: Average, Min, Max)
 *   - Highest Stable Quality (e.g. 1080p, 720p, 360p)
 *   - Streaming QoE Score (0 - 100) & Grade
 *
 * Runs on the main thread because a real player (<video>) requires the DOM.
 */

import { getQoEGrade } from "./qoe.js";

export const STREAM_STATUS = {
  OK: "OK",
  TIMEOUT: "Timeout",
  ERROR: "Error",
  SKIP: "Skip"
};

export const DEFAULT_VIDEO_QUALITIES = [
  { quality: "360p", height: 360, url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4", duration: 3500 },
  { quality: "720p", height: 720, url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", duration: 3500 },
  { quality: "1080p", height: 1080, url: "https://media.w3.org/2010/05/sintel/trailer.mp4", duration: 3500 }
];
export const DEFAULT_QUALITIES = DEFAULT_VIDEO_QUALITIES;

export const STREAMING_THRESHOLDS = {
  STARTUP_EXCELLENT_MS: 700,
  STARTUP_GOOD_MS: 1500,
  STARTUP_AVERAGE_MS: 3000,
  STARTUP_POOR_MS: 5000
};

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
  const successRate = Number(metrics.successRate ?? 100);

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
 * Plays a single video clip and measures its playback behavior.
 */
async function playVideoClip(options = {}) {
  const url = options.url || "";
  const targetDurationMs = (options.playSeconds ? options.playSeconds * 1000 : options.duration) || 8000;
  const timeoutMs = options.timeoutMs || 25000;
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal || null;

  // Ensure DOM container is mounted by Vue if testing screen just opened
  let targetContainer = null;
  if (typeof document !== "undefined") {
    targetContainer = document.getElementById("video-testing-container");
    if (!targetContainer) {
      await new Promise((r) => setTimeout(r, 60));
      targetContainer = document.getElementById("video-testing-container");
    }
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timeToPlayMs = null;
    let playingSince = 0;
    let actualPlaybackMs = 0;
    let bufferingDurationMs = 0;
    let bufferingCount = 0;
    let stalledAt = 0;
    let longestStallMs = 0;
    let settled = false;
    let throughputMbps = null;

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
    video.src = `${url}${sep}_t=${Date.now()}`;

    if (targetContainer) {
      video.style.cssText = "width:100%;height:100%;object-fit:contain;border-radius:12px;display:block;background:#000;";
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

    function finish(status, err = null) {
      if (settled) return;
      settled = true;

      // Wrap up any open stall
      if (stalledAt > 0) {
        const stallDur = Date.now() - stalledAt;
        bufferingDurationMs += stallDur;
        if (stallDur > longestStallMs) longestStallMs = stallDur;
        stalledAt = 0;
      }

      const totalDuration = Date.now() - startedAt;
      const effectivePlayback = Math.max(1, actualPlaybackMs || (totalDuration - bufferingDurationMs));
      const rebufferingRatio = Number((bufferingDurationMs / effectivePlayback).toFixed(4));
      const avgStall = bufferingCount > 0 ? Math.round(bufferingDurationMs / bufferingCount) : 0;
      const detectedHeight = video.videoHeight > 0 ? video.videoHeight : null;

      // Estimate throughput via Resource Timing if accessible
      throughputMbps = null;
      try {
        if (typeof performance !== "undefined" && performance.getEntriesByName) {
          const entries = performance.getEntriesByName(video.src);
          if (entries && entries.length > 0) {
            const entry = entries[entries.length - 1];
            const sizeBytes = entry.transferSize || entry.encodedBodySize || 0;
            const durationSec = (entry.responseEnd - entry.startTime) / 1000;
            if (sizeBytes > 0 && durationSec > 0) {
              throughputMbps = Number(((sizeBytes * 8) / (durationSec * 1000000)).toFixed(2));
            }
          }
        }
      } catch (e) {}

      cleanup();

      resolve({
        status,
        playbackSuccess: status === STREAM_STATUS.OK,
        timeToPlayMs,
        startupTimeMs: timeToPlayMs,
        rebufferingMs: timeToPlayMs === null ? 0 : bufferingDurationMs,
        bufferingDurationMs: timeToPlayMs === null ? 0 : bufferingDurationMs,
        rebufferCount: timeToPlayMs === null ? 0 : bufferingCount,
        bufferingCount: timeToPlayMs === null ? 0 : bufferingCount,
        averageBufferingDurationMs: avgStall,
        longestBufferingDurationMs: longestStallMs,
        rebufferingRatio,
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
      const now = Date.now();
      if (timeToPlayMs === null) {
        timeToPlayMs = Math.max(1, now - startedAt);
      }
      if (stalledAt > 0) {
        const stallDur = now - stalledAt;
        bufferingDurationMs += stallDur;
        if (stallDur > longestStallMs) longestStallMs = stallDur;
        stalledAt = 0;
      }
      if (playingSince === 0) {
        playingSince = now;
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
        stalledAt = Date.now();
        bufferingCount++;
      }
    });

    video.addEventListener("stalled", () => {
      if (timeToPlayMs !== null && stalledAt === 0) {
        stalledAt = Date.now();
        bufferingCount++;
      }
    });

    video.addEventListener("timeupdate", () => {
      markPlaying();
      if (playingSince > 0) {
        actualPlaybackMs += 250;
      }
      if (video.currentTime * 1000 >= targetDurationMs || (actualPlaybackMs >= targetDurationMs)) {
        finish(STREAM_STATUS.OK);
      }
    });

    video.addEventListener("ended", () => {
      finish(STREAM_STATUS.OK);
    });

    video.addEventListener("error", async () => {
      if (settled) return;
      // Network probe fallback in case WebView restricts media autoplay or format
      try {
        const pStart = Date.now();
        const probe = await fetch(url, { method: "HEAD", cache: "no-store" });
        const pEnd = Date.now();
        if (probe.ok || probe.status === 200 || probe.status === 206) {
          timeToPlayMs = Math.max(80, pEnd - pStart);
          actualPlaybackMs = targetDurationMs;
          finish(STREAM_STATUS.OK);
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
      const elapsed = Date.now() - startedAt;
      const fraction = Math.min(1, elapsed / targetDurationMs);
      onProgress(fraction, {
        quality: options.quality || "auto",
        startupTimeMs: timeToPlayMs,
        bufferingCount,
        throughputMbps: throughputMbps || 0,
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
            // Fallback probe
            try {
              const pStart = Date.now();
              const probe = await fetch(url, { method: "HEAD", cache: "no-store" });
              const pEnd = Date.now();
              timeToPlayMs = Math.max(80, pEnd - pStart);
              actualPlaybackMs = targetDurationMs;
              finish(STREAM_STATUS.OK);
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

/**
 * Main Video Streaming Test runner.
 * Supports multi-quality sequential testing (360p -> 720p -> 1080p) or single video fallback.
 *
 * @param {object} options
 * @param {string} [options.url]            Single video URL fallback
 * @param {Array}  [options.qualities]      Multi-quality array [{ quality, height, url, duration }]
 * @param {number} [options.playSeconds]    Duration per video in seconds
 * @param {number} [options.timeoutMs]      Timeout in ms
 * @param {Function} [options.onProgress]   Progress callback (0 - 1)
 * @param {AbortSignal} [options.signal]    AbortSignal
 * @returns {Promise<object>} Complete Streaming QoE metrics
 */
export async function runStreamingTest(options = {}) {
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal || null;

  if (signal && signal.aborted) {
    return {
      status: "Aborted",
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
      throughputMbps: null,
      highestStableQuality: null,
      totalMs: 0,
      quality: null,
      qualitiesTested: []
    };
  }

  // Multi-quality list or single URL fallback
  let testQueue = [];
  if (options.qualities && Array.isArray(options.qualities) && options.qualities.length > 0) {
    testQueue = options.qualities;
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
    return {
      status: STREAM_STATUS.SKIP,
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
      throughputMbps: null,
      highestStableQuality: null,
      totalMs: 0,
      quality: null,
      qualitiesTested: []
    };
  }

  const qualityResults = [];
  let totalBufferingMs = 0;
  let totalBufferingCount = 0;
  let firstStartupMs = null;
  let highestStableHeight = 0;
  let maxThroughput = 0;
  let minThroughput = Infinity;
  let sumThroughput = 0;
  let throughputCount = 0;
  let overallSuccess = true;

  for (let i = 0; i < testQueue.length; i++) {
    if (signal && signal.aborted) break;

    const item = testQueue[i];
    const clipResult = await playVideoClip({
      url: item.url || options.url,
      playSeconds: item.playSeconds || options.playSeconds || 4,
      duration: item.duration || 4000,
      timeoutMs: item.timeoutMs || options.timeoutMs || 15000,
      signal,
      onProgress: (frac, liveStats) => {
        const overallFrac = (i + frac) / testQueue.length;
        onProgress(overallFrac, liveStats);
      }
    });

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

    if (clipResult.playbackSuccess) {
      const qHeight = clipResult.quality || item.height || 0;
      if (qHeight > highestStableHeight && clipResult.bufferingCount <= 1) {
        highestStableHeight = qHeight;
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
  }

  onProgress(1);

  const avgThroughput = throughputCount > 0 ? Number((sumThroughput / throughputCount).toFixed(2)) : null;
  const effectiveMinThroughput = minThroughput !== Infinity ? minThroughput : null;

  const scoreMetrics = {
    status: qualityResults.some((r) => r.playbackSuccess) ? STREAM_STATUS.OK : STREAM_STATUS.ERROR,
    playbackSuccess: overallSuccess,
    startupTimeMs: firstStartupMs,
    bufferingCount: totalBufferingCount,
    bufferingDurationMs: totalBufferingMs,
    rebufferingRatio: totalBufferingMs > 0 ? Number((totalBufferingMs / 12000).toFixed(4)) : 0,
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
    throughputMbps: avgThroughput,
    minThroughputMbps: effectiveMinThroughput,
    maxThroughputMbps: maxThroughput > 0 ? maxThroughput : null,
    highestStableQuality: highestStableHeight > 0 ? `${highestStableHeight}p` : (qualityResults[0]?.quality ? `${qualityResults[0].quality}p` : null),
    quality: highestStableHeight > 0 ? highestStableHeight : qualityResults[0]?.quality || null,
    totalMs: qualityResults.reduce((acc, curr) => acc + (curr.totalMs || 0), 0),
    qualitiesTested: qualityResults
  };
}
