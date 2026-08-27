<?php

/**
 * Cross-origin headers for the measurement endpoints.
 *
 * Every endpoint here used to answer `Access-Control-Allow-Origin: *` inline.
 * Combined with garbage.php, which will stream up to 1 GiB per request, that
 * made this server a bandwidth amplifier any web page on the internet could
 * point at, on someone else's infrastructure bill.
 *
 * WHAT THIS DOES AND DOES NOT BUY
 *
 * An origin allowlist is enforced by the *browser*, not by us: it stops a third
 * party web page from driving this test point, which is the abuse route that
 * actually matters for a mini-app. It does nothing at all against curl, a
 * script, or anything that is not a browser - those ignore CORS entirely. The
 * defence against those is rate limiting, which belongs in front of the
 * application; docker/nginx-speedtest.conf is a ready configuration for it.
 *
 * CONFIGURATION
 *
 * ALLOWED_ORIGINS, comma separated, read from the environment:
 *
 *   ALLOWED_ORIGINS=*                                 any origin (the default,
 *                                                     preserves old behaviour)
 *   ALLOWED_ORIGINS=https://app.unitel.com.la         one origin
 *   ALLOWED_ORIGINS=https://a.example,https://b.test  several
 *
 * The default stays permissive on purpose: tightening it silently would break
 * every existing deployment and the e2e suite on upgrade. Production is
 * expected to set it, and the deployment checklist in docs/architecture.md
 * says so.
 */

/**
 * Parse ALLOWED_ORIGINS into a list. An empty or unset value means "*".
 *
 * @return string[] Origins, or ['*'] for allow-any.
 */
function speedtestAllowedOrigins()
{
    $raw = getenv('ALLOWED_ORIGINS');
    if (false === $raw || '' === trim($raw)) {
        return ['*'];
    }
    $origins = [];
    foreach (explode(',', $raw) as $candidate) {
        $candidate = trim($candidate);
        if ('' === $candidate) {
            continue;
        }
        if ('*' === $candidate) {
            return ['*'];
        }
        // Compare scheme+host+port only; a configured trailing slash or path
        // is a config typo we can absorb rather than fail on.
        $origins[] = rtrim($candidate, '/');
    }
    return empty($origins) ? ['*'] : $origins;
}

/**
 * The Origin header of the request in hand, normalized the same way.
 *
 * @return string Empty when the request carries no Origin (same-origin GETs,
 *                curl, and health checks all look like this).
 */
function speedtestRequestOrigin()
{
    if (empty($_SERVER['HTTP_ORIGIN'])) {
        return '';
    }
    return rtrim(trim($_SERVER['HTTP_ORIGIN']), '/');
}

/**
 * Emit the CORS headers for one endpoint.
 *
 * Only called when the client asked for cross-origin mode (`?cors=true`),
 * which is what the engine sends in multi-point-of-test mode. Same-origin
 * standalone deployments never reach this and are unaffected.
 *
 * @param string      $methods Value for Access-Control-Allow-Methods.
 * @param string|null $headers Value for Access-Control-Allow-Headers, or null.
 * @param int         $maxAge  Preflight cache lifetime in seconds, 0 to omit.
 *
 * @return bool False when the origin is not allowed, so the caller can stop
 *              before doing expensive work.
 */
function sendCorsHeaders($methods = 'GET, POST', $headers = null, $maxAge = 0)
{
    $allowed = speedtestAllowedOrigins();
    $origin = speedtestRequestOrigin();

    if (['*'] === $allowed) {
        header('Access-Control-Allow-Origin: *');
    } else {
        // The response now differs by request origin, so caches must key on it.
        // Without this a shared cache can hand an allowed origin's response to
        // a disallowed one, or the reverse.
        header('Vary: Origin');

        if ('' === $origin) {
            // No Origin header: not a cross-origin browser request at all.
            // Nothing to allow, nothing to block - let it through unlabelled.
            return true;
        }
        if (!in_array($origin, $allowed, true)) {
            return false;
        }
        header('Access-Control-Allow-Origin: '.$origin);
    }

    header('Access-Control-Allow-Methods: '.$methods);
    if (null !== $headers) {
        header('Access-Control-Allow-Headers: '.$headers);
    }
    if ($maxAge > 0) {
        header('Access-Control-Max-Age: '.$maxAge);
    }

    return true;
}

/**
 * Apply CORS if requested, and end the request when the origin is refused.
 *
 * Answering 403 with no ACAO header is what a browser needs in order to report
 * a CORS failure rather than a network error, and it stops garbage.php before
 * it streams anything.
 *
 * @param string      $methods
 * @param string|null $headers
 * @param int         $maxAge
 *
 * @return void
 */
function applyCorsOrExit($methods = 'GET, POST', $headers = null, $maxAge = 0)
{
    if (!isset($_GET['cors'])) {
        return;
    }
    if (sendCorsHeaders($methods, $headers, $maxAge)) {
        return;
    }
    header('HTTP/1.1 403 Forbidden');
    header('Content-Type: text/plain; charset=utf-8');
    echo "origin not allowed\n";
    exit;
}
