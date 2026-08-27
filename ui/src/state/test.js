import { reactive } from "vue";

import { locale } from "../i18n/index.js";
import { connectionType } from "./ui.js";
import { initBridge, isdn } from "../bridge/windvane.js";

/*
  The bridge between the measurement engine (global `Speedtest`, loaded as a
  plain script - see ui/vite.config.mjs) and the Vue layer.

  Nothing above this file talks to the engine, and this file renders nothing.
  That split is what lets the same engine drive the mini-app later without the
  UI knowing which host it is in.
*/

export const STAGE = {
  IDLE: "idle",
  STARTING: "starting",
  PING: "ping",
  DOWNLOAD: "download",
  UPLOAD: "upload",
  DONE: "done"
};

/*
  testState as reported by speedtest_worker.js. Deliberately NOT treated as an
  ordering: with test_order "IP_D_U" ping (2) runs BEFORE download (1), so any
  code that assumes the number increases over the run is wrong.
*/
const WORKER_STAGE = {
  "-1": STAGE.IDLE,
  0: STAGE.STARTING,
  1: STAGE.DOWNLOAD,
  2: STAGE.PING,
  3: STAGE.UPLOAD,
  4: STAGE.DONE,
  5: STAGE.DONE
};

const MAX_SAMPLES = 120;

/*
  Stall watchdog.

  The engine surfaces onupdate and onend and nothing else - there is no
  onerror. onend is reached only from testState >= 4 (speedtest.js:353), a
  state the worker enters by FINISHING, so a run that never finishes reports
  nothing at all. Two ways to get there against a server that is not answering:
  with the shipped xhr_ignoreErrors:1 a failed ping is retried forever
  (speedtest_worker.js:1082), and getIp (speedtest_worker.js:466) sets no
  xhr.timeout, so a server that accepts the connection and then goes quiet
  hangs it indefinitely. Either way the worker parks on a testState the UI
  reads as "still measuring", which is the observed symptom: stage stuck on
  ping, "Measuring latency", 0%, forever.

  Turning xhr_ignoreErrors down to 0 would make the worker give up on the first
  ping error, but it would also abandon a whole run on one transient stream
  error mid-transfer - which is exactly what the retry is there to survive -
  and it still would not catch a request that hangs rather than fails. So the
  timeout belongs here.

  It is a stall detector, not a run deadline: what fails is a run that stops
  making progress, not a run that is merely slow. The signals are the worker's
  own progress fractions, because those are driven by pongs received
  (pingProgress) and by elapsed transfer time (dl/ulProgress). The speed
  readouts cannot be used for this - they sit on the same rounded value for
  long stretches on a stable link, see pushSample.
*/
const STALL_CHECK_MS = 1000;
/*
  The longest gap between two progress ticks a HEALTHY run produces is the
  upload grace time - 3s in settings.json, during which ulProgress is held at
  its previous value (speedtest_worker.js:947). 15s leaves five times that
  margin and still gives up well inside the time a user will wait: the whole
  run is about 30s.
*/
const STALL_TIMEOUT_MS = 15000;

export const test = reactive({
  stage: STAGE.IDLE,
  running: false,
  aborted: false,

  download: 0,
  upload: 0,
  ping: 0,
  jitter: 0,

  ip: "",
  isp: "",
  dns: 0,
  tcp: 0,
  tls: 0,
  ttfb: 0,

  /*
    Latency under load, and the loss estimate that comes with it.

    idlePingAvg exists so the loaded figures have something comparable to sit
    next to: `ping` above is the MINIMUM of the idle samples, and subtracting
    a minimum from an average would inflate the apparent increase.
  */
  idlePingAvg: 0,
  dlPing: 0,
  dlPingMax: 0,
  ulPing: 0,
  ulPingMax: 0,
  packetLoss: 0,
  probeCount: 0,

  /*
    Everything the engine measures beyond the two headline speeds. Surfaced by
    speedtest_worker.js as of the "export what was already measured" change;
    consumed by measurement/record.js, which is the only place that decides
    what a stored result looks like.

    Speeds are Mbit/s here, matching the rest of this object. record.js
    converts to the kbit/s the partner's report format uses - that conversion
    belongs at the boundary, not in the UI state.
  */
  dlPeak: 0,
  ulPeak: 0,
  dlBytes: 0,
  ulBytes: 0,
  dlDuration: 0,
  ulDuration: 0,
  dlSlowstart: 0,
  ulSlowstart: 0,
  dlAvgIncSlowstart: 0,
  ulAvgIncSlowstart: 0,
  dlJitter: 0,
  ulJitter: 0,
  pingSamples: 0,
  dlStreams: 0,
  ulStreams: 0,

  dlProgress: 0,
  ulProgress: 0,
  pingProgress: 0,
  dlSamples: [],
  ulSamples: [],

  servers: [],
  /* Preferred server for the NEXT run: either the user's pick or, once
     selection finishes, the fastest one. */
  selectedServer: null,
  /* The server the run in hand was actually measured against. Distinct from
     selectedServer because Start is allowed to fire before selection has
     finished, in which case the run uses a provisional server while the
     background pick goes on to fill selectedServer. Reporting selectedServer
     on the result screen would then name a server the numbers did not come
     from. */
  usedServer: null,
  selection: { running: false, done: 0, total: 0 },

  /*
    Identifier the backend assigns to this result once telemetry is stored.
    Worth surfacing: it is the only handle a user has to quote to network
    operations so they can pull up the exact run rather than a description
    of it. Empty when telemetry is off or the write failed.
  */
  testId: "",

  error: null
});

let engineSettings = {};

/*
  Keys in settings.json that configure the UI rather than the measurement
  engine. The worker ignores parameters it does not recognise, so passing
  these through would be harmless - but settings.json would then read as if
  the engine had a WindVane option, which it does not.
*/
const UI_SETTING_KEYS = ["windvane_sdk_url", "record_endpoint"];
export const uiSettings = { windvane_sdk_url: "", record_endpoint: "" };
let instance = null;
let selectionPoll = null;
let stallTimer = null;
let stallSince = 0;
let stallKey = "";

function num(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/*
  Does reaching this server address leave the page's own origin?

  Handles every shape a server-list entry is allowed to take: an absolute
  https:// URL, a protocol-relative "//host/" (which the engine resolves
  against the page protocol), and a bare path like "/backend" that
  docker/entrypoint.sh generates for the standalone layout. Anything
  unparseable is treated as same-origin, which is the conservative answer: it
  omits cors=true rather than adding a preflight to a request that never
  needed one.
*/
function isCrossOrigin(address) {
  if (typeof address !== "string" || address === "") return false;
  try {
    return new URL(address, window.location.href).origin !== window.location.origin;
  } catch (e) {
    return false;
  }
}

/*
  Only write when the value actually changed.

  Vue would skip an identical assignment anyway; the reason to be explicit is
  the sample arrays. The worker is polled every 200ms and reports the same
  rounded string for long stretches on a stable link, so appending blindly
  would push ~60 duplicate points per stage into a sparkline that is 100px
  wide, for no visual difference and a steadily growing array.
*/
function pushSample(list, value) {
  if (list.length && list[list.length - 1] === value) return;
  list.push(value);
  if (list.length > MAX_SAMPLES) list.shift();
}

function resetRun() {
  test.download = 0;
  test.upload = 0;
  test.ping = 0;
  test.jitter = 0;
  test.idlePingAvg = 0;
  test.dlPing = 0;
  test.dlPingMax = 0;
  test.ulPing = 0;
  test.ulPingMax = 0;
  test.packetLoss = 0;
  test.probeCount = 0;
  test.dlPeak = 0;
  test.ulPeak = 0;
  test.dlBytes = 0;
  test.ulBytes = 0;
  test.dlDuration = 0;
  test.ulDuration = 0;
  test.dlSlowstart = 0;
  test.ulSlowstart = 0;
  test.dlAvgIncSlowstart = 0;
  test.ulAvgIncSlowstart = 0;
  test.dlJitter = 0;
  test.ulJitter = 0;
  test.pingSamples = 0;
  test.dlStreams = 0;
  test.ulStreams = 0;
  test.dlProgress = 0;
  test.ulProgress = 0;
  test.pingProgress = 0;
  test.dlSamples = [];
  test.ulSamples = [];
  test.aborted = false;
  test.testId = "";
  test.error = null;
}

async function loadSettings() {
  try {
    const response = await fetch("settings.json", { cache: "no-store" });
    const parsed = await response.json();
    if (parsed && typeof parsed === "object") {
      engineSettings = {};
      for (const key of Object.keys(parsed)) {
        if (UI_SETTING_KEYS.includes(key)) uiSettings[key] = parsed[key];
        else engineSettings[key] = parsed[key];
      }
    }
  } catch (e) {
    // A missing settings.json is not fatal: the worker has its own defaults.
    // It IS worth surfacing, because those defaults are not the ones this
    // project calibrated (grace times, test order).
    console.warn("[speedtest] settings.json not loaded, using engine defaults", e);
  }
}

async function loadServerList() {
  const source =
    typeof globalThis.SPEEDTEST_SERVERS !== "undefined"
      ? globalThis.SPEEDTEST_SERVERS
      : "server-list.json";
  if (Array.isArray(source)) return source;
  try {
    const response = await fetch(source, { cache: "no-store" });
    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // No list means the standalone layout: the engine falls back to its
    // default same-origin backend/ URLs, which is a valid deployment.
    return [];
  }
}

function newInstance() {
  const s = new globalThis.Speedtest();
  for (const key of Object.keys(engineSettings)) {
    s.setParameter(key, engineSettings[key]);
  }
  return s;
}

/*
  Server selection. Runs in the background and never blocks the Start button -
  docs/analysis-phase1.md §13 calls this out as the main UX defect of the old
  UI, where Start stayed disabled for up to 36 seconds.

  The engine's selectServer() reports no progress, so progress is read off the
  server objects it annotates: it assigns pingT to each server as it reaches
  it, in order. Polling that is a read-only observation of the engine's own
  state - no engine change needed to get a progress bar.
*/
export async function beginServerSelection() {
  const servers = await loadServerList();
  test.servers = servers;
  if (servers.length === 0) {
    test.selection.running = false;
    return;
  }
  if (servers.length === 1) {
    test.selectedServer = servers[0];
    test.selection.running = false;
    return;
  }

  test.selection = { running: true, done: 0, total: servers.length };
  const selector = newInstance();
  selector.addTestPoints(servers);

  selectionPoll = setInterval(() => {
    const done = servers.filter((s) => s.pingT !== undefined).length;
    test.selection.done = Math.min(done, servers.length);
  }, 200);

  selector.selectServer((best) => {
    clearInterval(selectionPoll);
    selectionPoll = null;
    test.selection.running = false;
    test.selection.done = servers.length;

    const reachable = servers.filter(
      (s) =>
        s.pingT !== -1 ||
        (typeof s.server === "string" && s.server.startsWith("//"))
    );
    if (reachable.length > 0) test.servers = reachable;

    if (best) {
      // Only adopt the auto-pick if the user has not chosen one meanwhile.
      if (!test.selectedServer) test.selectedServer = best;
    } else if (!test.selectedServer) {
      /*
        Every server failed. The old UI raised a native alert() here
        (frontend/javascript/index.js), which in a WebView is an unstyled modal
        the user cannot act on. Recorded as state so the error screen can offer
        a retry and a manual server pick instead.
      */
      test.error = { kind: "no-server" };
    }
  });
}

export function chooseServer(server) {
  test.selectedServer = server;
}

export async function initEngine() {
  await loadSettings();
  /*
    Deliberately not awaited. The bridge only exists inside the super-app, and
    nothing the user can do should wait on it - see the note on initBridge.
  */
  initBridge(uiSettings.windvane_sdk_url);
  beginServerSelection();
}

/*
  Fingerprint of how far the run in hand has got. The stage is part of it so
  that the handover between two stages counts as progress in its own right: the
  worker holds each stage's fraction at its final value across the 1s pause
  test_order's "_" inserts, and the next stage's fraction starts from 0 again,
  so neither number alone moves at the boundary.
*/
function progressKey() {
  return [test.stage, test.pingProgress, test.dlProgress, test.ulProgress].join("|");
}

function noteProgress() {
  const key = progressKey();
  if (key === stallKey) return;
  stallKey = key;
  stallSince = Date.now();
}

function startStallWatch() {
  stopStallWatch();
  stallKey = progressKey();
  stallSince = Date.now();
  stallTimer = setInterval(() => {
    if (Date.now() - stallSince < STALL_TIMEOUT_MS) return;
    failStalled();
  }, STALL_CHECK_MS);
}

function stopStallWatch() {
  if (stallTimer === null) return;
  clearInterval(stallTimer);
  stallTimer = null;
}

/*
  The run is wedged. Stop the worker before reporting it, because a wedged
  worker is not an idle one - a refused ping is retried as fast as the
  connection can fail, which on a handset is a radio held awake for as long as
  the screen is on.

  No new error kind reaches the user: "stalled" falls through to the generic
  error.title / error.body, the way "no-result" already does, and those strings
  ("Can't reach the test server", "This is usually the network, not your
  device") say the true thing here. What is new is the detail block, which
  ErrorScreen already knows how to reveal and which names the stage and the
  server - the two facts that tell a dead test point apart from a dead link.
*/
function failStalled() {
  stopStallWatch();
  const stage = test.stage;
  const server = test.usedServer;
  if (instance) {
    try {
      instance.abort();
    } catch (e) {
      // Same race as abortTest(): the worker may have finished in between.
    }
  }
  test.running = false;
  test.error = {
    kind: "stalled",
    stage,
    detail: [
      "Stage: " + stage,
      "Server: " +
        (server
          ? (server.name || "unnamed") + " - " + server.server
          : "engine default (same origin)"),
      "No progress for " + Math.round(STALL_TIMEOUT_MS / 1000) + "s"
    ].join("\n")
  };
}

export function startTest() {
  if (test.running) return;
  resetRun();
  test.running = true;
  test.stage = STAGE.STARTING;

  /*
    If selection has not finished yet, fall back to the first server in the
    list rather than to the engine's same-origin defaults. Those defaults point
    at backend/ next to the page, which is right for a standalone deployment
    and silently wrong for the multi-point one this project is heading for - it
    would measure the web host instead of the test point, with no error.
  */
  instance = newInstance();
  const server = test.selectedServer || test.servers[0] || null;
  test.usedServer = server;
  if (server) {
    /*
      Tell the engine this run is cross-origin, when it is.

      The engine only turns "multi point of test" mode on inside addTestPoint()
      and loadServerList() (speedtest.js:121,146). This file uses neither on the
      instance that does the measuring - beginServerSelection() calls
      addTestPoints() on a SEPARATE selector instance, and the run itself goes
      through setSelectedServer(), which does not set the flag.

      With mpot false the worker builds its URLs without the "cors=true"
      parameter, and every backend in this repo (backend/empty.php,
      backend/garbage.php, backend/getIP.php, and speedtest-go the same way)
      only emits Access-Control-Allow-Origin when that parameter is present. So
      every transfer request was blocked by the browser before it left, and the
      run produced nothing.

      This was invisible until now for one reason: there is no production test
      server yet, so the only configuration anyone had exercised was the
      same-origin one, where no CORS headers are needed. The moment a real test
      point is configured - which is the whole production architecture, a
      mini-app served by the super-app measuring against a server elsewhere -
      the symptom is a run that stalls after server selection succeeds and then
      fails on the stall watchdog with "Can't reach the test server". Server
      selection keeps working throughout, because its own ping helper appends
      cors=true by hand (speedtest.js:196), which is what makes the failure look
      like a dead test server rather than a client bug.

      Set from the address rather than hard-coded, so the same build stays
      correct for the standalone same-origin deployment, where turning mpot on
      would add a preflight and a preliminary POST for nothing.
    */
    instance.setParameter("mpot", isCrossOrigin(server.server));
    instance.setSelectedServer(server);
  }

  /*
    Point telemetry at the test server, not at wherever the page came from.

    url_telemetry defaults to the relative "results/telemetry.php"
    (speedtest_worker.js:71), and speedtest.js rewrites url_dl/ul/ping/getIp
    from the selected server but deliberately leaves this one alone. On the
    web that merely posts results to the static host; inside the super-app
    the page is served by the super-app, so results would be POSTed there -
    to a host that has no such endpoint. Either way network operations gets
    nothing, with no error the user would ever see.
  */
  if (server) {
    const telemetryPath = server.telemetryURL || "results/telemetry.php";
    instance.setParameter("url_telemetry", server.server + telemetryPath);
  }

  /*
    Context operations needs to read a number, sent alongside it. The engine
    wraps whatever is passed here as {server, extra}, so this arrives nested
    one level down in the stored record.

    Deliberately excluded: anything identifying the subscriber. The ISDN is
    what operations actually wants in order to tie a result to a line, but
    how to obtain it is unresolved (docs/bridge.md - wv.getAuthCode is not in
    the public WindVane API), and inventing a placeholder for it here would
    put a field in the database that nothing fills.
  */
  /*
    The subscriber number is what lets network operations tie a result to a
    line rather than to an anonymous IP, so it goes in when the super-app has
    given us one. JSON.stringify drops undefined keys, so on the plain web the
    field is absent from the record rather than present and empty.

    This makes stored results subscriber-identifying. Two consequences that
    are NOT handled here and must be before real users: the telemetry endpoint
    has to be HTTPS, and the statistics page is currently guarded by one
    shared password. See docs/architecture.md.
  */
  instance.setParameter(
    "telemetry_extra",
    JSON.stringify({
      connection: connectionType.value || "unknown",
      locale: locale.value,
      ua: navigator.userAgent,
      isdn: isdn.value || undefined,
      client: "unitel-speedtest-ui"
    })
  );

  instance.onupdate = (data) => {
    const stage = WORKER_STAGE[String(data.testState)] || STAGE.IDLE;
    test.stage = stage;

    test.download = num(data.dlStatus);
    test.upload = num(data.ulStatus);
    test.ping = num(data.pingStatus);
    test.jitter = num(data.jitterStatus);
    test.dlProgress = num(data.dlProgress);
    test.ulProgress = num(data.ulProgress);
    test.pingProgress = num(data.pingProgress);
    test.dns = num(data.dnsTime);
    test.tcp = num(data.tcpTime);
    test.tls = num(data.tlsTime);
    test.ttfb = num(data.ttfbTime);
    test.idlePingAvg = num(data.idlePingAvgStatus);
    test.dlPing = num(data.dlPingStatus);
    test.dlPingMax = num(data.dlPingMaxStatus);
    test.ulPing = num(data.ulPingStatus);
    test.ulPingMax = num(data.ulPingMaxStatus);
    test.packetLoss = num(data.packetLossStatus);
    test.probeCount = num(data.probeCountStatus);
    test.dlPeak = num(data.dlPeakStatus);
    test.ulPeak = num(data.ulPeakStatus);
    test.dlBytes = num(data.dlBytesStatus);
    test.ulBytes = num(data.ulBytesStatus);
    test.dlDuration = num(data.dlDurationStatus);
    test.ulDuration = num(data.ulDurationStatus);
    test.dlSlowstart = num(data.dlSlowstartStatus);
    test.ulSlowstart = num(data.ulSlowstartStatus);
    test.dlAvgIncSlowstart = num(data.dlAvgIncSlowstartStatus);
    test.ulAvgIncSlowstart = num(data.ulAvgIncSlowstartStatus);
    test.dlJitter = num(data.dlJitterStatus);
    test.ulJitter = num(data.ulJitterStatus);
    test.pingSamples = num(data.pingSamplesStatus);
    test.dlStreams = num(data.dlStreams);
    test.ulStreams = num(data.ulStreams);
    if (data.testId) test.testId = data.testId;

    if (data.clientIp) {
      // getIP.php returns "ip - isp, distance" when ISP info is on.
      const [ip, ...rest] = String(data.clientIp).split(" - ");
      test.ip = ip.trim();
      test.isp = rest.join(" - ").trim();
    }

    if (stage === STAGE.DOWNLOAD && test.download > 0) {
      pushSample(test.dlSamples, test.download);
    }
    if (stage === STAGE.UPLOAD && test.upload > 0) {
      pushSample(test.ulSamples, test.upload);
    }

    noteProgress();
  };

  instance.onend = (aborted) => {
    stopStallWatch();
    test.running = false;
    test.aborted = aborted;
    test.stage = STAGE.DONE;
  };

  /*
    Armed before start() rather than after, so that a start() which throws - a
    worker file that 404s, for one - still lands on the error screen instead of
    leaving test.running true with nothing driving it.
  */
  startStallWatch();
  instance.start();
}

export function abortTest() {
  if (!instance || !test.running) return;
  stopStallWatch();
  try {
    instance.abort();
  } catch (e) {
    // abort() throws if the worker already finished between the click and here.
  }
  test.running = false;
  test.aborted = true;
}

export function hasResult() {
  return test.download > 0 || test.upload > 0 || test.ping > 0;
}

/*
  Configured duration of one transfer stage, in seconds. The worker reports
  progress as a 0-1 fraction, so turning that back into "8.2s of 12s" needs the
  same number the engine was configured with rather than a hard-coded guess -
  settings.json sets 12s here while the engine's own default is 15s.
*/
export function stageDuration(stage) {
  if (stage === STAGE.DOWNLOAD) return Number(engineSettings.time_dl_max) || 15;
  if (stage === STAGE.UPLOAD) return Number(engineSettings.time_ul_max) || 15;
  return 0;
}
