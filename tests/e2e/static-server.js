/*
  Minimal static file server for the Playwright e2e "webServer".

  This replaces a `python3 -m http.server` invocation. python3 is not a
  reliable cross-platform command: on Windows it commonly resolves to the App
  Execution Alias stub rather than a real interpreter, which fails outright
  and blocks the entire e2e run (Playwright waits on this server before any
  test starts, including the ones that never touch it directly). Node is
  already a hard requirement for this whole toolchain, so a small server
  built on its own http/fs modules needs nothing extra installed and behaves
  the same on every platform CI or a contributor might run this on.
*/

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = process.argv[2] || '127.0.0.1';
const PORT = Number(process.argv[3]) || 18184;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  // The video stage samples. Without these a <video> is handed
  // application/octet-stream and only plays if the browser happens to sniff
  // the container, which is not something to leave a test resting on.
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

// Resolves a request path to a file under ROOT, or null if it doesn't
// resolve to a file (missing, a directory with no index.html, or an attempt
// to escape ROOT via "..").
function resolveFile(requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0].split('#')[0]);
  const relative = decoded.replace(/^\/+/, '');
  let filePath = path.normalize(path.join(ROOT, relative));

  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return null; // escaped ROOT, e.g. via ../../
  }

  try {
    let stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath);
    }
    return stat.isFile() ? filePath : null;
  } catch (e) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const filePath = resolveFile(req.url);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'Not found');
    return;
  }

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || DEFAULT_CONTENT_TYPE;
  res.writeHead(200, { 'Content-Type': contentType });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Static server serving ${ROOT} at http://${HOST}:${PORT}`);
});
