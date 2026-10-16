// Public cache integrity with a disconnected origin. This deliberately avoids
// WebKit context.setOffline, which rejects SW fetches in this Windows harness.
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
if (options.engine && !['chromium', 'webkit'].includes(options.engine)) throw new Error('Unknown cache-probe engine');
const engine = options.engine === 'chromium' ? chromium : webkit;
// Frozen ordinary builds can be checked directly; the Nginx lab remains the
// default. An explicit digest prevents silently testing a different artifact.
if (options.artifactRoot && !/^[a-f0-9]{64}$/i.test(options.indexSha256 || '')) {
  throw new Error('An explicit artifactRoot requires its indexSha256');
}
const state = options.artifactRoot
  ? { bundleIndexSha256: options.indexSha256.toLowerCase() }
  : JSON.parse(await readFile('output/performance/nginx-lab-state.json', 'utf8'));
const root = options.artifactRoot ? resolve(options.artifactRoot) : resolve(state.prefix, 'html');
const index = await readFile(resolve(root, 'index.html'));
if (createHash('sha256').update(index).digest('hex') !== state.bundleIndexSha256) throw new Error('Public build differs from lab metadata');
const entryAssets = [...new Set([...index.toString('utf8').matchAll(/\/assets\/(index-[A-Za-z0-9_-]+\.(?:js|css))/g)].map(match => match[1]))];
const workers = (await readdir(resolve(root, 'assets'))).filter(name => /^pdf\.worker\.min-[A-Za-z0-9_-]+\.mjs$/.test(name));
if (workers.length !== 1) throw new Error('Expected the matching public PDF worker');
if (entryAssets.length + workers.length !== 3) throw new Error('Expected three representative public assets');
const extraAssets = options.extraAssets ? options.extraAssets.split(',') : [];
if (extraAssets.some(name => !/^[A-Za-z0-9_-]+\.(?:js|mjs|css)$/.test(name))) {
  throw new Error('Extra public assets must be asset filenames without paths');
}
const files = [...new Set([...entryAssets, ...workers, ...extraAssets])];
const originals = new Map(await Promise.all(files.map(async name => {
  const bytes = await readFile(resolve(root, 'assets', name));
  return [name, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
})));
const results = [];
const browser = await engine.launch();
try {
  for (const compressed of [false, true]) {
    let compressedResponses = 0;
    const server = createServer(async (req, res) => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (path === '/__public_cache_probe') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>Public cache probe</title>');
        return;
      }
      const file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
      try {
        let bytes = await readFile(file);
        const types = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
        res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
        if (compressed && path.startsWith('/assets/') && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
          bytes = gzipSync(bytes);
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          compressedResponses++;
        }
        res.end(bytes);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    try {
      const page = await context.newPage();
      await page.goto(origin + '/__public_cache_probe');
      await page.evaluate(() => navigator.serviceWorker.register('/service-worker.js', { scope: '/' }));
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 60_000 });
      const inspect = () => page.evaluate(async names => Promise.all(names.map(async name => {
        const response = await fetch('/assets/' + name);
        const bytes = await response.arrayBuffer();
        return { name, status: response.status, bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('') };
      })), files);
      const online = await inspect();
      server.closeAllConnections();
      await new Promise(resolveClose => server.close(resolveClose));
      const disconnectedOrigin = await inspect();
      for (const phase of [online, disconnectedOrigin]) for (const row of phase) {
        const expected = originals.get(row.name);
        if (row.status !== 200 || row.bytes !== expected.bytes || row.sha256 !== expected.sha256) throw new Error('Public SW cache byte mismatch: ' + row.name);
      }
      if (compressed && compressedResponses < files.length) throw new Error('Compressed public install was not exercised');
      results.push({ compressed, compressedResponses, controlled: true, online, disconnectedOrigin });
    } finally {
      await context.close();
      if (server.listening) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
    }
  }
} finally { await browser.close(); }
const output = resolve(options.output || 'output/performance/public-cache-' + (options.engine || 'webkit') + '.json');
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, JSON.stringify({ schema: 1, date: new Date().toISOString(), engine: options.engine || 'webkit', browser: browser.version(), bundleIndexSha256: state.bundleIndexSha256, limitations: 'Copied public build; actual synthetic origin disconnect; no private leases/account or physical Safari assertion; Node HTTP gzip, not Nginx timing', results }, null, 2));
console.log(JSON.stringify({ output, variants: results.length, exactPublicAssetChecks: results.length * files.length * 2 }));
