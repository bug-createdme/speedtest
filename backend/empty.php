<?php

header('HTTP/1.1 200 OK');

if (isset($_GET['cors'])) {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST');
    header('Access-Control-Allow-Headers: Content-Encoding, Content-Type');
    // Cache the preflight so it isn't repeated before every ping/upload chunk.
    // Each request already carries a random cache-busting parameter, so this
    // does not affect the no-cache policy on the request itself, only on the
    // separate OPTIONS preflight the browser issues ahead of a non-simple one.
    header('Access-Control-Max-Age: 86400');
}

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
header('Cache-Control: post-check=0, pre-check=0', false);
header('Pragma: no-cache');
header('Connection: keep-alive');
