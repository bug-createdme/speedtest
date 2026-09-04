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
| `video-sample.mp4` | 3.87 MB | 720p, 10 s, 3.10 Mbps. The single-URL fallback (`video_url`). |
| `video-360p.mp4` | 684 KB | 360p, 6 s, 0.91 Mbps. |
| `video-720p.mp4` | 2.28 MB | 720p, 6 s, 3.04 Mbps. |
| `video-1080p.mp4` | 4.45 MB | 1080p, 6 s, 5.94 Mbps. |

The three `video-<height>p.mp4` files are the ladder the Video stage steps
through, one tier at a time. All are generated only where `ffmpeg` is on PATH
(or Docker is available); the script prints the exact command otherwise.

### The bitrate is the measurement

Each tier is encoded at the bitrate that resolution really costs — ~1, ~3 and
~6 Mbps — and held there with `minrate = maxrate = b:v`. That is the whole
point of the tier: whether the link can *sustain* a 1080p stream.

These were previously CRF-encoded `testsrc` colour bars, which carry so little
detail that x264 met the requested quality far below a realistic bitrate: the
"1080p" tier came out at **370 kbps** and the "360p" one at **176 kbps**. A 370
kbps clip plays smoothly over almost anything, so the stage reported *highest
stable quality: 1080p* for links that could not carry a real 1080p stream —
a wrong number rather than a missing one. The source now carries grain so the
encoder genuinely needs the bits, for the same reason the browse sample is
padded with incompressible data.

A full run therefore moves roughly 7 MB of video. That is negligible beside the
download stage, which moves far more, and it is what a video test costs.

The bitrate is held with `-x264opts nal-hrd=cbr`, not just `-b:v`. `-minrate` is
advisory to x264: told to spend 6 Mbps on real footage downscaled from a good
master it stops at the quality it thinks is enough and returns 5.27 Mbps, 12%
short. What closes the gap is filler, and that is the right trade here - those
bytes cross the link and must arrive on time exactly like picture bytes, so the
tier still asks whether the connection sustains 6 Mbps, and asks it identically
whichever clip is supplied.

### The source clip, and its licence

The tiers are cut from a real clip, not from colour bars. Nothing about the
measurement depends on it - what is measured is time to first frame, stalls and
bits delivered - but the clip plays on screen during the test, and a tester
watching a rainbow of test bars reasonably wonders whether the app is broken.

The script does **not** download one. The asset ships inside an operator's app,
so which clip and under which licence is a decision to make deliberately rather
than something a build step resolves off somebody's CDN - and a hardcoded video
URL is a failure this project has already had twice.

Supply one of:

```bash
VIDEO_SOURCE=/path/to/clip.mp4 node scripts/make-test-assets.js
```

or drop any video into `test-assets/source/`. With no source the script falls
back to the synthetic pattern, so it still runs on a machine that has no clip.

The source must be at least 1920x1080 and at least 10 s long, or the tier it
feeds is upscaled or cut short.

**The best source is the operator's own footage** - then there is no licence
question at all. Failing that, what is in `test-assets/source/` today is *Big
Buck Bunny*, © 2008 Blender Foundation, [bigbuckbunny.org](https://www.bigbuckbunny.org),
licensed **CC-BY 3.0**. That licence permits commercial use and requires
attribution, which is an obligation on whoever ships the app - confirm it is
carried in the app's credits, or replace the clip.

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
cp test-assets/browse-sample.html test-assets/video-*.mp4 <assets_path>/
```

Đưa lên một server đang chạy: [deploy-update.md](deploy-update.md).

Go's `http.FileServer` does not compress, which is what the measurement needs
(see the warning below). Range requests are supported, which the video needs.

nginx has to route them too. The location in
[docker/nginx-speedtest-endpoints.conf](../docker/nginx-speedtest-endpoints.conf)
matches `browse-sample.html`, `video-sample.mp4` and `video-<height>p.mp4`;
anything not in that pattern falls through to the 404 below it and the stage
reports Error however correctly the file was copied. The tier files were missing
from it while the script was already producing them, so copying the assets
across was not enough to make the ladder work.

### PHP backend

Apache/nginx send no CORS headers for static files, so the samples are served
through [backend/asset.php](../backend/asset.php), which adds CORS, byte ranges,
and disables compression.

```bash
mkdir -p backend/assets
cp test-assets/browse-sample.html test-assets/video-*.mp4 backend/assets/
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

In `settings.json`. A video URL that is not absolute is resolved against the
test point the run actually measured against (`resolveAssetUrl` in
[streaming.js](../ui/src/measurement/streaming.js)), so the samples are fetched
from the server under test rather than from wherever the page happens to be
hosted — the same arrangement the browse stage has:

```json
{
  "url_browse": "https://<test-server>/browse-sample.html",
  "browse_target_bytes": 500000,
  "browse_budget": 4000,

  "video_url": "video-sample.mp4",
  "video_play_seconds": 5,
  "video_timeout": 20000,
  "video_settle_ms": 900,
  "video_test_qualities": [
    { "quality": "360p",  "height": 360,  "url": "video-360p.mp4",  "fallbackUrl": "https://…", "duration": 4500 },
    { "quality": "720p",  "height": 720,  "url": "video-720p.mp4",  "fallbackUrl": "https://…", "duration": 4500 },
    { "quality": "1080p", "height": 1080, "url": "video-1080p.mp4", "fallbackUrl": "https://…", "duration": 4500 }
  ]
}
```

`quality` has to be the height the file actually decodes to — it is what the
result screen reports as the quality reached, and what the per-tier table shows
beside the resolution measured off the player. Two tiers once claimed 360p and
720p while pointing at 640x480 and 960x540 files, so every run reported a
highest stable quality no tier had produced.

`fallbackUrl` is played once if the tier's own clip cannot be opened — a file
not deployed yet, or a codec this device will not decode. It is not retried on a
timeout: a timeout is the network being slow, which *is* the measurement.
`video_settle_ms` is how long a finished tier's numbers stay on screen before
the next starts; presentational only, and excluded from every reported number.

Both URL keys ship empty on purpose: unset, the stages Skip rather than invent a
target. `browse_target_bytes` and `browse_budget` are the partner's own
thresholds recovered from their export — see
[kpi.js](../ui/src/measurement/kpi.js). Do not change them to make a number look
better.

---

## ⚠ Turn compression off for these files

The Web stage counts bytes **after** the transport has decompressed them. If the
response is gzipped, the counter reports more bytes than crossed the link and
every connection is flattered.

Measured on the generated page: gzip -9 takes it from 1,048,576 to 789,819 bytes
(75.3%). With compression on, the counter would reach 500,000 after roughly
377,000 bytes had actually crossed the link — **a third too fast**.

Both backends serve these uncompressed already. The risk is a CDN or reverse
proxy added in front of the test server: compression must be disabled for these
files, or the Web indicator overstates every measurement it takes.

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
