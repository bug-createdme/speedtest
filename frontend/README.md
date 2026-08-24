# LibreSpeed frontend

This directory contains the modern LibreSpeed UI assets.

## Deployment

For installation and deployment, follow the top-level [README.md](../README.md)
and [DESIGN_SWITCH.md](../DESIGN_SWITCH.md). This directory is copied as a
whole: `index-modern.html` loads its assets from `frontend/`, so the layout
here is the layout that gets served.

## Configuration

The two configuration files live at the top level rather than here, because the
page fetches them relative to itself:

- `../server-list.json` contains the default server list used by the modern UI.
- `../settings.json` overrides selected `speedtest_worker.js` settings.
- `../index-modern.html` shows how the frontend is wired up.

Note that `javascript/index.js` fetches `settings.json` and the server list with
paths relative to the *page*, not to this script. It only resolves correctly
when loaded from a page at the repository root (`../index-modern.html`); a copy
of this directory's `index.html` living inside `frontend/` itself does not work
out of the box for that reason, which is why one isn't kept here.

## Notes

- The modern frontend expects modern browser features and does not support old
  browsers.
- This directory does not contain the backend or results-sharing files.
