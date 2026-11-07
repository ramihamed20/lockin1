import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = { root, logLevel: 'silent', optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 0 } };

test('live staging opts into secure HMR and saved CSS emits a websocket update', async () => {
  delete process.env.LOCKIN_STAGING_HMR;
  const normal = await createServer(options);
  assert.equal(normal.config.server.hmr, false);
  await normal.close();
  process.env.LOCKIN_STAGING_HMR = '1';
  const live = await createServer(options);
  assert.equal(live.config.server.hmr.protocol, 'wss');
  assert.equal(live.config.server.hmr.clientPort, 443);
  const name = `staging-hmr-test-${process.pid}.css`;
  const file = `${root}src/${name}`;
  let socket;
  try {
    await writeFile(file, 'body { --test-value: 1; }');
    await live.listen();
    const port = live.httpServer.address().port;
    const messages = [];
    socket = new globalThis.WebSocket(`ws://127.0.0.1:${port}/__hmr?token=${live.config.webSocketToken}`, 'vite-hmr');
    socket.addEventListener('message', e => messages.push(JSON.parse(e.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve);
      socket.addEventListener('error', reject);
    });
    const response = await fetch(`http://127.0.0.1:${port}/src/${name}`);
    assert.equal(response.status, 200);
    await response.text();
    await new Promise(resolve => setTimeout(resolve, 200));
    await writeFile(file, 'body { --test-value: 2; }');
    for (let i = 0; i < 50 && !messages.some(m => m.type === 'update'); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(messages.some(m => m.type === 'update' && m.updates.some(u => u.path.endsWith(name))));
  } finally {
    socket?.close();
    await live.close();
    await unlink(file).catch(() => {});
    delete process.env.LOCKIN_STAGING_HMR;
  }
});
