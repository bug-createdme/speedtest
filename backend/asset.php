<?php
/*
 * Serves the Web and Video stage samples with CORS and byte ranges.
 *
 * Only needed on the PHP backend. The Go backend applies its CORS middleware to
 * the whole router, static files included (backend-go/web/web.go), so there the
 * samples can simply be dropped into the assets directory and pointed at
 * directly - no endpoint required.
 *
 * On PHP the samples would be served by Apache or nginx, which send no CORS
 * headers, and the Web stage counts bytes with fetch(): without those headers
 * the browser refuses the read and the stage reports Error. So the files go
 * through here instead, where cors_util.php already decides what is allowed.
 *
 * Two things this does beyond adding a header:
 *
 * - Byte ranges. A <video> element requests ranges; served a flat 200 with no
 *   Accept-Ranges, some players will not start at all and every run would read
 *   as a failed measurement rather than as a slow link.
 * - No compression. The Web stage counts bytes AFTER the transport decompresses
 *   them, so a gzipped response would report more bytes than crossed the link
 *   and flatter the connection. Turned off explicitly here.
 *
 * Usage: asset.php?f=browse-sample.html
 */

require_once __DIR__.'/cors_util.php';

/*
 * CORS unconditionally, NOT behind ?cors=true.
 *
 * The measurement endpoints gate their CORS headers on that parameter, because
 * a standalone same-origin deployment runs the same files and should not pay
 * for preflights it does not need. This endpoint is the opposite case: it exists
 * only to be read cross-origin.
 *
 * The browse stage does append cors=true (speedtest_worker.js, browseTest), but
 * the video does not - streaming.js assigns <video>.src directly, and a <video>
 * with crossOrigin="anonymous" and no CORS headers fails to load at all. Gating
 * here would leave the video working only if whoever wrote settings.json
 * remembered to hand-append &cors=true, and failing as "broken video" if they
 * did not.
 *
 * The origin allowlist still applies - sendCorsHeaders() enforces
 * ALLOWED_ORIGINS and returns false for an origin that is not on it.
 *
 * "Range" is listed explicitly because it is not a CORS-safelisted request
 * header: a <video> asking for a byte range triggers a preflight, and a
 * preflight that does not allow Range fails. Max-Age caches that answer instead
 * of repeating it before every range the player asks for.
 */
if (!sendCorsHeaders('GET, HEAD, OPTIONS', 'Range, Content-Type', 86400)) {
    header('HTTP/1.1 403 Forbidden');
    header('Content-Type: text/plain; charset=utf-8');
    echo "origin not allowed\n";
    exit;
}

/* A preflight asks whether the real request would be allowed. Answering it with
   a megabyte of body would spend the very link being measured. */
if (isset($_SERVER['REQUEST_METHOD']) && 'OPTIONS' === $_SERVER['REQUEST_METHOD']) {
    header('HTTP/1.1 204 No Content');
    exit;
}

/*
 * A fixed list, not a path. This endpoint takes a filename from the query
 * string, and anything that resolves a caller-supplied path - however carefully
 * - is one bug away from serving the rest of the disk. Two names are all that
 * is needed, so two names are all that exist.
 */
$ALLOWED = array(
    'browse-sample.html' => 'text/html; charset=utf-8',
    'video-sample.mp4'   => 'video/mp4',
);

$name = isset($_GET['f']) ? (string)$_GET['f'] : '';
if (!array_key_exists($name, $ALLOWED)) {
    header('HTTP/1.1 404 Not Found');
    header('Content-Type: text/plain');
    echo "Unknown asset. Available: " . implode(', ', array_keys($ALLOWED)) . "\n";
    exit;
}

$path = __DIR__ . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . $name;
if (!is_file($path)) {
    header('HTTP/1.1 404 Not Found');
    header('Content-Type: text/plain');
    echo "Asset not deployed: backend/assets/$name\n";
    echo "Build it with: node scripts/make-test-assets.js\n";
    exit;
}

/* Counted bytes must equal bytes on the wire - see the note above. */
@ini_set('zlib.output_compression', 'Off');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
header('Content-Encoding: identity');

/* These are measurements: a cached response measures nothing. */
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

header('Content-Type: ' . $ALLOWED[$name]);
header('Accept-Ranges: bytes');

$size  = filesize($path);
$start = 0;
$end   = $size - 1;

$range = isset($_SERVER['HTTP_RANGE']) ? $_SERVER['HTTP_RANGE'] : '';
if ($range !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', trim($range), $m)) {
    $reqStart = $m[1];
    $reqEnd   = $m[2];

    if ($reqStart === '' && $reqEnd === '') {
        header('HTTP/1.1 416 Range Not Satisfiable');
        header("Content-Range: bytes */$size");
        exit;
    }
    if ($reqStart === '') {
        /* "bytes=-500": the LAST 500 bytes, not the first 500. */
        $length = min((int)$reqEnd, $size);
        $start  = $size - $length;
    } else {
        $start = (int)$reqStart;
        if ($reqEnd !== '') $end = (int)$reqEnd;
    }
    if ($start > $end || $start >= $size) {
        header('HTTP/1.1 416 Range Not Satisfiable');
        header("Content-Range: bytes */$size");
        exit;
    }
    if ($end >= $size) $end = $size - 1;

    header('HTTP/1.1 206 Partial Content');
    header("Content-Range: bytes $start-$end/$size");
}

header('Content-Length: ' . ($end - $start + 1));

$fp = fopen($path, 'rb');
if ($fp === false) {
    header('HTTP/1.1 500 Internal Server Error');
    exit;
}
fseek($fp, $start);

/* Streamed in chunks: a video sample read whole into memory would be a
   per-request memory cost for no benefit. */
$remaining = $end - $start + 1;
while ($remaining > 0 && !feof($fp)) {
    $chunk = fread($fp, min(65536, $remaining));
    if ($chunk === false) break;
    echo $chunk;
    $remaining -= strlen($chunk);
    flush();
}
fclose($fp);
