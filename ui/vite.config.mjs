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
const ENGINE_FILES = [
  "speedtest.js",
  "speedtest_worker.js",
  "settings.json",
  "server-list.json"
];

/* Root-level static assets the page references by absolute path. */
const ROOT_ASSETS = ["favicon.ico"];

const PASSTHROUGH = ENGINE_FILES.concat(ROOT_ASSETS);

function contentTypeFor(name) {
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}

function engineFiles() {
  let outDir = path.join(repoRoot, "dist");
  return {
    name: "unitel-engine-files",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url || "").split("?")[0].replace(/^\//, "");
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
