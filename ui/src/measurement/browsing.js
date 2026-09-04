/**
 * browsing.js - Web Browsing Quality of Experience (QoE) Measurement
 *
 * Measures real-world web browsing responsiveness across representative
 * websites and endpoints.
 *
 * How a site is measured
 * ----------------------
 * The primary path loads the page in a real, visible iframe and times it until
 * the frame's load event fires - the same thing nPerf's browsing scenario does
 * with a WebView, and the reason the tester can watch the page appear. That
 * number is a whole-page load (HTML + subresources + render), which is what the
 * thresholds below are scaled for.
 *
 * A page cannot always be framed: X-Frame-Options / CSP frame-ancestors let a
 * site refuse, and there is no frame at all when the test runs headless (unit
 * tests, or before the testing screen has mounted). Those are measured by
 * network probe instead - fetch, then no-cors fetch, then an image probe -
 * which gives reachability and response time without rendering anything.
 *
 * Which sites those are is declared per site with `render: false`, not
 * detected. See the note above DEFAULT_BROWSING_SITES for why detection is not
 * available, and what it costs to guess.
 *
 * Metrics collected per site:
 *   - Total Load / Response Time (ms)
 *   - DNS Lookup Time (ms, via Resource Timing where supported)
 *   - TCP Connection Time (ms)
 *   - TLS Handshake Time (ms)
 *   - Time to First Byte - TTFB (ms)
 *   - HTTP Status & Success / Timeout / Failure
 *   - Whether the page actually rendered, and its per-site performance rating
 *
 * Computes:
 *   - Average Page Load Time (s)
 *   - Success Rate (%)
 *   - Browsing Score (0 - 100) & Grade
 */

import { getQoEGrade } from "./qoe.js";

/*
  The id of the element the testing screen renders for the page under test.
  Same arrangement the video stage uses: Vue owns the box, the measurement
  module puts the element inside it.
*/
export const BROWSE_CONTAINER_ID = "browse-testing-container";

/*
  A whole page, not a HEAD request. 6s was enough while nothing was rendered;
  a real page on a congested mobile network needs considerably more before
  "slow" turns into "gave up".
*/
export const DEFAULT_BROWSING_TIMEOUT_MS = 15000;

/*
  How long each page stays on screen after it has finished loading.

  Purely presentational - it is excluded from every reported number - but
  without it a fast connection flashes five pages past in under two seconds and
  the tester cannot see which sites were tried, which is the whole point of
  showing them.
*/
export const DEFAULT_BROWSING_DWELL_MS = 4000;

/* An iframe fires load for its initial about:blank as it is inserted. Anything
   blank within this window is that, not the page under test. */
const BLANK_DOC_GRACE_MS = 60;

/*
  Logical width the page is laid out at before being scaled to fit the panel.

  At the panel's own ~340px an unresponsive desktop site renders its top-left
  corner and nothing else, which is not "seeing the page". A real phone browser
  fits such a page to the screen; an iframe will not, so the frame is given a
  viewport this wide and scaled down instead. Wide enough that desktop layouts
  arrive whole, narrow enough that the text survives being shrunk.
*/
const RENDER_VIEWPORT_WIDTH = 1024;

/*
  Whether a site can be shown is configuration, not something to detect.

  A site that refuses to be framed (X-Frame-Options, CSP frame-ancestors) is
  indistinguishable from one that rendered: after the navigation commits, both
  give contentDocument === null and throw SecurityError on everything else. The
  browser withholds the difference on purpose - telling the two apart would leak
  cross-origin state - so there is nothing cleverer available here.

  Guessing therefore means calling a refusal a fast successful load, which is
  the worst of the two errors: unitel.com.la refuses, and was scoring a perfect
  100 on a 0.2s "page load" that was really the refusal arriving.

  So `render: false` marks the sites that cannot be shown. They are still
  measured, by network probe, and the screen says which measurement it is
  rather than showing an empty white frame. Verify a new site by framing it and
  looking, not by trusting the page's own report.
*/
export const DEFAULT_BROWSING_SITES = [
  {
    id: "unitel_portal",
    name: "Unitel Portal",
    url: "https://unitel.com.la/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    render: false,
    timeout: DEFAULT_BROWSING_TIMEOUT_MS,
    weight: 1
  },
  {
    id: "news_media",
    name: "Vientiane Times",
    url: "https://vientianetimes.org.la/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: DEFAULT_BROWSING_TIMEOUT_MS,
    weight: 1
  },
  {
    id: "lao_wikipedia",
    name: "Lao Wikipedia",
    url: "https://lo.wikipedia.org/wiki/%E0%BB%9C%E0%BB%89%E0%BA%B2%E0%BA%AB%E0%BA%BC%E0%BA%B1%E0%BA%81",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: DEFAULT_BROWSING_TIMEOUT_MS,
    weight: 1
  },
  {
    id: "news_agency",
    name: "Lao News Agency (KPL)",
    url: "https://kpl.gov.la/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: DEFAULT_BROWSING_TIMEOUT_MS,
    weight: 1
  },
  {
    id: "banking",
    name: "BCEL",
    url: "https://www.bcel.com.la/",
    fallbackUrl: "browse-sample.html",
    enabled: true,
    timeout: DEFAULT_BROWSING_TIMEOUT_MS,
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

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/**
 * Maps a load time to a 0 - 100 rating. Used both for the aggregate score and
 * for the per-site rating shown next to each URL while the test runs.
 */
export function loadTimeRating(loadTimeMs) {
  const t = Number(loadTimeMs) || 0;
  if (t <= 0) return 0;
  if (t <= BROWSING_THRESHOLDS.EXCELLENT_MS) return 100;
  if (t <= BROWSING_THRESHOLDS.GOOD_MS) {
    return Math.round(90 - ((t - BROWSING_THRESHOLDS.EXCELLENT_MS) / (BROWSING_THRESHOLDS.GOOD_MS - BROWSING_THRESHOLDS.EXCELLENT_MS)) * 15);
  }
  if (t <= BROWSING_THRESHOLDS.AVERAGE_MS) {
    return Math.round(75 - ((t - BROWSING_THRESHOLDS.GOOD_MS) / (BROWSING_THRESHOLDS.AVERAGE_MS - BROWSING_THRESHOLDS.GOOD_MS)) * 25);
  }
  if (t <= BROWSING_THRESHOLDS.POOR_MS) {
    return Math.round(50 - ((t - BROWSING_THRESHOLDS.AVERAGE_MS) / (BROWSING_THRESHOLDS.POOR_MS - BROWSING_THRESHOLDS.AVERAGE_MS)) * 25);
  }
  return Math.max(10, Math.round(25 - ((t - BROWSING_THRESHOLDS.POOR_MS) / 4000) * 15));
}

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
  const timeScore = loadTimeRating(avgTime);

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

/* Cache buster, so a second run does not report the disk cache as the network. */
function cacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_t=${Date.now()}`;
}

function clearRenderContainer() {
  if (typeof document === "undefined") return;
  const container = document.getElementById(BROWSE_CONTAINER_ID);
  if (container) container.innerHTML = "";
}

/*
  Is the frame still on the empty document it was created with?

  Only ever true before the navigation commits. Once it has, the document is
  cross-origin and unreadable, so this returns false whatever happened - see
  the note on `render` about why that is not something we can improve on.
*/
function isOwnBlankDocument(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc) return false;
    const href = doc.location && doc.location.href;
    if (href && href !== "about:blank") return false;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Waits, but gives up the moment the run is cancelled, and reports how far
 * through the wait it is so the screen can keep moving.
 */
function waitAbortable(ms, signal, onTick) {
  return new Promise((resolve) => {
    if (!(ms > 0)) return resolve();
    if (signal && signal.aborted) return resolve();

    const started = now();
    let timer = null;
    let ticker = null;

    const finish = () => {
      if (timer) clearTimeout(timer);
      if (ticker) clearInterval(ticker);
      if (signal) signal.removeEventListener("abort", finish);
      resolve();
    };

    timer = setTimeout(finish, ms);
    if (onTick) {
      ticker = setInterval(() => {
        onTick(Math.min(1, (now() - started) / ms));
      }, 120);
    }
    if (signal) signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Loads one page in the visible frame and times it to the load event.
 *
 * Resolves null when there is nowhere to render - no document, or the testing
 * screen has not mounted its container - so the caller can fall back to the
 * network probe. Otherwise resolves a verdict: rendered, refused (the site
 * declined to be framed), timedOut, or aborted.
 */
function renderSite(target, url, timeoutMs, signal, onTick) {
  if (typeof document === "undefined") return Promise.resolve(null);
  const container = document.getElementById(BROWSE_CONTAINER_ID);
  if (!container) return Promise.resolve(null);

  return new Promise((resolve) => {
    const startMark = now();
    let settled = false;
    let timer = null;
    let ticker = null;

    const frame = document.createElement("iframe");
    frame.title = target.name || "Web page under test";
    /*
      allow-same-origin is what lets the framed page use its own cookies and
      storage, i.e. render the way it would in a browser tab. Paired with
      allow-scripts it would be an escape hatch for a same-origin page, but
      every target here is somebody else's site.
    */
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "eager");

    /*
      Laid out wide, then scaled to the panel, so the whole page arrives rather
      than its top-left corner. pointer-events:none because a stray tap that
      followed a link would navigate the frame away mid-measurement.
    */
    const boxWidth = container.clientWidth || RENDER_VIEWPORT_WIDTH;
    const boxHeight = container.clientHeight || 300;
    const scale = Math.min(1, boxWidth / RENDER_VIEWPORT_WIDTH);
    frame.style.cssText = [
      "width:" + Math.round(boxWidth / scale) + "px",
      "height:" + Math.round(boxHeight / scale) + "px",
      "border:0",
      "display:block",
      "background:#fff",
      "transform:scale(" + scale + ")",
      "transform-origin:top left",
      "pointer-events:none"
    ].join(";");

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (ticker) clearInterval(ticker);
      frame.removeEventListener("load", onLoad);
      frame.removeEventListener("error", onError);
      if (signal) signal.removeEventListener("abort", onAbort);
    }

    function done(outcome) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ renderTimeMs: Math.round(Math.max(1, now() - startMark)), ...outcome });
    }

    function onLoad() {
      // The frame's own initial document, fired as it was inserted.
      if (now() - startMark < BLANK_DOC_GRACE_MS && isOwnBlankDocument(frame)) return;
      done({ rendered: true, timedOut: false });
    }

    function onError() {
      done({ rendered: false, timedOut: false, failed: true });
    }

    function onAbort() {
      done({ rendered: false, timedOut: false, aborted: true });
    }

    frame.addEventListener("load", onLoad);
    frame.addEventListener("error", onError);
    if (signal) {
      if (signal.aborted) {
        return done({ rendered: false, timedOut: false, aborted: true });
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => done({ rendered: false, timedOut: true }), timeoutMs);
    if (onTick) {
      ticker = setInterval(() => {
        const elapsed = now() - startMark;
        // Held below 1 so the bar cannot claim to be finished before the page is.
        onTick(Math.min(0.97, elapsed / timeoutMs), Math.round(elapsed));
      }, 120);
    }

    /*
      src before insertion: an iframe added to the document with no src fires a
      load event for about:blank straight away, and the measurement would be of
      nothing at all.
    */
    frame.src = url;
    container.innerHTML = "";
    container.appendChild(frame);
  });
}

/**
 * Network probe for pages that cannot be framed, and for headless runs.
 * Measures reachability and response time without rendering anything.
 */
async function probeSingleSite(url, timeoutMs, signal) {
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

  const startMark = now();

  try {
    // Attempt standard fetch first. If CORS fails, fallback to no-cors probe
    let response;
    let isOpaque = false;

    try {
      response = await fetch(url, {
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
        response = await fetch(url, {
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
            img.src = url;
          });
          isOpaque = true;
        } else {
          throw noCorsErr;
        }
      }
    }

    const loadTimeMs = Math.round(Math.max(1, now() - startMark));

    // Check performance resource timing entry
    const timing = extractResourceTiming(url) || {};

    let bytes = timing.contentBytes || null;
    if (!isOpaque && response && response.headers) {
      const cl = response.headers.get("content-length");
      if (cl && Number(cl) > 0) bytes = Number(cl);
    }

    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onParentAbort);

    return {
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

    const isTimeout = controller.signal.aborted && (!signal || !signal.aborted);
    const isAborted = signal && signal.aborted;

    return {
      success: false,
      timedOut: isTimeout,
      aborted: isAborted,
      isOpaque: false,
      httpStatus: isTimeout ? "Timeout" : isAborted ? "Aborted" : "Error",
      loadTimeMs: Math.round(Math.max(1, now() - startMark)),
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
 * Test a single site target: render it where we can, probe it where we cannot.
 */
async function testSingleSite(target, signal, options = {}) {
  const timeoutMs = target.timeout || options.timeoutMs || DEFAULT_BROWSING_TIMEOUT_MS;
  const onTick = options.onTick || null;
  const url = cacheBust(target.url);
  const identity = { id: target.id, name: target.name, url: target.url };

  const wantsRender = options.render !== false && target.render !== false;
  if (!wantsRender) clearRenderContainer();

  const render = wantsRender ? await renderSite(target, url, timeoutMs, signal, onTick) : null;

  if (render && render.aborted) {
    return {
      ...identity,
      success: false,
      timedOut: false,
      aborted: true,
      rendered: false,
      source: "render",
      isOpaque: false,
      httpStatus: "Aborted",
      loadTimeMs: render.renderTimeMs,
      rating: 0,
      dnsTimeMs: 0,
      tcpTimeMs: 0,
      tlsTimeMs: 0,
      ttfbTimeMs: 0,
      downloadTimeMs: 0,
      contentBytes: null,
      error: "Aborted"
    };
  }

  if (render && render.rendered) {
    const timing = extractResourceTiming(url) || {};
    return {
      ...identity,
      success: true,
      timedOut: false,
      rendered: true,
      source: "render",
      isOpaque: false,
      httpStatus: "rendered",
      loadTimeMs: render.renderTimeMs,
      rating: loadTimeRating(render.renderTimeMs),
      dnsTimeMs: timing.dnsTimeMs || 0,
      tcpTimeMs: timing.tcpTimeMs || 0,
      tlsTimeMs: timing.tlsTimeMs || 0,
      ttfbTimeMs: timing.ttfbTimeMs || 0,
      downloadTimeMs: timing.downloadTimeMs || 0,
      contentBytes: timing.contentBytes || null,
      error: null
    };
  }

  /*
    A page that never finished inside its own timeout is a timeout, and saying
    so is the point. Falling through to the probe here would answer a different
    question - "is the host up" - and report the slow page as a fast success.
  */
  if (render && render.timedOut) {
    return {
      ...identity,
      success: false,
      timedOut: true,
      rendered: false,
      source: "render",
      isOpaque: false,
      httpStatus: "Timeout",
      loadTimeMs: render.renderTimeMs,
      rating: 0,
      dnsTimeMs: 0,
      tcpTimeMs: 0,
      tlsTimeMs: 0,
      ttfbTimeMs: 0,
      downloadTimeMs: 0,
      contentBytes: null,
      error: "Render timeout"
    };
  }

  // Not framed at all, or the frame errored: measure the network instead.
  const probe = await probeSingleSite(url, timeoutMs, signal);
  return {
    ...identity,
    ...probe,
    rendered: false,
    source: "probe",
    rating: probe.success ? loadTimeRating(probe.loadTimeMs) : 0
  };
}

/**
 * Runs the full Web Browsing test suite across all configured targets.
 *
 * @param {object} options
 * @param {Array}  [options.sites]        Array of browsing targets
 * @param {string} [options.serverUrl]    Base URL of current test server
 * @param {number} [options.dwellMs]      Time each page stays on screen once loaded
 * @param {number} [options.timeoutMs]    Per-site timeout when the target sets none
 * @param {boolean}[options.render]       false to skip rendering and only probe
 * @param {Function} [options.onProgress] Callback per progress update
 * @param {AbortSignal} [options.signal]  Signal to abort test
 * @returns {Promise<object>} Complete browsing QoE metrics
 */
export async function runBrowsingTest(options = {}) {
  const rawSites = options.sites && options.sites.length > 0 ? options.sites : DEFAULT_BROWSING_SITES;
  const enabledSites = rawSites.filter((s) => s.enabled !== false);
  const onProgress = options.onProgress || (() => {});
  const signal = options.signal || null;
  const dwellMs = Number.isFinite(Number(options.dwellMs))
    ? Math.max(0, Number(options.dwellMs))
    : DEFAULT_BROWSING_DWELL_MS;

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

  /*
    Every URL the run will visit, sent with the first update so the screen can
    list them all up front and fill the rows in as it goes, rather than growing
    a list one row at a time.
  */
  const plannedSites = enabledSites.map((s) => ({ id: s.id, name: s.name, url: s.url }));

  /*
    The stage flips to BROWSE and calls straight into here, but Vue mounts the
    container on the next tick. Without this the first site - and only the
    first - would find nowhere to render and quietly fall back to the probe.
  */
  if (typeof document !== "undefined" && !document.getElementById(BROWSE_CONTAINER_ID)) {
    await new Promise((r) => setTimeout(r, 60));
  }

  const results = [];
  let totalTime = 0;
  let successfulCount = 0;

  /* The load owns most of each site's share of the bar; the dwell finishes it. */
  const LOAD_SHARE = 0.8;

  const emit = (i, extra) => {
    const within = Math.min(1, Math.max(0, extra.siteFraction || 0));
    onProgress({
      progress: Math.min(1, (i + within) / enabledSites.length),
      currentIndex: i,
      completedSites: results.length,
      totalSites: enabledSites.length,
      plannedSites,
      sites: [...results],
      ...extra
    });
  };

  try {
    for (let i = 0; i < enabledSites.length; i++) {
      if (signal && signal.aborted) {
        break;
      }

      const target = enabledSites[i];

      // If serverUrl is provided and target URL is relative or has fallback, resolve it
      let targetConfig = { ...target };
      if (options.serverUrl && targetConfig.url.startsWith("/")) {
        targetConfig.url = options.serverUrl.replace(/\/+$/, "") + targetConfig.url;
      }

      const currentRenders = options.render !== false && target.render !== false;

      emit(i, {
        currentSite: target.name,
        currentUrl: targetConfig.url,
        currentStatus: "Connecting",
        currentRenders,
        phase: "loading",
        sitePercent: 0,
        siteElapsedMs: 0,
        siteFraction: 0
      });

      const siteResult = await testSingleSite(targetConfig, signal, {
        timeoutMs: options.timeoutMs,
        render: options.render,
        onTick: (fraction, elapsedMs) => {
          emit(i, {
            currentSite: target.name,
            currentUrl: targetConfig.url,
            currentStatus: "Loading",
            currentRenders,
            phase: "loading",
            sitePercent: Math.round(fraction * 100),
            siteElapsedMs: elapsedMs,
            siteFraction: fraction * LOAD_SHARE
          });
        }
      });
      results.push(siteResult);

      if (siteResult.success) {
        successfulCount++;
        totalTime += siteResult.loadTimeMs;
      }

      const settledStatus = siteResult.success
        ? `${(siteResult.loadTimeMs / 1000).toFixed(2)}s`
        : siteResult.httpStatus;

      emit(i, {
        currentSite: target.name,
        currentUrl: targetConfig.url,
        currentStatus: settledStatus,
        currentRenders,
        phase: "dwell",
        sitePercent: 100,
        siteElapsedMs: siteResult.loadTimeMs,
        siteFraction: LOAD_SHARE,
        lastResult: siteResult
      });

      /*
        Hold the finished page on screen. Excluded from every reported number:
        the site's own timing was taken above and is already in results.
      */
      if (!(signal && signal.aborted) && !siteResult.aborted) {
        await waitAbortable(dwellMs, signal, (fraction) => {
          emit(i, {
            currentSite: target.name,
            currentUrl: targetConfig.url,
            currentStatus: settledStatus,
            currentRenders,
            phase: "dwell",
            sitePercent: 100,
            siteElapsedMs: siteResult.loadTimeMs,
            siteFraction: LOAD_SHARE + (1 - LOAD_SHARE) * fraction,
            lastResult: siteResult
          });
        });
      }
    }
  } finally {
    /* Leave nothing still loading behind the results screen. */
    if (typeof document !== "undefined") {
      const container = document.getElementById(BROWSE_CONTAINER_ID);
      if (container) container.innerHTML = "";
    }
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
    renderedSites: results.filter((r) => r.rendered).length,
    sites: results
  };
}
