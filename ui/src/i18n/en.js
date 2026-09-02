/*
  English — the source of truth for every key. A key that does not exist here
  does not exist. The other locales are checked against this file by
  ui/src/i18n/index.js in dev, so a missing or stale translation is a console
  warning during development rather than a blank label in production.
*/
export default {
  "lang.name": "English",

  "app.title": "Speed test",
  "app.subtitle": "Check your connection speed",

  "action.start": "Start",
  "action.cancel": "Cancel",
  "action.retry": "Try again",
  "action.testAgain": "Test again",
  "action.history": "History",
  "action.back": "Back",
  "action.skipSelection": "Skip, use default server",
  "action.chooseServer": "Choose another server",
  "action.showDetails": "Error details",
  "action.hideDetails": "Hide details",
  "action.share": "Share result",
  "action.exportExcel": "Export Excel",
  "action.exportCsv": "Export CSV",
  "action.clearHistory": "Clear history",
  "action.change": "Change",
  "action.logout": "Log out",
  "action.close": "Close",
  "action.copyId": "Copy ID",
  "action.export": "Export",

  "stage.ping": "Ping",
  "stage.download": "Download",
  "stage.upload": "Upload",

  "status.idle": "Ready",
  "status.findingServers": "Finding the nearest server",
  "status.serversChecked": "{done} of {total} checked",
  "status.measuringPing": "Measuring latency",
  "status.measuringDownload": "Measuring download speed",
  "status.measuringUpload": "Measuring upload speed",
  "status.elapsed": "{elapsed}s of {total}s",
  "status.fastest": "fastest",
  "status.done": "Test complete",

  "metric.download": "Download",
  "metric.upload": "Upload",
  "metric.ping": "Ping",
  "metric.jitter": "Jitter",
  "metric.pingIdle": "idle",
  "metric.pingLoaded": "under load",

  "unit.mbps": "Mbps",
  "unit.ms": "ms",
  "unit.percent": "%",

  "server.label": "Server",
  "server.unknown": "Not selected yet",

  "net.connection": "Connection",
  "net.unknown": "Unknown",

  "result.testId": "Result ID",
  "result.testIdHint": "Quote this to network operations to pull up this exact run",

  "loaded.title": "Latency under load",
  "loaded.explain": "How much latency the connection adds while it is busy. Large increases make calls and video conferencing break up even when the speed looks fine.",
  "loaded.download": "During download",
  "loaded.upload": "During upload",
  "loaded.idle": "Idle",
  "loaded.worst": "worst {value} ms",
  "loaded.increase": "+{value} ms",
  "loaded.loss": "Failed probes",
  "loaded.lossSamples": "{count} probes",
  "loaded.lossCaveat": "Share of latency probes that failed or timed out. TCP hides mild packet loss, so a high value means a real problem but a zero is not proof the link is clean.",

  "result.summary":
    "Download {download} Mbps, upload {upload} Mbps, ping {ping} milliseconds",

  "error.title": "Can't reach the test server",
  "error.body":
    "The test could not be completed. This is usually the network, not your device.",
  "error.hintNetwork": "Check that you are connected to the internet",
  "error.hintVpn": "Turn off any VPN or proxy, which reroutes the test",
  "error.hintRetry": "Try again in a moment - the server may be busy",
  "error.noServerTitle": "No test server responded",
  "error.noServerBody":
    "Every server in the list failed to answer. You are online, so this points at the servers or at something between you and them.",

  "history.title": "History",
  "history.empty": "No tests saved yet. Results you run will show up here.",
  "history.today": "Today",
  "history.yesterday": "Yesterday",
  "history.confirmClear": "Delete all saved results?",
  "history.slow": "slow",
  "history.details": "Test details",
  "history.filterAll": "All",
  "history.count": "{count} results",
  "history.dayCount": "{count} tests",
  "history.loadMore": "Show more ({count} remaining)",
  "history.showAll": "Show all",
  "history.collapse": "Collapse",

  "logout.confirm":
    "Log out? The results saved on this device will be deleted.",

  "a11y.gauge": "Current speed: {value} megabits per second",
  "a11y.progress": "Test progress",
  "a11y.home": "Home",
  "a11y.langSwitch": "Language",

  // Sync queue (sync/outbox.js)
  "sync.storedLocally": "{count} saved on this device",
  "sync.pending": "{count} waiting to upload",
  "sync.allSent": "All results uploaded",
  "sync.sent": "Uploaded",
  "share.copied": "Copied to the clipboard",
  "share.blocked": "This app could not hand the file over. Sync it instead, or open the app in a browser.",
  "sync.notSent": "Not uploaded",
  "sync.kept": "{count} kept - not uploaded yet",

  // Interrupted / invalid runs (context/network.js)
  "error.offlineTitle": "No internet connection",
  "error.offlineBody": "Your device is not connected to a network. Connect and try again - nothing is wrong with the test server.",
  "error.offlineDuringBody": "The connection dropped while measuring, so the result was discarded. Move somewhere with signal and try again.",
  "error.backgroundedTitle": "Measurement interrupted",
  "error.backgroundedBody": "The app was sent to the background while measuring. That slows the test down without warning, so the result was discarded rather than reported as a slow connection.",
  "error.hintCoverage": "Move to somewhere with better signal",
  "error.hintStayOpen": "Keep this screen open until the test finishes",
  "result.invalid.network-changed": "The network changed while measuring, so this result may belong to a different connection than the one shown.",
  "result.invalid.went-offline": "The connection dropped while measuring, so this result may be incomplete.",

  // Web access and video stages (CHANGE-010)
  "stage.browse": "Web",
  "stage.video": "Video",
  "status.measuringBrowse": "Testing web access",
  "status.measuringVideo": "Testing video playback",
  "metric.browse": "Web access",
  "metric.video": "Video",
  "browse.result": "{bytes} KB in {time} ms",
  "browse.skipped": "Not configured",
  "video.timeToPlay": "Time to play",
  "video.rebuffering": "Freezing",
  "video.quality": "Quality"
};
