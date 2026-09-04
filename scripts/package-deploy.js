/**
 * package-deploy.js
 *
 * Builds a self-contained bundle for deploying the test server onto a machine
 * that has Docker and nothing else - no git, no submodule, no Go toolchain, no
 * Node, and no registry access.
 *
 * Run: node scripts/package-deploy.js
 *
 * ── WHY A BUNDLE AND NOT "git clone on the server" ──────────────────────────
 *
 * The runbook's clone-and-build path needs git, the submodule, a Go build inside
 * Docker, and Node for the test assets. That is four things that can each be
 * missing or blocked on a hardened host, discovered one at a time over ssh.
 * Everything here is resolved on the machine that already works.
 *
 * ── HOW THE BUNDLE'S COMPOSE FILE DIFFERS ───────────────────────────────────
 *
 * The repository's compose builds backend-go from ./backend-go. The bundle has
 * no source, so its compose names the image instead. That file is GENERATED from
 * the repository one rather than kept beside it, so the two cannot drift: edit
 * docker-compose.backend-go.yml and re-run this.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = path.join(ROOT, "deploy");
const STAGE = path.join(OUT_ROOT, "speedtest-deploy");

const BACKEND_IMAGE = "speedtest-backend-go:latest";
const NGINX_IMAGE = "nginx:1.27-alpine";
/* Runs backend/export.php, the only route Android has for getting a file off
   the handset. Must match the image in docker-compose.backend-go.yml. */
const PHP_IMAGE = "php:8.3-fpm-alpine";

const log = (m) => console.log("\x1b[36m[package]\x1b[0m " + m);
const warn = (m) => console.log("\x1b[33m[package] WARN " + m + "\x1b[0m");
const ok = (m) => console.log("\x1b[32m[package] OK\x1b[0m " + m);

/*
  Documentation that goes in the bundle: the two runbooks plus what they refer
  to. Kept small on purpose - this is what someone on the server needs to
  finish a deploy, not the whole design history.
*/
const BUNDLED_DOCS = [
  "deploy-backend.md",
  "deploy-update.md",
  "test-assets.md",
  /* Reached from deploy-backend.md, and then from each other. All small
     markdown - the closure costs ~55 KB in a 113 MB bundle. */
  "architecture.md",
  "bridge.md",
  "overhead-calibration.md"
];

/**
 * Every relative .md link in the staged docs has to resolve to a staged doc.
 *
 * Throws rather than warns: a dead link is only discovered by someone reading
 * it on a server with no repository to fall back to, which is the worst place
 * to find out. Adding a cross-reference and forgetting BUNDLED_DOCS should stop
 * the packaging here instead.
 */
function checkDocLinks() {
  const dir = path.join(STAGE, "docs");
  const staged = new Set(fs.readdirSync(dir));
  const broken = [];
  for (const doc of staged) {
    const body = fs.readFileSync(path.join(dir, doc), "utf8");
    for (const [, target] of body.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#|mailto:)/i.test(target)) continue;
      const file = target.split("#")[0];
      if (file === "" || !file.endsWith(".md")) continue;
      if (!staged.has(path.posix.basename(file))) broken.push(doc + " -> " + file);
    }
  }
  if (broken.length > 0) {
    throw new Error(
      "bundled docs link to files the bundle does not contain:\n  " +
        broken.join("\n  ") +
        "\nAdd them to BUNDLED_DOCS, or drop the link."
    );
  }
  ok("docs: " + staged.size + " files, no dead links");
}

const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch (e) {
    return u;
  }
};

/*
  Which video samples this bundle is supposed to be shipping, read out of
  settings.json rather than listed here.

  The quality ladder is configuration - a deployment can add a tier, drop one,
  or point one somewhere else - so a hardcoded list would go on approving a
  bundle that is missing whatever the ladder actually asks for. That is how the
  three video-<height>p.mp4 tiers came to be absent from this check while
  make-test-assets.js was already producing them.

  Only relative URLs are ours to ship. An absolute one names another host on
  purpose, and nothing in test-assets/ could satisfy it.
*/
function expectedVideoAssets() {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "settings.json"), "utf8"));
  } catch (e) {
    warn("settings.json unreadable (" + e.message + ") - cannot tell which video samples this bundle needs.");
    return [];
  }
  if (cfg.video_enabled === false) return [];

  const ours = (u) =>
    typeof u === "string" && u !== "" && !/^(https?:)?\/\//i.test(u) && !u.startsWith("data:");

  const wanted = [];
  const add = (url, label, fallbackUrl) => {
    if (!ours(url)) return;
    const name = url.split(/[?#]/)[0].replace(/^\/+/, "");
    if (!wanted.some((w) => w.name === name)) wanted.push({ name, label, fallbackUrl });
  };

  add(cfg.video_url, "single-URL video test", null);
  for (const tier of cfg.video_test_qualities || []) {
    add(tier.url, (tier.quality || "video") + " tier", tier.fallbackUrl);
  }
  return wanted;
}

function sh(cmd, opts) {
  return execSync(cmd, { cwd: ROOT, stdio: "pipe", ...opts }).toString();
}

function copy(rel) {
  const to = path.join(STAGE, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), to);
}

function human(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/*
  Turn the repository compose into the bundle's: no build context, a named image
  instead. Everything else - profiles, ports, volumes, the environment contract -
  carries through untouched, which is the point of generating rather than
  maintaining a second copy.
*/
function bundleCompose() {
  /*
    Line endings are normalised before matching, and the bundle is written with
    LF. git checks this repository out with CRLF on Windows, which made the
    pattern below silently never match - the guard caught it, but only because
    it is there. The bundle targets Linux either way.
  */
  const src = fs
    .readFileSync(path.join(ROOT, "docker-compose.backend-go.yml"), "utf8")
    .replace(/\r\n/g, "\n");
  const built = src.replace(
    /    build:\n      context: \.\/backend-go\n/,
    "    # Loaded from images.tar by `docker load` - there is no source here to\n" +
      "    # build from. See DEPLOY.md.\n" +
      "    image: " +
      BACKEND_IMAGE +
      "\n"
  );
  if (built === src) {
    throw new Error(
      "could not find the backend-go build block in docker-compose.backend-go.yml - " +
        "the bundle would try to build from source it does not contain"
    );
  }
  return (
    "# GENERATED by scripts/package-deploy.js - do not edit here.\n" +
    "# Edit docker-compose.backend-go.yml in the repository and re-package.\n" +
    built
  );
}

function envExample() {
  return [
    "# Configuration for docker compose. Copy and fill in:",
    "#",
    "#   cp .env.example .env && chmod 600 .env",
    "#",
    "# Compose reads .env from this directory automatically, so nothing needs",
    "# exporting on every login. It is shipped as .example so that re-extracting",
    "# the bundle over a running deployment cannot overwrite your settings.",
    "",
    "# REQUIRED, and deliberately empty. The statistics page lists the client IP",
    "# and ISP behind every recorded result, so there is no sane default here -",
    "# compose refuses to start until this is set to something real.",
    "SPEEDTEST_STATISTICS_PASSWORD=",
    "",
    "# Which page origins may read the measurement endpoints.",
    "#",
    "# \".\" matches any origin - the same as backend-go's own behaviour, and fine",
    "# for a local check. Before this faces the internet, set it to the",
    "# super-app's origin, like the commented line below.",
    "#",
    "# Write the dots as [.] and not \\. : some shells rewrite the backslash on",
    "# the way into docker, and the regex then matches NOTHING - every origin",
    "# refused, including the right one. It fails closed, but it costs an",
    "# afternoon to find.",
    "SPEEDTEST_ALLOWED_ORIGIN_REGEX=.",
    "# The mini-app's REAL origin, read off the access log on the deployed",
    "# nodes. It is an emas.alibaba.com host, NOT app.unitel.com.la - tightening",
    "# to the latter matches nothing and kills every measurement.",
    "#SPEEDTEST_ALLOWED_ORIGIN_REGEX=^https://[0-9]+[.]app[.]mini[.]windvane[.]suite[.]emas[.]alibaba[.]com$",
    "",
    "# --profile tls only. Ignored by --profile dev.",
    "#",
    "# SPEEDTEST_CERT_DIR must be certbot's LIVE directory, not a copy of it:",
    "# certbot renews in place, and a copy would keep serving the expired",
    "# certificate until somebody noticed.",
    "SPEEDTEST_SERVER_NAME=speedtest.example.la",
    "SPEEDTEST_CERT_DIR=/etc/letsencrypt/live/speedtest.example.la",
    "",
    "# The public URL of the export endpoint - the only route Android has for",
    "# getting a file off the handset.",
    "#",
    "# REQUIRED whenever anything upstream rewrites the path. Left empty,",
    "# export.php builds the download link out of the request it received, and",
    "# a balancer that strips a prefix makes that link point at a path nobody",
    "# can reach. It fails QUIETLY: the upload still answers 201.",
    "#",
    "# Must match export_endpoint in the mini-app's settings.json.",
    "SPEEDTEST_EXPORT_BASE_URL=",
    "#SPEEDTEST_EXPORT_BASE_URL=https://speedtest.example.la/speedtest/export.php",
    "",
    "# Which node serves /export.php for the whole pool.",
    "#",
    "# Exports are stored on local disk. With more than one node behind a load",
    "# balancer, an upload and its download can land on different ones and the",
    "# link fails intermittently - looking exactly like an expiry. Every node",
    "# forwards to the address below, so set the SAME value on ALL of them.",
    "# Pointing each node at itself recreates the split this prevents.",
    "#",
    "# The default is this server's own listener, which is right for one node.",
    "SPEEDTEST_EXPORT_NODE=127.0.0.1:8080",
    "#SPEEDTEST_EXPORT_NODE=10.120.162.18:8087",
    ""
  ].join("\n");
}

function deployNotes(arch) {
  const B = "```";
  return [
    "# Deploy bundle",
    "",
    "Everything needed to run the test server on a machine that has Docker and",
    "nothing else. Generated by `scripts/package-deploy.js`.",
    "",
    "**The images are " + arch + ".** On a different architecture they will not run.",
    "Re-package on a matching machine, or build from source on the target.",
    "",
    "## 0 - Unpack",
    "",
    B + "sh",
    "tar -xf speedtest-deploy.tar",
    "cd speedtest-deploy",
    B,
    "",
    "If you are reading this you have already done it. It is written down because",
    "the outer archive is a bundle, not a Docker image: `docker load -i",
    "speedtest-deploy.tar` answers `unrecognized image format`, which is easy to",
    "read as a corrupt download rather than as the wrong file. The image archive",
    "is `images.tar`, one level in.",
    "",
    "## 1 - Load the images",
    "",
    B + "sh",
    "docker load -i images.tar",
    B,
    "",
    "Loads `" + BACKEND_IMAGE + "` and `" + NGINX_IMAGE + "`. No registry access is",
    "needed at any point.",
    "",
    "## 2 - Certificate",
    "",
    "The test server has to be https: the super-app WebView refuses http as mixed",
    "content, and the build refuses to package an http server list.",
    "",
    B + "sh",
    "sudo certbot certonly --standalone -d speedtest.example.la",
    B,
    "",
    "Mount the **live** directory below, not a copy - certbot renews in place, and",
    "a copy would keep serving the expired certificate until somebody noticed.",
    "",
    "## 3 - Configure",
    "",
    B + "sh",
    "cp .env.example .env && chmod 600 .env",
    "# then edit .env",
    B,
    "",
    "Compose reads `.env` from this directory automatically, so nothing has to be",
    "exported on every login. Every variable is documented in the file.",
    "",
    "`SPEEDTEST_STATISTICS_PASSWORD` ships empty on purpose: the statistics page",
    "lists the client IP and ISP behind every recorded result, so there is no sane",
    "default, and compose refuses to start until it is set.",
    "",
    "Write the origin regex dots as `[.]`, not `\\.`. Some shells rewrite the",
    "backslash on the way into docker and the regex then matches nothing - every",
    "origin refused, including the right one. It fails closed, but it costs an",
    "afternoon.",
    "",
    "Then edit `docker/nginx-speedtest-endpoints.conf` and replace",
    "`allow 10.0.0.0/8` with the operations network, or the statistics page stays",
    "closed to everybody.",
    "",
    "## 4 - Run",
    "",
    B + "sh",
    "docker compose --profile tls up -d",
    B,
    "",
    "`--profile dev` instead gives plain http on :8087, for checking the stack",
    "locally. Selecting neither profile starts the backend with nothing in front",
    "of it and publishes no port - inconvenient, and the safe way round.",
    "",
    "## 5 - Check it",
    "",
    "The full acceptance set is in `deploy-backend.md` section 6. The two that",
    "matter most: `garbage.php?ckSize=1` must return `200 1048576`, and an allowed",
    "origin must get **exactly one** `Access-Control-Allow-Origin` header - two",
    "makes the browser reject every response and every measurement fails.",
    "",
    "The first request after `up -d` can come back short while the container is",
    "still starting. Repeat it before believing it.",
    ""
  ].join("\n");
}

function main() {
  log("building the backend image...");
  sh("docker compose -f docker-compose.backend-go.yml build backend-go", {
    env: { ...process.env, SPEEDTEST_STATISTICS_PASSWORD: "packaging-placeholder" }
  });

  const arch = sh(
    "docker image inspect " + BACKEND_IMAGE + " --format {{.Os}}/{{.Architecture}}"
  ).trim();
  log("image platform: " + arch);

  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });

  /* All three images in one archive. The target may have no registry access at
     all, and nginx:alpine and php:fpm-alpine are as unreachable there as our
     own image.

     The two stock images are pulled first rather than assumed: `docker save`
     on an image this machine has never seen fails, and packaging is not the
     moment to discover that. A pull that fails because the image is already
     local and the network is down is not fatal - the save that follows is
     what actually has to work. */
  for (const image of [NGINX_IMAGE, PHP_IMAGE]) {
    try {
      sh("docker image inspect " + image + " --format {{.Id}}");
    } catch (e) {
      log("pulling " + image + "...");
      sh("docker pull " + image);
    }
  }

  log("saving images (the slow part)...");
  const imagesTar = path.join(STAGE, "images.tar");
  sh(
    "docker save " +
      [BACKEND_IMAGE, NGINX_IMAGE, PHP_IMAGE].join(" ") +
      ' -o "' + imagesTar + '"'
  );
  ok("images.tar  " + human(fs.statSync(imagesTar).size));

  fs.writeFileSync(path.join(STAGE, "docker-compose.yml"), bundleCompose());

  for (const f of [
    "docker/nginx-backend-go.conf",
    "docker/nginx-backend-go-tls.conf",
    "docker/nginx-speedtest-endpoints.conf",
    "docker/speedtest_limits.conf",
    "docker/speedtest_proxy.conf",
    "docker/backend-go.settings.toml",
    /* clear_env = no. Without it every getenv() in export.php returns false and
       the endpoint answers "export storage unavailable" with the variables
       plainly set - see docs/deploy-backend.md section 8. */
    "docker/php-export-fpm.conf"
  ]) {
    copy(f);
  }

  /* The export endpoint itself. The compose mounts ./backend into the php
     container, so this has to be in the bundle or the mount is empty and every
     export 404s. */
  copy("backend/export.php");
  copy("backend/cors_util.php");

  /* 40 MB, and not optional: without it getIP returns no ISP name and
     MOBILE_OPERATOR - the carrier the whole report groups by - is null on every
     record. */
  copy("backend/country_asn.mmdb");
  /*
    The runbooks, and everything they link to.

    deploy-backend.md alone shipped with two dead links in it - it points at
    test-assets.md for what the Web and Video samples are, and at
    architecture.md §3 for why the server has to be neutral. Whoever reads it
    is on the server, with no repository to go and look in.

    checkDocLinks below fails the packaging if this list falls behind the
    cross-references again.
  */
  for (const doc of BUNDLED_DOCS) copy("docs/" + doc);
  checkDocLinks();

  /*
    Shipped as .example, not as .env.

    Compose reads .env from this directory automatically, so a real .env in the
    bundle would be overwritten by the next `tar -xf` over an existing
    deployment - silently replacing a working configuration, password included.
    And a .env carrying a placeholder password would pass the compose guard and
    deploy a known credential, which is the failure CHANGE-006 removed from the
    PHP image.

    The password is left EMPTY on purpose: `${VAR:?...}` treats empty as unset,
    so an unedited copy refuses to start and says what to set.
  */
  fs.writeFileSync(path.join(STAGE, ".env.example"), envExample());

  const assetsDir = path.join(ROOT, "test-assets");
  fs.mkdirSync(path.join(STAGE, "test-assets"), { recursive: true });
  /*
    Files only. test-assets/ also holds source/, the master clip the tiers are
    cut from - tens of megabytes, of no use to the server, and a directory,
    which copyFileSync throws on rather than skips.
  */
  const have = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
    : [];
  for (const f of have) {
    fs.copyFileSync(path.join(assetsDir, f), path.join(STAGE, "test-assets", f));
  }
  if (!have.includes("browse-sample.html")) {
    warn("test-assets/browse-sample.html missing - the Web stage will 404.");
    warn("  Run: node scripts/make-test-assets.js");
  }

  const missingVideo = expectedVideoAssets().filter((a) => !have.includes(a.name));
  for (const asset of missingVideo) {
    if (asset.fallbackUrl) {
      /*
        The failure this warning exists for. A tier with a fallback does not
        break - it quietly plays somebody else's clip from somebody else's CDN,
        so the bundle looks complete, the stage reports numbers, and those
        numbers describe a host this deployment does not own.
      */
      warn(
        "test-assets/" + asset.name + " missing - the " + asset.label +
          " will fall back to " + hostOf(asset.fallbackUrl) + ","
      );
      warn("  so it measures that host instead of this server.");
    } else {
      warn(
        "test-assets/" + asset.name + " missing - the " + asset.label +
          " will 404 and report Error."
      );
    }
  }
  if (missingVideo.length > 0) {
    warn("  It needs ffmpeg; scripts/make-test-assets.js prints the command.");
  }

  fs.writeFileSync(path.join(STAGE, "DEPLOY.md"), deployNotes(arch));

  log("archiving...");
  const archive = path.join(OUT_ROOT, "speedtest-deploy.tar");
  /*
    Not gzipped. The bulk of the bundle is images.tar, whose layers are already
    compressed, so a second pass buys little for the time it costs - and a plain
    .tar is what the extension says it is.

    Relative paths, run from inside the output directory: GNU tar reads a
    leading "C:" in a Windows path as a remote host and fails to resolve it.
  */
  sh("tar -cf speedtest-deploy.tar speedtest-deploy", { cwd: OUT_ROOT });
  ok("bundle: " + path.relative(ROOT, archive) + "  " + human(fs.statSync(archive).size));

  /*
    The same three commands, OUTSIDE the archive.

    DEPLOY.md only becomes readable after unpacking, which is exactly the step
    somebody has not taken yet when they reach for `docker load -i
    speedtest-deploy.tar` - and Docker answers that with "unrecognized image
    format", which reads like a corrupt transfer rather than the wrong file.
    Send this file alongside the archive.
  */
  fs.writeFileSync(
    path.join(OUT_ROOT, "README-FIRST.txt"),
    [
      "speedtest-deploy.tar is a BUNDLE, not a Docker image.",
      "",
      "  tar -xf speedtest-deploy.tar",
      "  cd speedtest-deploy",
      "  docker load -i images.tar        <- the image archive is this one, inside",
      "",
      "Then follow DEPLOY.md in that directory.",
      "",
      "Running `docker load -i speedtest-deploy.tar` on the bundle itself answers",
      '"unrecognized image format". That means wrong file, not corrupt download.',
      ""
    ].join("\n")
  );

  console.log(
    "\nCopy it over, then on the server:\n" +
      "  tar -xf speedtest-deploy.tar && cd speedtest-deploy\n" +
      "  docker load -i images.tar\n" +
      "  # then follow DEPLOY.md\n"
  );
}

main();
