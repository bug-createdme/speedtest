<?php

require_once __DIR__.'/cors_util.php';

/*
    A download URL for an export the WebView cannot hand over itself.

    ── WHY THIS ENDPOINT EXISTS ────────────────────────────────────────────────

    Getting a spreadsheet off the handset has no client-side route on Android,
    and this is not a bug anyone here can fix:

      - Android WebView has no Web Share API at all. It is a Chrome feature,
        not a WebView one, so navigator.share is undefined and the route that
        works on iOS does not exist.
      - blob: downloads are refused by the container.
      - WVFile.write answers "Please apply for JSAPI authorization" - the
        method is there, the mini-app is simply not on the container's
        allowlist for it, and only the super-app team can change that.

    What IS available and already authorized is CustomServiceJs.shareContent,
    which carries a URL. So the export is uploaded here, and the mini-app
    shares the link. Content-Disposition then makes any browser save it as a
    file, in either format, on every platform. This is the CHANGE-009 route
    that ui/src/report/share.js has been pointing at.

    ── WHAT IS STORED, AND FOR HOW LONG ────────────────────────────────────────

    An export carries ISDNs, so this is subscriber-identifying data sitting on
    a server. Three things keep that bounded, and none of them is a password:

      - the id is 16 random bytes, so a URL cannot be guessed or enumerated;
      - files are deleted after SPEEDTEST_EXPORT_TTL (30 minutes by default),
        opportunistically on every request, so the window is a share sheet's
        lifetime rather than forever;
      - nothing here logs the body, and the download is sent no-store with
        X-Robots-Tag: noindex.

    What this deliberately does NOT claim to be: access control. Anyone holding
    the link can fetch it until it expires. That is the same property the link
    has once it is in a share sheet, and it is why the TTL is short. Rate
    limiting belongs in front of the application - docker/nginx-speedtest.conf
    is the ready configuration, same as for garbage.php.

    ── CONFIGURATION (environment) ─────────────────────────────────────────────

      SPEEDTEST_EXPORT_ENABLED    "0" turns the endpoint off entirely (503)
      SPEEDTEST_EXPORT_DIR        where files live (default: ./exports)
      SPEEDTEST_EXPORT_TTL        seconds before deletion (default: 1800)
      SPEEDTEST_EXPORT_MAX_BYTES  refused above this (default: 5 MiB)
      SPEEDTEST_EXPORT_BASE_URL   absolute base for the returned URL, for
                                  deployments behind a proxy that rewrites the
                                  path. Default: derived from this request.

    ── API ─────────────────────────────────────────────────────────────────────

      POST ?cors=true&name=speedtest-history.csv   body = the file bytes
        -> 201 {"url": "...", "expires_in": 1800}

      GET  ?id=<32 hex>
        -> 200 the file, as an attachment
        -> 404 once it has expired
*/

const EXPORT_TYPES = [
    'csv' => 'text/csv; charset=utf-8',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/**
 * Read an integer setting from the environment, falling back to a default.
 *
 * @param string $name
 * @param int    $default
 * @param int    $min
 *
 * @return int
 */
function exportIntEnv($name, $default, $min = 1)
{
    $raw = getenv($name);
    if (false === $raw || '' === trim($raw) || !ctype_digit(trim($raw))) {
        return $default;
    }
    $value = (int) trim($raw);

    return $value < $min ? $default : $value;
}

/**
 * @return bool
 */
function exportEnabled()
{
    $raw = getenv('SPEEDTEST_EXPORT_ENABLED');

    return !(false !== $raw && '0' === trim($raw));
}

/**
 * @return string
 */
function exportDir()
{
    $raw = getenv('SPEEDTEST_EXPORT_DIR');
    if (false !== $raw && '' !== trim($raw)) {
        return rtrim(trim($raw), '/\\');
    }

    return __DIR__.'/exports';
}

/**
 * @return int
 */
function exportTtl()
{
    return exportIntEnv('SPEEDTEST_EXPORT_TTL', 1800, 60);
}

/**
 * A short, stable marker for the machine answering this request.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 *
 * Behind a load balancer with more than one node in the pool, an export is
 * written to whichever node received the POST, and the download can be sent to
 * a different one - which has never heard of the id and answers "expired or
 * unknown". That is indistinguishable from a link that genuinely timed out, so
 * the fault looks intermittent and gets blamed on the TTL.
 *
 * Comparing this marker between the upload's reply and the download's tells the
 * two apart in one look: same value means the id really is gone, different
 * values mean the pool is splitting the pair and the exports need shared
 * storage. See docs/deploy-backend.md section 8.
 *
 * Hashed rather than the hostname itself: the answer needed is only "same box
 * or not", and an internal hostname is not something to publish to get it.
 *
 * @return string
 */
function exportNodeId()
{
    $host = php_uname('n');

    return substr(hash('sha256', (string) $host), 0, 8);
}

/**
 * Answer with JSON and stop.
 *
 * @param int   $status
 * @param array $payload
 *
 * @return void
 */
function exportJson($status, array $payload)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Export-Node: '.exportNodeId());
    echo json_encode($payload);
    exit;
}

/**
 * Create the storage directory, and stop it being served directly.
 *
 * The files are only ever read back through this script, so nothing needs to
 * reach them over HTTP. The .htaccess covers Apache; an nginx deployment wants
 * a `location` deny rule instead, which the deployment notes carry. Both are
 * defence in depth behind an unguessable name, not the thing keeping the data
 * private.
 *
 * @return string|null The directory, or null when it cannot be used.
 */
function exportEnsureDir()
{
    $dir = exportDir();
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        return null;
    }
    if (!is_writable($dir)) {
        return null;
    }
    $guard = $dir.'/.htaccess';
    if (!file_exists($guard)) {
        @file_put_contents($guard, "Require all denied\nDeny from all\n");
    }

    return $dir;
}

/**
 * Delete everything past its expiry.
 *
 * Opportunistic rather than scheduled: this runs on every request, which for
 * an endpoint used a handful of times a day is cheaper than a cron entry
 * somebody has to remember to install on each deployment.
 *
 * @param string $dir
 *
 * @return void
 */
function exportCollectGarbage($dir)
{
    $deadline = time() - exportTtl();
    $files = glob($dir.'/*__*');
    if (false === $files) {
        return;
    }
    foreach ($files as $file) {
        if (is_file($file) && @filemtime($file) < $deadline) {
            @unlink($file);
        }
    }
}

/**
 * Reduce a client-supplied filename to something safe to store and serve.
 *
 * The extension decides the content type and must be one we know; the stem is
 * stripped to characters that cannot traverse a path or confuse a
 * Content-Disposition header. A name that survives none of that becomes the
 * default rather than an error, because the file itself is still fine.
 *
 * @param string $name
 *
 * @return array|null [safeName, mime], or null when the extension is not allowed
 */
function exportSafeName($name)
{
    $name = basename(str_replace('\\', '/', (string) $name));
    $dot = strrpos($name, '.');
    $ext = false === $dot ? '' : strtolower(substr($name, $dot + 1));
    if (!isset(EXPORT_TYPES[$ext])) {
        return null;
    }
    $stem = false === $dot ? '' : substr($name, 0, $dot);
    $stem = preg_replace('/[^A-Za-z0-9._-]/', '-', $stem);
    $stem = trim((string) $stem, '.-');
    if ('' === $stem) {
        $stem = 'speedtest-history';
    }
    if (strlen($stem) > 64) {
        $stem = substr($stem, 0, 64);
    }

    return [$stem.'.'.$ext, EXPORT_TYPES[$ext]];
}

/**
 * The absolute URL a client should be handed for an id.
 *
 * @param string $id
 *
 * @return string
 */
function exportUrl($id)
{
    $base = getenv('SPEEDTEST_EXPORT_BASE_URL');
    if (false !== $base && '' !== trim($base)) {
        return rtrim(trim($base), '/').'?id='.$id;
    }
    $https = (!empty($_SERVER['HTTPS']) && 'off' !== $_SERVER['HTTPS'])
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && 'https' === $_SERVER['HTTP_X_FORWARDED_PROTO']);
    $scheme = $https ? 'https' : 'http';
    $host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
    $path = isset($_SERVER['SCRIPT_NAME']) ? $_SERVER['SCRIPT_NAME'] : '/backend/export.php';

    return $scheme.'://'.$host.$path.'?id='.$id;
}

/* ── Request ────────────────────────────────────────────────────────────────*/

// A preflight has to be answered before anything else looks at the method.
if (isset($_SERVER['REQUEST_METHOD']) && 'OPTIONS' === $_SERVER['REQUEST_METHOD']) {
    applyCorsOrExit('GET, POST, OPTIONS', 'Content-Type', 86400);
    http_response_code(204);
    exit;
}

applyCorsOrExit('GET, POST, OPTIONS', 'Content-Type', 86400);

if (!exportEnabled()) {
    exportJson(503, ['error' => 'export disabled']);
}

$dir = exportEnsureDir();
if (null === $dir) {
    exportJson(503, ['error' => 'export storage unavailable']);
}

exportCollectGarbage($dir);

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';

if ('POST' === $method) {
    $max = exportIntEnv('SPEEDTEST_EXPORT_MAX_BYTES', 5 * 1024 * 1024, 1024);

    $declared = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
    if ($declared > $max) {
        exportJson(413, ['error' => 'too large', 'max_bytes' => $max]);
    }

    $safe = exportSafeName(isset($_GET['name']) ? $_GET['name'] : '');
    if (null === $safe) {
        exportJson(400, ['error' => 'unsupported file type']);
    }
    list($safeName, $mime) = $safe;

    // Capped rather than trusting Content-Length, which a client controls.
    $body = @file_get_contents('php://input', false, null, 0, $max + 1);
    if (false === $body || '' === $body) {
        exportJson(400, ['error' => 'empty body']);
    }
    if (strlen($body) > $max) {
        exportJson(413, ['error' => 'too large', 'max_bytes' => $max]);
    }

    try {
        $id = bin2hex(random_bytes(16));
    } catch (Exception $e) {
        exportJson(500, ['error' => 'no entropy']);
    }

    $path = $dir.'/'.$id.'__'.$safeName;
    if (false === @file_put_contents($path, $body, LOCK_EX)) {
        exportJson(500, ['error' => 'could not store export']);
    }
    @chmod($path, 0640);

    exportJson(201, [
        'url' => exportUrl($id),
        'expires_in' => exportTtl(),
        'bytes' => strlen($body),
        // Also in the body, not only the header: this is the value to compare
        // against the one the download answers with.
        'node' => exportNodeId(),
    ]);
}

if ('GET' === $method) {
    $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
    // Validated before it reaches the filesystem: 32 hex characters cannot
    // contain a separator, a dot, or a wildcard.
    if (32 !== strlen($id) || !ctype_xdigit($id)) {
        exportJson(400, ['error' => 'bad id']);
    }

    $matches = glob($dir.'/'.$id.'__*');
    if (empty($matches) || !is_file($matches[0])) {
        exportJson(404, ['error' => 'expired or unknown']);
    }
    $path = $matches[0];

    $name = substr(basename($path), 34); // strip "<32 hex>__"
    $dot = strrpos($name, '.');
    $ext = false === $dot ? '' : strtolower(substr($name, $dot + 1));
    if (!isset(EXPORT_TYPES[$ext])) {
        exportJson(404, ['error' => 'expired or unknown']);
    }

    header('Content-Type: '.EXPORT_TYPES[$ext]);
    header('Content-Length: '.filesize($path));
    header('Content-Disposition: attachment; filename="'.$name.'"');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    // Subscriber data behind an unguessable URL has no business in an index.
    header('X-Robots-Tag: noindex, nofollow');
    header('X-Content-Type-Options: nosniff');
    header('X-Export-Node: '.exportNodeId());
    readfile($path);
    exit;
}

exportJson(405, ['error' => 'method not allowed']);
