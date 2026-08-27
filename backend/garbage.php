<?php

require_once __DIR__.'/cors_util.php';

// Disable Compression
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');
@ini_set('output_handler', '');

/*
    Origin check first, before anything else in this file runs.

    This endpoint generates a megabyte of random bytes and then streams it back
    up to 1024 times - the single most expensive thing this server does. A
    request from an origin that is not allowed must cost nothing, so the check
    happens here rather than inside sendHeaders(), which the original code only
    reached after the payload had already been generated.
*/
applyCorsOrExit('GET, POST');

/**
 * @return int
 */
function getChunkCount()
{
    if (
        !array_key_exists('ckSize', $_GET)
        || !ctype_digit($_GET['ckSize'])
        || (int) $_GET['ckSize'] <= 0
    ) {
        return 4;
    }

    if ((int) $_GET['ckSize'] > 1024) {
        return 1024;
    }

    return (int) $_GET['ckSize'];
}

/**
 * @return void
 */
function sendHeaders()
{
    header('HTTP/1.1 200 OK');

    // Indicate a file download
    header('Content-Description: File Transfer');
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename=random.dat');
    header('Content-Transfer-Encoding: binary');

    // Cache settings: never cache this request
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0, s-maxage=0');
    header('Cache-Control: post-check=0, pre-check=0', false);
    header('Pragma: no-cache');
}

// Determine how much data we should send
$chunks = getChunkCount();

// Generate data
$data = openssl_random_pseudo_bytes(1048576);

// Deliver chunks of 1048576 bytes
sendHeaders();
for ($i = 0; $i < $chunks; $i++) {
    echo $data;
    flush();
}
