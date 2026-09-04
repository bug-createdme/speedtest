/**
 * browsing.js - Web Browsing Quality of Experience (QoE) Measurement
 *
 * Measures real-world web browsing responsiveness across representative
 * websites and endpoints.
 *
 * Metrics collected per site:
 *   - Total Load / Response Time (ms)
 *   - DNS Lookup Time (ms, via Resource Timing where supported)
 *   - TCP Connection Time (ms)
 *   - TLS Handshake Time (ms)
 *   - Time to First Byte - TTFB (ms)
 *   - HTTP Status & Success / Timeout / Failure
 *
 * Computes:
 *   - Average Page Load Time (s)
 *   - Success Rate (%)
 *   - Browsing Score (0 - 100) & Grade
 */

import { getQoEGrade } from "./qoe.js";

export const DEFAULT_BROWSING_SITES = [
  {
    id: "unitel_portal",
    name: "Unitel Portal",
    url: "https://unitel.com.la/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: 6000,
    weight: 1
  },
  {
    id: "national_portal",
    name: "Lao National Portal",
    url: "https://laogov.gov.la/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: 6000,
    weight: 1
  },
  {
    id: "search_engine",
    name: "Web Search (Google)",
    url: "https://www.google.com/generate_204",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: 6000,
    weight: 1
  },
  {
    id: "news_media",
    name: "News & Information",
    url: "https://laopdr.news/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: 6000,
    weight: 1
  },
  {
    id: "cdn_cloud",
    name: "CDN & Cloud Edge",
    url: "https://cdnjs.cloudflare.com/ajax/libs/vue/3.5.4/vue.global.prod.min.js",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: 6000,
    weight: 1
  }
];
export const DEFAULT_BROWSING_TARGETS = DEFAULT_BROWSING_SITES;

export const BROWSING_THRESHOLDS = {
  EXCELLENT_MS: 1200,
  GOOD_MS: 2200,
  AVERAGE_MS: 3800,
  POOR_MS: 6000
};

/**
 * Calculates a 0 - 100 Browsing Score based on average load time and success rate.
 */
export function calculateBrowsingScore(metrics) {
  const avgTime = Number(metrics?.averageLoadTime) || 0;
  let rawRate = Number(metrics?.successRate ?? (metrics?.successfulSites / (metrics?.totalSites || 1))) || 0;
  if (rawRate > 1) rawRate = rawRate / 100;
  const rateScore = Math.round(Math.min(1, Math.max(0, rawRate)) * 100);

  if (!metrics || metrics.totalSites === 0 || rateScore === 0) {
    return { score: 0, grade: getQoEGrade(0) };
  }

  // Load time component (0 - 100)
  let timeScore = 0;
  if (avgTime <= BROWSING_THRESHOLDS.EXCELLENT_MS) {
    timeScore = 100;
  } else if (avgTime <= BROWSING_THRESHOLDS.GOOD_MS) {
    timeScore = Math.round(90 - ((avgTime - BROWSING_THRESHOLDS.EXCELLENT_MS) / (BROWSING_THRESHOLDS.GOOD_MS - BROWSING_THRESHOLDS.EXCELLENT_MS)) * 15);
  } else if (avgTime <= BROWSING_THRESHOLDS.AVERAGE_MS) {
    timeScore = Math.round(75 - ((avgTime - BROWSING_THRESHOLDS.GOOD_MS) / (BROWSING_THRESHOLDS.AVERAGE_MS - BROWSING_THRESHOLDS.GOOD_MS)) * 25);
  } else if (avgTime <= BROWSING_THRESHOLDS.POOR_MS) {
    timeScore = Math.round(50 - ((avgTime - BROWSING_THRESHOLDS.AVERAGE_MS) / (BROWSING_THRESHOLDS.POOR_MS - BROWSING_THRESHOLDS.AVERAGE_MS)) * 25);
  } else {
    timeScore = Math.max(10, Math.round(25 - ((avgTime - BROWSING_THRESHOLDS.POOR_MS) / 4000) * 15));
  }

  // 70% speed + 30% reliability, penalized by success factor
  const successFactor = rawRate;
  const score = Math.round(Math.min(100, Math.max(0, (timeScore * 0.7 + rateScore * 0.3) * successFactor)));
  return {
    score,
    grade: getQoEGrade(score)
  };
}

/**
 * Extract Resource Timing if Timing-Allow-Origin was permitted by the server.
 */
function extractResourceTiming(url) {
  try {
    if (typeof performance === "undefined" || !performance.getEntriesByName) return null;
    const entries = performance.getEntriesByName(url);
    if (!entries || entries.length === 0) return null;
    const p = entries[entries.length - 1];

    const dns = p.domainLookupEnd > p.domainLookupStart ? p.domainLookupEnd - p.domainLookupStart : 0;
    const tcp = p.connectEnd > p.connectStart ? p.connectEnd - p.connectStart : 0;
    const tls = p.secureConnectionStart > 0 && p.connectEnd > p.secureConnectionStart ? p.connectEnd - p.secureConnectionStart : 0;
    const ttfb = p.responseStart > p.requestStart ? p.responseStart - p.requestStart : 0;
    const download = p.responseEnd > p.responseStart ? p.responseEnd - p.responseStart : 0;
    const size = p.transferSize || p.encodedBodySize || 0;

    return {
      dnsTimeMs: Math.round(dns),
      tcpTimeMs: Math.round(tcp),
      tlsTimeMs: Math.round(tls),
      ttfbTimeMs: Math.round(ttfb),
      downloadTimeMs: Math.round(download),
      contentBytes: size > 0 ? size : null
    };
  } catch (e) {
    return null;
  }
}

/**
 * Test a single site target with high-resolution timer and timeout.
 */
async function testSingleSite(target, signal) {
  const timeoutMs = target.timeout || 6000;
  const controller = new AbortController();
  let timer = null;

  // Link caller's signal to our controller
  const onParentAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // Append cache buster to prevent cached false speed
  const sep = target.url.includes("?") ? "&" : "?";
  const urlWithCacheBust = `${target.url}${sep}_t=${Date.now()}`;
  const startMark = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

  try {
    // Attempt standard fetch first. If CORS fails, fallback to no-cors probe
    let response;
    let isOpaque = false;

    try {
      response = await fetch(urlWithCacheBust, {
        signal: controller.signal,
        cache: "no-store",
        mode: "cors",
        credentials: "omit"
      });
    } catch (corsErr) {
      if (controller.signal.aborted) throw corsErr;
      try {
        // Cross-origin without CORS header: fallback to no-cors mode to measure network response
        isOpaque = true;
        response = await fetch(urlWithCacheBust, {
          signal: controller.signal,
          cache: "no-store",
          mode: "no-cors",
          credentials: "omit"
        });
      } catch (noCorsErr) {
        if (controller.signal.aborted) throw noCorsErr;
        // Image probe fallback for mobile WebView
        if (typeof Image !== "undefined") {
          await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // network response received
            controller.signal.addEventListener("abort", () => reject(new Error("Timeout")), { once: true });
            img.src = urlWithCacheBust;
          });
          isOpaque = true;
        } else {
          throw noCorsErr;
        }
      }
    }

    const endMark = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const loadTimeMs = Math.round(Math.max(1, endMark - startMark));

    // Check performance resource timing entry
    const timing = extractResourceTiming(urlWithCacheBust) || {};

    let bytes = timing.contentBytes || null;
    if (!isOpaque && response && response.headers) {
      const cl = response.headers.get("content-length");
      if (cl && Number(cl) > 0) bytes = Number(cl);
    }

    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);

    return {
      id: target.id,
      name: target.name,
      url: target.url,
      success: true,
      timedOut: false,
      isOpaque,
      httpStatus: isOpaque ? "opaque" : response.status,
      loadTimeMs,
      dnsTimeMs: timing.dnsTimeMs || 0,
      tcpTimeMs: timing.tcpTimeMs || 0,
      tlsTimeMs: timing.tlsTimeMs || 0,
      ttfbTimeMs: timing.ttfbTimeMs || 0,
      downloadTimeMs: timing.downloadTimeMs || 0,
      contentBytes: bytes,
      error: null
    };
  } catch (err) {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);

    const endMark = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const isTimeout = controller.signal.aborted && (!signal || !signal.aborted);
    const isAborted = signal && signal.aborted;

    return {
      id: target.id,
      name: target.name,
      url: target.url,
      success: false,
      timedOut: isTimeout,
      aborted: isAborted,
      isOpaque: false,
      httpStatus: isTimeout ? "Timeout" : isAborted ? "Aborted" : "Error",
      loadTimeMs: Math.round(Math.max(1, endMark - startMark)),
      dnsTimeMs: 0,
      tcpTimeMs: 0,
      tlsTimeMs: 0,
      ttfbTimeMs: 0,
      downloadTimeMs: 0,
      contentBytes: null,
      error: err?.message || String(err)
    };
  }
}

/**
 * Runs the full Web Browsing test suite across all configured targets.
 *
 * @param {object} options
 * @param {Array}  [options.sites]       Array of browsing targets
 * @param {string} [options.serverUrl]   Base URL of current test server
 * @param {Function} [options.onProgress] Callback per progress update
 * @param {AbortSignal} [options.signal] Signal to abort test
 * @returns {Promise<object>} Complete browsing QoE metrics
 */
export async function runBrowsingTest(options = {}) {
  const rawSites = options.sites && options.sites.length > 0 ? options.sites : DEFAULT_BROWSING_SITES;
  const enabledSites = rawSites.filter((s) => s.enabled !== false);
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal || null;

  if (enabledSites.length === 0) {
    return {
      status: "Skip",
      score: null,
      grade: null,
      averageLoadTime: 0,
      totalSites: 0,
      successfulSites: 0,
      successRate: 0,
      sites: []
    };
  }

  const results = [];
  let totalTime = 0;
  let successfulCount = 0;

  for (let i = 0; i < enabledSites.length; i++) {
    if (signal && signal.aborted) {
      break;
    }

    const target = enabledSites[i];
    onProgress({
      progress: i / enabledSites.length,
      currentSite: target.name,
      currentUrl: target.url,
      currentStatus: "Connecting",
      completedSites: i,
      totalSites: enabledSites.length,
      sites: [...results]
    });

    // If serverUrl is provided and target URL is relative or has fallback, resolve it
    let targetConfig = { ...target };
    if (options.serverUrl && targetConfig.url.startsWith("/")) {
      targetConfig.url = options.serverUrl.replace(/\/+$/, "") + targetConfig.url;
    }

    const siteResult = await testSingleSite(targetConfig, signal);
    results.push(siteResult);

    if (siteResult.success) {
      successfulCount++;
      totalTime += siteResult.loadTimeMs;
    }

    onProgress({
      progress: (i + 1) / enabledSites.length,
      currentSite: target.name,
      currentUrl: target.url,
      currentStatus: siteResult.success ? `${siteResult.loadTimeMs}ms` : siteResult.httpStatus,
      completedSites: i + 1,
      totalSites: enabledSites.length,
      lastResult: siteResult,
      sites: [...results]
    });
  }

  const averageLoadTime = successfulCount > 0 ? Math.round(totalTime / successfulCount) : 0;
  const successRate = enabledSites.length > 0 ? successfulCount / enabledSites.length : 0;

  const scoreData = calculateBrowsingScore({
    averageLoadTime,
    successRate,
    successfulSites: successfulCount,
    totalSites: enabledSites.length
  });

  return {
    status: successfulCount > 0 ? "OK" : signal && signal.aborted ? "Aborted" : "Error",
    score: scoreData.score,
    grade: scoreData.grade,
    averageLoadTime,
    averageLoadTimeSec: (averageLoadTime / 1000).toFixed(2),
    totalSites: enabledSites.length,
    successfulSites: successfulCount,
    successRate: Math.round(successRate * 100),
    sites: results
  };
}
