// Netlify serverless version of the /check endpoint.
// Returns the real HTTP status code for any URL (no CORS limits server-side).
const http = require('http');
const https = require('https');
const { URL } = require('url');

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
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          target = new URL(res.headers.location, target).href;
          return doReq(method, redirectsLeft - 1);
        }
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

exports.handler = async (event) => {
  const target = (event.queryStringParameters || {}).url;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (!target) return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing url' }) };
  const result = await checkUrl(target);
  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
