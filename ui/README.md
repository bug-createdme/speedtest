# Vue UI (Phase 5)

Vue 3 + Vite front end for the Unitel speed test. Built alongside the two
existing vanilla-JS UIs (`index-classic.html`, `index-modern.html`) rather than
replacing them - retiring those is a product decision still open in
`docs/architecture.md` §9.

## Run it

```bash
npm run ui:dev      # http://localhost:5180
npm run ui:build    # -> dist/ (static, deploy next to the backend)
npm run ui:preview
```

A backend must be reachable. For local work:

```bash
docker compose -f docker-compose.backend-go.yml up -d --build
```

then point `server-list.json` at `http://localhost:8989/`. The shipped list is
37 international LibreSpeed community servers and measures the route to
*those*, not to Unitel - see `docs/architecture.md` §5.

## How this fits together

`speedtest.js` and `speedtest_worker.js` are **not** bundled. They are served
as plain files at the app's own path, in dev by a small plugin in
`vite.config.mjs` and on build by copying them next to `index.html`. Two
reasons: `speedtest.js` opens the worker with a document-relative URL that a
bundler would break, and `docs/architecture.md` commits to shipping identical
engine bytes on the web and in the WindVane mini-app later.

`src/state/test.js` is the only file that talks to the engine. Nothing above it
knows the engine exists; it renders nothing. That line is what makes the
mini-app port a matter of adding a bridge rather than rewriting the UI.

There is no router, deliberately. `docs/bridge.md` records that the mini-app
host does not handle URL-based SPA routing, and that the reference project had
to remove vue-router after the fact. Navigation is a `screen` ref in
`src/state/ui.js`.

## Open items that need input, not code

**The brand is a placeholder.** Unitel's palette, logo and typeface have not
been supplied. Everything brand-specific is six custom properties at the top of
`src/styles/tokens.css` plus the wordmark in `src/components/BrandMark.vue`.
The stand-in values are neutral and meet WCAG AA against the surfaces around
them; they are not a guess at Unitel's colours.

**The Lao translation is an unreviewed draft.** Lao is the primary market
language, and `src/i18n/lo.js` was drafted without a Lao speaker checking it.
Short labels are standard terminology; the multi-sentence error and history
copy is where it is most likely to read wrongly. Have the Unitel team review it
before release. `src/i18n/en.js` is the source of truth for keys - in dev, any
locale that drifts from it logs a console warning.

**Font coverage.** Inter ships in this repo for latin only. Lao script is not
in it, and its bundled subsets do not include the Vietnamese precomposed vowels
(U+1EA0-1EF1), so both fall through to the platform font. That is acceptable on
Android and iOS, which carry Noto Sans Lao and a Vietnamese-capable UI font,
but it means those two languages do not render in Inter. Bundling `Noto Sans
Lao` and the Inter vietnamese subset would fix it at roughly 60-90 kB.

## Not done yet in Phase 5

- Accessibility has been built in (focus ring, live regions, 44px targets,
  reduced motion, labelled controls) but has **not** been audited against
  WCAG 2.1 AA with a real screen reader.
- No component or e2e tests cover this UI yet - that is Phase 7.
- `npm run lint` and `npm run format` still cover only the engine files at the
  repo root; the config predates this directory and does not understand SFCs.

## Result collection

Results are POSTed to the test server after every run and stored there, which
is the whole point of the deployment: network operations cannot review numbers
that only exist in one handset's localStorage. `settings.json` sets
`telemetry_level: "full"`; the backend config is in
`../docker/backend-go.settings.toml`.

Two things this UI has to do that the engine does not do for you:

- `url_telemetry` is rewritten to an absolute URL on the selected test server.
  The engine's default is relative to the *page*, and `speedtest.js` rewrites
  the four measurement URLs from the selected server but leaves this one alone.
  Inside the super-app the page comes from the super-app, so results would be
  POSTed there instead - silently, with no user-visible error.
- `telemetry_extra` carries the context a number is useless without: network
  type, UI locale, user agent, test server name. It deliberately does not carry
  anything identifying the subscriber, because how to obtain the ISDN is still
  unresolved (`docs/bridge.md`).

The result screen shows the id the backend assigns, so a user can quote it and
operations can pull up that exact run at
`/results/json.php?id=<id>` or on `/stats.php`.

## Latency under load, and probe loss

The idle ping answers "how far away is the server". It does not answer the
question network operations actually has, which is whether the line stays
usable while it is carrying traffic. A link that reports 100 Mbps and 20ms
idle, but 800ms of latency the moment a download starts, is broken for calls
and video conferencing - and the idle figure reports it as healthy.

The engine therefore probes latency *during* the download and upload phases
(`loaded_latency` in `settings.json`, on by default) and the result screen
shows the increase over idle, the worst sample, and the share of probes that
did not complete.

Three things worth knowing before reading those numbers:

- **The comparison is average against average.** `pingStatus` reports the
  *minimum* idle sample, which is right for an idle link but would inflate the
  apparent increase if subtracted from a loaded average. `idlePingAvgStatus`
  exists purely to give the loaded figures a like-for-like baseline.
- **The loss figure is a request loss rate, not an IP packet loss counter.**
  TCP retransmits underneath, so a link genuinely dropping a few percent of
  packets will usually still complete every probe. A high value is strong
  evidence of a problem; a zero is not evidence of a clean link. The sample
  count is shown next to it for that reason.
- **One connection slot is reserved for the probe.** Browsers cap concurrent
  connections per host at 6; the engine caps download streams at 5 when
  probing, so the probe is never stuck in the browser's own queue measuring
  queueing delay instead of the network. Chrome already used 5, so on the
  engine that matters for the WebView this changes nothing.

The severity thresholds behind the colour of the increase (30ms, 100ms) are in
`ResultScreen.vue` and follow the grading in common use for bufferbloat tests.
If operations has its own thresholds, that function is the one place to change.

## Super-app bridge (WindVane)

`src/bridge/windvane.js` is the only file that touches `window.WindVane`.
Everything in it degrades to "not available" instead of throwing, so the same
build runs as a plain web page and inside the Unitel super-app without anything
above it knowing which.

It supplies two things:

- **The subscriber number (ISDN)**, via `wv.getAuthCode`. This is what lets
  network operations tie a result to a line rather than to an anonymous IP. It
  is attached to telemetry and held in memory only - never written to
  localStorage.
- **The real network type**, via `WVNetwork.getNetworkType`, replacing
  `navigator.connection`, which is a guess on Android and absent entirely on
  iOS.

The SDK is **not** hard-coded into `index.html`. Its URL is
`windvane_sdk_url` in `settings.json`, empty by default, so the web deployment
never fetches a third-party script - which on a page whose job is measuring the
user's connection would be self-defeating. The mini-app deployment sets it.

`wv.getAuthCode` is not in the public WindVane documentation; what is
implemented is the response shape observed in a working Unitel mini-app. If the
super-app team changes it, nothing here will warn us, so every field access is
optional and failing to read one is not an error. `docs/bridge.md` records the
contract and every place this deliberately differs from the reference project.

**Security consequence, not yet handled**: once the ISDN is attached, stored
results are subscriber-identifying. The telemetry endpoint has to be HTTPS, and
`/stats.php` is currently guarded by a single shared password with no roles and
no access log. Both are Phase 9 items that now block real users rather than
merely being good practice.
