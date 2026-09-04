# Network Quality Architecture & QoE Assessment (MiniApp Speedtest)

## 1. Overview & Objectives

Traditional network speed tests evaluate peak throughput and idle latency:
- **Ping / Idle Latency** (ms)
- **Download Speed** (Mbps)
- **Upload Speed** (Mbps)

While these parameters reflect raw bandwidth, they do not correlate directly with actual user Quality of Experience (QoE) when browsing websites, participating in real-time communications, or streaming video.

This document describes the upgraded network evaluation architecture implemented in the Unitel MiniApp, inspired by modern QoE methodologies (nPerf Fleet, ITU-T G.1031 / P.1203, and Cloudflare Radar):
1. **Speed Testing Core**: Unchanged Ping, Download, and Upload measurement engine running in a Dedicated Web Worker (`speedtest_worker.js`).
2. **Loaded Latency / Bufferbloat Assessment**: Live latency probes during sustained download and upload transfers.
3. **Web Browsing QoE Test**: Automated multi-target responsiveness testing measuring DNS, TCP, TLS, TTFB, and Total Load Time.
4. **Video Streaming QoE Test**: Sequential multi-quality video playback simulation (360p, 720p, 1080p) measuring Time to First Frame (TTFF), buffering count, stall duration, rebuffering ratio, and streaming throughput.
5. **Overall Network QoE Scoring Engine**: Weighted multi-factor rating (0 - 100) with dynamic renormalization and qualitative grades (`Excellent`, `Good`, `Average`, `Poor`, `Very Poor`).

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MiniApp UI (Vue 3 / Vite)                          │
│                                                                             │
│  TestingScreen.vue (Progressive Stepper & Live Gauges)                      │
│    └─ Stage: Ping -> Download -> Upload -> Browse -> Video -> Calculating  │
│                                                                             │
│  ResultScreen.vue (Comprehensive QoE & Speed Presentation)                  │
│    ├─ Overall QoE Score & Grade Badge                                       │
│    ├─ Raw Speed Gauges & Loaded Latency Breakdown                           │
│    ├─ Web Browsing QoE Card (Average Load Time, Success Rate, Site Details)  │
│    └─ Video Streaming QoE Card (Startup, Stalls, Throughput, Max Quality)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────────────┐             ┌───────────────────────────────┐
│     Web Worker (LibreSpeed)    │             │      Main Thread Services     │
│   (Isolated from DOM/UI)      │             │     (DOM & Browser APIs)      │
├───────────────────────────────┤             ├───────────────────────────────┤
│ • Idle Ping & Jitter Probes   │             │ • Web Browsing Engine         │
│ • Parallel Download Streams   │             │   - ui/src/measurement/       │
│ • Parallel Upload Streams     │             │     browsing.js               │
│ • Loaded Latency Sampling     │             │                               │
│ • Telemetry Handshake         │             │ • Video Streaming Engine      │
│                               │             │   - ui/src/measurement/       │
│                               │             │     streaming.js              │
│                               │             │                               │
│                               │             │ • QoE Calculation Engine      │
│                               │             │   - ui/src/measurement/qoe.js │
└───────────────────────────────┘             └───────────────────────────────┘
```

---

## 3. Web Worker vs. Main Thread Separation

SuperApp and mobile WebViews enforce strict runtime constraints:
- **Workers have no DOM access**: Video playback metrics (`HTMLVideoElement`, DOM events `playing`, `waiting`, `timeupdate`, `stalled`) require the DOM and cannot run inside a Worker.
- **Resource Timing Access**: `window.performance.getEntriesByName()` is scoped to the document context on older mobile WebViews.
- **Execution Pipeline**:
  1. User presses **Start**.
  2. LibreSpeed Web Worker runs **Ping -> Download -> Upload** with loaded latency probes.
  3. Upon worker completion (`instance.onend`), the UI coordinator in `ui/src/state/test.js` sequentially runs:
     - `runBrowsingStage()`: Probes representative websites.
     - `runVideoStage()`: Simulates progressive video streaming across multiple qualities.
     - `calculateQoEStage()`: Combines all speed and QoE dimensions into a unified score.
     - `finishRun()`: Captures final network state snapshot and displays `ResultScreen.vue`.

---

## 4. Web Browsing Test Methodology

### 4.1 Target Endpoints & CORS Handling
Web Browsing testing targets a mix of local infrastructure, national portals, search engines, news, and CDNs:
- **Unitel Portal**: `https://unitel.com.la/`
- **Lao National Portal**: `https://laogov.gov.la/`
- **Search Engine**: `https://www.google.com/generate_204`
- **News / Media**: `https://vientianetimes.org.la/`
- **Cloud CDN**: `https://cdnjs.cloudflare.com/`
- *Fallback*: Same-origin `asset.php?f=browse-sample.html` (1 MB random payload).

### 4.2 Measurement Mechanics
- For each target, an `AbortController` timeout (default 6,000 ms) guarantees runs do not hang.
- When permitted by server headers (`Timing-Allow-Origin: *`), the engine extracts high-precision timing from the Resource Timing API:
  - **DNS Lookup**: `domainLookupEnd - domainLookupStart`
  - **TCP Handshake**: `connectEnd - connectStart`
  - **TLS Handshake**: `connectEnd - secureConnectionStart`
  - **TTFB (Time to First Byte)**: `responseStart - requestStart`
- For cross-origin sites that do not return CORS headers, requests fall back to `mode: "no-cors"` with wall-clock timing via `performance.now()`. An opaque response (`status: 0, type: "opaque"`) confirms site reachability without triggering browser security exceptions.

### 4.3 Browsing Score Formula
$$\text{TimeScore} = f(\text{AverageLoadTime})$$
- $\le 1.2\text{s}$: 100 points
- $1.2\text{s} - 2.2\text{s}$: 90 - 75 points
- $2.2\text{s} - 3.8\text{s}$: 75 - 50 points
- $3.8\text{s} - 6.0\text{s}$: 50 - 25 points
- $> 6.0\text{s}$: $< 25$ points

$$\text{BrowsingScore} = \Big(\text{TimeScore} \times 0.70 + \text{SuccessRate} \times 0.30\Big) \times \frac{\text{SuccessRate}}{100}$$

---

## 5. Video Streaming Test Methodology

### 5.1 Player Constraints in Mobile WebViews
In embedded mobile WebViews (AliApp, EMAS, iOS WKWebView, Android WebView):
1. `<video>` elements must include `muted` and `playsinline` attributes; otherwise, the mobile OS will launch native full-screen playback or block autoplay.
2. The `<video>` element is rendered with minimal footprint (`position: fixed; width: 1px; height: 1px; opacity: 0.01`) to ensure hardware decoders render frames without interrupting the user interface.
3. Every test strictly cleans up DOM nodes, aborts timers, and clears event listeners upon completion or user cancellation.

### 5.2 Metrics Collected
- **Startup Time (Time to First Frame)**: Duration from `load()`/`play()` until the `playing` event fires.
- **Buffering Events**: Number of stall transitions (`waiting` / `stalled` events occurring after initial playback).
- **Buffering Duration**: Cumulative duration the player was stalled waiting for media bytes.
- **Rebuffering Ratio**:
  $$\text{Rebuffering Ratio} = \frac{\text{Stall Duration}}{\text{Total Playback Time}} \times 100\%$$
- **Streaming Throughput**: Measured via `buffered.end()` byte estimation and transferred ranges over active playback windows.
- **Highest Stable Quality**: Highest resolution tier (360p, 720p, 1080p) that completed without exceeding stall thresholds.

### 5.3 Streaming Score Formula
$$\text{StreamingScore} = \Big(\text{StartupScore} \times 0.35 + \text{BufferingScore} \times 0.35 + \text{QualityScore} \times 0.30\Big) \times \frac{\text{SuccessRate}}{100}$$

---

## 6. Overall QoE Scoring & Grading

### 6.1 Weight Distribution
Configured in `settings.json` under `qoe_weights`:
- **Download**: 25%
- **Upload**: 10%
- **Latency & Bufferbloat**: 15%
- **Web Browsing**: 20%
- **Video Streaming**: 30%

If a deployment disables Browsing or Streaming, or if a stage is skipped, the engine dynamically renormalizes the remaining active weights so the overall score is always on a true $0 - 100$ scale.

### 6.2 Qualitative Grades
| Score Range | Grade | Description |
| :--- | :--- | :--- |
| **90 – 100** | **Excellent** | Ideal for 4K streaming, competitive gaming, HD conferencing, and instant web browsing. |
| **75 – 89** | **Good** | Smooth HD video and responsive web browsing with low delay. |
| **50 – 74** | **Average** | Standard definition streaming and regular browsing; high-bandwidth tasks may buffer. |
| **25 – 49** | **Poor** | Noticeable webpage delays and frequent buffering. |
| **0 – 24** | **Very Poor** | Severe packet delays or timeouts; browsing and streaming disrupted. |

---

## 7. Data Storage & Telemetry Integration

All new QoE metrics are fully integrated into:
1. **In-memory state**: `ui/src/state/test.js` (`test.qoeResult`, `test.browsingResult`, `test.streamingResult`).
2. **Local History**: `ui/src/state/history.js` (IndexedDB / LocalStorage persistence).
3. **Record Serialization**: `ui/src/measurement/record.js` with new flat schema fields:
   - `QOE_OVERALL_SCORE`, `QOE_OVERALL_GRADE`
   - `QOE_DOWNLOAD_SCORE`, `QOE_UPLOAD_SCORE`, `QOE_LATENCY_SCORE`
   - `QOE_BROWSING_SCORE`, `QOE_STREAMING_SCORE`
   - `BROWSING_SCORE`, `BROWSING_GRADE`, `BROWSING_AVG_LOAD_TIME`, `BROWSING_SUCCESS_RATE`, `BROWSING_SITES_COUNT`
   - `STREAMING_SCORE`, `STREAMING_GRADE`, `STREAMING_STARTUP_TIME`, `STREAMING_BUFFERING_COUNT`, `STREAMING_BUFFERING_DURATION`, `STREAMING_REBUFFERING_RATIO`, `STREAMING_THROUGHPUT_MBPS`, `STREAMING_HIGHEST_QUALITY`
4. **Export Formats**: Included in standard CSV (`recordsToCsv`) and TSV (`recordsToTsv`) exports.
5. **Quick Share**: Integrated into `ui/src/report/share.js` `summaryText()`.

---

## 8. Mobile & MiniApp Compatibility Rules

1. **No Native CSS Nesting**: WebViews older than Chromium 112 drop entire CSS blocks containing native CSS nesting. All styles in `ResultScreen.vue`, `TestingScreen.vue`, and components use flat class selectors.
2. **Dark-Mode Only Design Tokens**: Uses CSS tokens defined in `ui/src/styles/tokens.css` with semantic borders, glassmorphism cards, and contrast-checked typography.
3. **No Fake ICMP Packet Loss**: Adheres strictly to project integrity guidelines. Loss is reported as HTTP probe loss (`PROBE_LOSS_PCT`), with raw IP packet loss explicitly set to null until native kernel APIs are available.
4. **Resource Cleanup**: All timers (`setTimeout`, `setInterval`), DOM media elements, and HTTP request streams are aborted cleanly on test completion or when the user navigates away or hits Cancel.
