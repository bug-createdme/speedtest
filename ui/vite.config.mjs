import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/*
  The measurement engine is deliberately NOT imported through Vite.

  Two reasons, both load-bearing:

  1. speedtest.js does `new Worker("speedtest_worker.js?r=" + Math.random())`,
     resolved against the *document* URL. Bundling would hash and relocate that
     file, and the string would no longer point at anything.
  2. docs/architecture.md commits to shipping the identical engine bytes on the
     web today and inside the WindVane mini-app later. Anything the bundler
     rewrites is a place the two can silently diverge, which is exactly the
     class of bug that shows up as "the numbers are different in the app" with
     no error anywhere.

  So the engine stays a plain <script> tag plus a sibling worker file. This
  plugin serves those files at the app's own base path in dev, and copies them
  next to the built index.html on build, so both modes see the same layout the
  standalone deployment has.
*/
const ENGINE_FILES = ["speedtest.js", "speedtest_worker.js", "settings.json"];

/* Root-level static assets the page references by absolute path. */
const ROOT_ASSETS = ["favicon.ico"];

/*
  server-list.json is handled apart from these, by resolveServerList() below:
  which file it comes from depends on the environment, and a production build
  refuses to ship one that points at a developer's machine.
*/
const PASSTHROUGH = ENGINE_FILES.concat(ROOT_ASSETS);
const SERVER_LIST = "server-list.json";

/*
  Which test-point list gets built in.

  The shipped mini-app package contained "http://localhost:8989/", because the
  repository has exactly one server-list.json and it is the one a developer
  needs. Nobody noticed, because nothing checked: the build produced a zip that
  looked correct and could not measure anything on a handset.

  Three sources, first match wins:

    1. SPEEDTEST_SERVER_LIST=<path>   explicit, for CI and for one-off builds
    2. server-list.prod.json          committed once a real test point exists
    3. server-list.json               the development default (localhost)

  Deliberately NOT a Vite `mode` file: this list is also read at runtime by the
  standalone deployment and by docker/entrypoint.sh, so it has to stay a plain
  JSON file on disk rather than something baked into the bundle.
*/
function resolveServerList() {
  const explicit = process.env.SPEEDTEST_SERVER_LIST;
  if (explicit) {
    const file = path.isAbsolute(explicit) ? explicit : path.join(repoRoot, explicit);
    if (!fs.existsSync(file)) {
      throw new Error(
        `SPEEDTEST_SERVER_LIST points at ${file}, which does not exist.`
      );
    }
    return { file, origin: "SPEEDTEST_SERVER_LIST" };
  }
  const prod = path.join(repoRoot, "server-list.prod.json");
  if (fs.existsSync(prod)) return { file: prod, origin: "server-list.prod.json" };
  return { file: path.join(repoRoot, SERVER_LIST), origin: SERVER_LIST };
}

/* Hosts that only ever mean "the machine that built this". */
const LOCAL_HOST = /(^|\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

/*
  Refuse to produce a production build that cannot work in the field.

  Two failure modes, both silent until a handset is in someone's hand:
  a server address that resolves to nothing outside the build machine, and a
  plain-http address, which the super-app WebView blocks as mixed content on an
  https page. Neither raises an error at runtime that a user could report - the
  test simply never starts.

  SPEEDTEST_ALLOW_INSECURE_SERVERS=1 skips the check, for smoke-testing a
  production build locally. It says so loudly, so it cannot be the thing that
  quietly shipped.
*/
function assertDeployableServers(source) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(source.file, "utf8"));
  } catch (e) {
    throw new Error(`${source.origin} is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`${source.origin} must be a non-empty array of test points.`);
  }

  const problems = [];
  for (const entry of parsed) {
    const address = entry && typeof entry.server === "string" ? entry.server : "";
    const label = (entry && entry.name) || address || "(unnamed entry)";
    if (!address) {
      problems.push(`${label}: no "server" address`);
      continue;
    }
    if (LOCAL_HOST.test(address)) {
      problems.push(`${label}: ${address} only resolves on the build machine`);
    }
    if (/^http:\/\//i.test(address)) {
      problems.push(
        `${label}: ${address} is plain http, which the super-app WebView blocks as mixed content`
      );
    }
  }
  if (problems.length === 0) return;

  const message = [
    `Refusing to build a production bundle from ${source.origin}:`,
    ...problems.map((p) => `  - ${p}`),
    "",
    "Point the build at a real test server, one of:",
    "  - commit server-list.prod.json with the production test points, or",
    "  - SPEEDTEST_SERVER_LIST=path/to/list.json npm run build",
    "",
    "To build anyway (local smoke test only):",
    "  SPEEDTEST_ALLOW_INSECURE_SERVERS=1 npm run build"
  ].join("\n");

  if (process.env.SPEEDTEST_ALLOW_INSECURE_SERVERS === "1") {
    console.warn("\n[unitel] SPEEDTEST_ALLOW_INSECURE_SERVERS=1 — shipping an unusable server list.\n" + message + "\n");
    return;
  }
  throw new Error(message);
}

function contentTypeFor(name) {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function engineFiles() {
  let outDir = path.join(repoRoot, "dist");
  let isBuild = false;
  return {
    name: "unitel-engine-files",
    configResolved(config) {
      outDir = config.build.outDir;
      isBuild = config.command === "build";
    },
    buildStart() {
      /*
        Checked here rather than in writeBundle so the build fails before it
        spends time bundling, and so a failed check cannot leave a
        half-written dist/ that looks publishable.
      */
      const source = resolveServerList();
      if (isBuild) assertDeployableServers(source);
      console.log(`[unitel] test points: ${source.origin}`);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url || "").split("?")[0].replace(/^\//, "");
        if (name === SERVER_LIST) {
          const file = resolveServerList().file;
          if (!fs.existsSync(file)) return next();
          res.setHeader("Content-Type", contentTypeFor(name));
          res.setHeader("Cache-Control", "no-store");
          return fs.createReadStream(file).pipe(res);
        }
        if (!PASSTHROUGH.includes(name)) return next();
        const file = path.join(repoRoot, name);
        if (!fs.existsSync(file)) return next();
        res.setHeader(
          "Content-Type",
          contentTypeFor(name)
        );
        // The worker URL is already cache-busted per run; keeping dev uncached
        // means editing the engine doesn't need a hard reload.
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      for (const name of PASSTHROUGH) {
        const src = path.join(repoRoot, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
      }
      // Always written under the name the runtime fetches, whichever file it
      // was resolved from.
      const source = resolveServerList();
      if (fs.existsSync(source.file)) {
        fs.copyFileSync(source.file, path.join(outDir, SERVER_LIST));
      }
    }
  };
}

export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue(), engineFiles()],
  build: {
    outDir: path.join(repoRoot, "dist"),
    emptyOutDir: true,
    // WebView 90+ is the floor from docs/analysis-phase1.md §11; this keeps
    // the output inside what those engines parse without a legacy plugin.
    target: "es2020"
  },
  server: {
    port: 5180,
    // The Go/PHP backend runs cross-origin in dev, same as production will.
    // Nothing is proxied on purpose: proxying would hide CORS mistakes here
    // and let them surface only after deploy.
    strictPort: true
  }
});
