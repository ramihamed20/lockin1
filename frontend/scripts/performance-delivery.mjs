import { request } from 'node:http';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const expectGzip = process.argv.includes("--expectGzip=1");
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const output = resolve(outputArg?.slice('--output='.length) ?? 'output/performance/nginx-delivery.json');
const stateArg = process.argv.find((arg) => arg.startsWith('--state='));
const state = JSON.parse(await readFile(stateArg?.slice('--state='.length) ?? 'output/performance/nginx-lab-state.json', 'utf8'));
const assetDir = resolve(state.prefix, 'html/assets');
const files = (await readdir(assetDir)).filter((name) => /^index-.*\.(js|css)$/.test(name) || /^pdf\.worker.*\.mjs$/.test(name));
if (files.length < 3) throw new Error('Expected application JS, CSS and PDF worker');
const digest = (body) => createHash('sha256').update(body).digest('hex');
function get(url, acceptEncoding, via) {
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Loopback HTTP only');
  return new Promise((resolveResponse, reject) => {
    const req = request(url, { headers: { 'Accept-Encoding': acceptEncoding, ...(via ? { Via: '1.1 local-synthetic-proxy' } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(10000, () => req.destroy(new Error('Local delivery request timed out')));
    req.on('error', reject);
    req.end();
  });
}
const rows = [];
for (const variant of state.variants) {
  const name = `${variant.shape}:${variant.variant}`;
  for (const file of files) {
    const original = await readFile(resolve(assetDir, file));
    for (const [acceptEncoding, via] of [['identity', false], ['gzip', false], ['gzip;q=0', false], ['gzip', true]]) {
      const response = await get(new URL(`/assets/${file}`, variant.url), acceptEncoding, via);
      const encoding = response.headers['content-encoding'] ?? 'identity';
      const decoded = encoding === 'gzip' ? gunzipSync(response.body) : response.body;
      if (response.status !== 200 || !decoded.equals(original)) throw new Error(`${name}: decoded asset mismatch ${file}`);
      if (acceptEncoding !== 'gzip' && encoding !== 'identity') throw new Error('Identity/q=0 unexpectedly compressed');
      if (expectGzip && variant.variant === 'current') {
        if (acceptEncoding === 'gzip' && encoding !== 'gzip') throw new Error('Public asset was not compressed');
        if (!String(response.headers.vary).toLowerCase().split(/,\s*/).includes('accept-encoding')) throw new Error('Missing negotiated encoding Vary');
      }
      const expectedType = file.endsWith('.css') ? 'text/css' : 'application/javascript';
      if (!String(response.headers['content-type']).startsWith(expectedType)) throw new Error(`${file}: incorrect MIME`);
      rows.push({ variant: name, path: `/assets/${file}`, acceptEncoding, via, originalBytes: original.length, wireBodyBytes: response.body.length, encoding, contentType: response.headers['content-type'], vary: response.headers.vary ?? null, cacheControl: response.headers['cache-control'] ?? null, etag: response.headers.etag ?? null, decodedSHA256: digest(decoded) });
    }
  }
  for (const path of ['/service-worker.js', '/api/v1/auth/session']) {
    const response = await get(new URL(path, variant.url), 'gzip', false);
    rows.push({ variant: name, path, status: response.status, encoding: response.headers['content-encoding'] ?? 'identity', wireBodyBytes: response.body.length, cacheControl: response.headers['cache-control'] ?? null, contentType: response.headers['content-type'] ?? null });
  }
}
const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), environment: state, limitations: ['Local public static assets and synthetic API only', 'Byte integrity/delivery checks; no timing or production TLS/Linux assertion'], rows };
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, rows: rows.filter((row) => row.acceptEncoding === 'gzip' && !row.via).map(({ variant, path, originalBytes, wireBodyBytes, encoding, contentType, cacheControl }) => ({ variant, path, originalBytes, wireBodyBytes, encoding, contentType, cacheControl })) }, null, 2));
