# Web and Video test assets

The Web (browse) and Video (streaming) stages measure against two files we
serve. This is what they are, where they go, and what to configure.

Until both are deployed and configured, the two stages report **Skip** — which
is the intended state, not a fault. Two of the five in-scope KPIs are simply not
measured, and the screen says so.

---

## Why not facebook.com / youtube.com / instagram.com

Because the measurement cannot read them, and configuring them anyway breaks the
indicator silently.

The Web stage counts bytes with `fetch()` and a streaming body reader
([speedtest_worker.js](../speedtest_worker.js) `browseTest`). Reading a
cross-origin response requires the target to send CORS headers. Measured from a
browser against the sites proposed for this project:

| Target | CORS read | `no-cors` fallback |
|---|---|---|
| facebook.com | blocked (TypeError) | opaque, **0 readable bytes** |
| youtube.com | blocked | opaque, 0 bytes |
| soundcloud.com | blocked | opaque, 0 bytes |
| instagram.com | blocked | opaque, 0 bytes |
| apple.com/vn/store | blocked | opaque, 0 bytes |

Configured to one of those, the stage reports `Error`. And
[kpi.js](../ui/src/measurement/kpi.js) treats `Error` as a failed measurement
rather than a slow network — correctly, since a broken URL is not the link's
fault — so `samplePasses` returns `null` and the sample is not counted. The Web
indicator would end up with **zero samples while the configuration looked
complete**. That is worse than leaving it unset, which at least shows `Skip`.

Verified side by side, using the same streaming byte count the stage uses:

```
our asset      OK      1,048,576 bytes in   928 ms   -> passes
facebook.com   Error           0 bytes in 3,462 ms   -> not counted
```

nPerf reads those sites because it is a native app driving its own webview. This
is JavaScript inside somebody else's WebView. No configuration closes that gap.

**Consequence for the report:** these stages measure the same indicator against a
different source than nPerf. Numbers placed next to nPerf's must say so.

---

## Building the assets

```bash
node scripts/make-test-assets.js
```

Writes to `test-assets/` (git-ignored — these are deployment artefacts, not
source):

| File | Size | Notes |
|---|---|---|
| `browse-sample.html` | 1,048,576 B | A real page padded with random data. Twice the 500,000-byte threshold, so "reached 500 KB" and "finished the file" stay distinct events. |
| `video-sample.mp4` | ~1–2 MB | Only generated where `ffmpeg` exists. The script prints the exact command otherwise. |

The video must be **faststart** (moov atom at the front). Without it playback
cannot begin until the whole clip has arrived, and every run reads as one long
buffering event rather than a time-to-play.

---

## Deploying

### Go backend (what `server-list.json` points at)

CORS middleware is applied to the whole router, static files included
([backend-go/web/web.go](../backend-go/web/web.go)), so the files just need to be
in the assets directory — no endpoint required.

```bash
cp test-assets/browse-sample.html test-assets/video-sample.mp4 <assets_path>/
```

Go's `http.FileServer` does not compress, which is what the measurement needs
(see the warning below). Range requests are supported, which the video needs.

### PHP backend

Apache/nginx send no CORS headers for static files, so the samples are served
through [backend/asset.php](../backend/asset.php), which adds CORS, byte ranges,
and disables compression.

```bash
mkdir -p backend/assets
cp test-assets/browse-sample.html test-assets/video-sample.mp4 backend/assets/
```

URLs become `…/backend/asset.php?f=browse-sample.html` and
`…/backend/asset.php?f=video-sample.mp4` — nothing extra to append. Unlike the
measurement endpoints, this one sends CORS headers unconditionally rather than
behind `?cors=true`: the browse stage appends that parameter itself, but the
video does not (`streaming.js` assigns `<video>.src` directly), and a `<video>`
with `crossOrigin="anonymous"` and no CORS headers fails to load outright.

Set `ALLOWED_ORIGINS` to the super-app's origin in production. Verified
behaviour with `ALLOWED_ORIGINS=https://app.unitel.com.la`:

| Request | Result |
|---|---|
| `Origin: https://app.unitel.com.la` | 200, `Access-Control-Allow-Origin` echoing it, `Vary: Origin` |
| `Origin: https://evil.example` | **403 and 19 bytes** — refused before streaming a megabyte |
| no `Origin` (curl, health check) | 200, served |

---

## Configuring

In `settings.json`, using absolute HTTPS URLs on the test server:

```json
{
  "url_browse": "https://<test-server>/browse-sample.html",
  "browse_target_bytes": 500000,
  "browse_budget": 4000,

  "video_url": "https://<test-server>/video-sample.mp4",
  "video_play_seconds": 10,
  "video_timeout": 30000
}
```

Both URL keys ship empty on purpose: unset, the stages Skip rather than invent a
target. `browse_target_bytes` and `browse_budget` are the partner's own
thresholds recovered from their export — see
[kpi.js](../ui/src/measurement/kpi.js). Do not change them to make a number look
better.

---

## ⚠ Turn compression off for these two files

The Web stage counts bytes **after** the transport has decompressed them. If the
response is gzipped, the counter reports more bytes than crossed the link and
every connection is flattered.

Measured on the generated page: gzip -9 takes it from 1,048,576 to 789,819 bytes
(75.3%). With compression on, the counter would reach 500,000 after roughly
377,000 bytes had actually crossed the link — **a third too fast**.

Both backends serve these uncompressed already. The risk is a CDN or reverse
proxy added in front of the test server: compression must be disabled for these
two files, or the Web indicator overstates every measurement it takes.

---

## Packaging the mini-app

The build refuses to package a list that points at `localhost` or plain `http`,
because that produced a shipped package that could not work in the field
(CHANGE-002). Copy [server-list.prod.example.json](../server-list.prod.example.json)
to `server-list.prod.json`, put the real HTTPS test point in it, then:

```bash
npm run build:mini
```

`server-list.prod.json` is picked up automatically; `SPEEDTEST_SERVER_LIST=<path>`
overrides it for one-off builds.

**Never use `SPEEDTEST_ALLOW_INSECURE_SERVERS=1` for a package that goes to the
super-app.** It exists to smoke-test that the code compiles and it produces
exactly the unusable package the guard is there to stop.

The test point also has to be reachable from all three carriers' networks. If it
sits inside Unitel, Unitel measures on-net while LTC and ETL cross peering, and
Unitel wins on measurement setup rather than on network quality — see §5.5 of the
gap assessment.

---

## Checking a deployment

From a browser console on any origin — this is the same read the stage performs,
so it fails in the same way the stage would:

```js
const r = await fetch("https://<test-server>/browse-sample.html", { cache: "no-store" });
const b = await r.arrayBuffer();
console.log(r.status, b.byteLength, r.headers.get("content-encoding"));
// expect: 200, 1048576, null-or-"identity"   (a length near 790,000 means gzip is on)
```

For the video, the element needs CORS **and** ranges — `crossOrigin="anonymous"`
is set in [streaming.js](../ui/src/measurement/streaming.js):

```js
const r = await fetch("https://<test-server>/video-sample.mp4", { headers: { Range: "bytes=0-1023" } });
console.log(r.status, r.headers.get("accept-ranges"), r.headers.get("content-range"));
// expect: 206, "bytes", "bytes 0-1023/<size>"
```
