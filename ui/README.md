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
