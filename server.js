// Simple zero-dependency server for the URL Health Checker.
// Serves index.html and provides /check?url=... which returns the REAL
// HTTP status code (200/404/...) for any URL — no CORS limits server-side.
//
//   node server.js            → http://localhost:3000
//   PORT=8080 node server.js

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const TIMEOUT = 15000;

function checkUrl(target) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(target); } catch { return resolve({ error: 'invalid url' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve({ error: 'unsupported protocol' });

    const lib = u.protocol === 'https:' ? https : http;
    const start = Date.now();

    const doReq = (method, redirectsLeft) => {
      const req = lib.request(target, {
        method,
        timeout: TIMEOUT,
        headers: { 'User-Agent': 'URL-Health-Checker/1.0', 'Accept': '*/*' },
      }, res => {
        const status = res.statusCode;
        // follow redirects
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = new URL(res.headers.location, target).href;
          return doReq(method, redirectsLeft - 1);
        }
        // some servers reject HEAD (405) — retry with GET
        if ((status === 405 || status === 501) && method === 'HEAD') {
          res.resume();
          return doReq('GET', redirectsLeft);
        }
        res.resume();
        resolve({ status, ms: Date.now() - start, contentType: res.headers['content-type'] || '' });
      });
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
      req.on('error', err => resolve({ error: err.code || err.message }));
      req.end();
    };
    doReq('HEAD', 5);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  if (parsed.pathname === '/check') {
    const target = parsed.searchParams.get('url');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!target) { res.writeHead(400); return res.end(JSON.stringify({ error: 'missing url' })); }
    const result = await checkUrl(target);
    res.writeHead(200);
    return res.end(JSON.stringify(result));
  }

  // static: serve index.html
  const file = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const filePath = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`URL Health Checker running → http://localhost:${PORT}`);
  console.log(`Tick "Use server" in the page for real HTTP status codes.`);
});
