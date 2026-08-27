<?php

require_once __DIR__.'/cors_util.php';

header('HTTP/1.1 200 OK');

// Origin allowlist via ALLOWED_ORIGINS, "*" by default - see cors_util.php.
// Max-Age caches the preflight so it isn't repeated before every ping/upload
// chunk. Each request already carries a random cache-busting parameter, so
// this does not affect the no-cache policy on the request itself, only on the
// separate OPTIONS preflight the browser issues ahead of a non-simple one.
applyCorsOrExit('GET, POST', 'Content-Encoding, Content-Type', 86400);

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
header('Connection: keep-alive');
