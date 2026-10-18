import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const routes = JSON.parse(readFileSync(new URL("../public/public-search-routes.json", import.meta.url), "utf8"));

test("Vite dev serves every published page as public HTML instead of booting account login", { timeout: 60000 }, async () => {
  // Use the actual project config; the production test server previously hid
  // the missing directory-route handling in Vite's development server.
  const cacheDir = mkdtempSync(join(tmpdir(), "lockin-public-knowledge-"));
  const server = await createServer({ root, cacheDir, mode: "development", optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, preTransformRequests: false } });
  await server.listen();
  const origin = "http://127.0.0.1:" + server.httpServer.address().port;
  // Keep this real HTTP fixture independent of other Vite instances and idle
  // pooled connections. A deadline fails stalled requests; there are no retries.
  const request = (path, options = {}) => fetch(origin + path, { signal: AbortSignal.timeout(15000), ...options, headers: { Connection: "close", ...options.headers } });
  try {
    for (const path of routes) {
      const response = await request(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.match(response.headers.get("x-robots-tag"), /index, follow/);
      assert.equal(await response.text(), readFileSync(new URL("../public" + path + "index.html", import.meta.url), "utf8"), path);
    }
    for (const path of ["/about", "/help/start-active-study/index.html"]) {
      const response = await request(path, { redirect: "manual" });
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("location"), path === "/about" ? "/about/" : "/help/start-active-study/");
    }
    const head = await request("/help/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const query = await request("/about/?source=settings");
    assert.match(await query.text(), /<h1[^>]*>دراستك\. بتناغم\./);
    for (const path of ["/", "/settings", "/help/reset-password/", "/about/private/"]) {
      const response = await request(path);
      const html = await response.text();
      assert.match(html, /id="root"/);
      assert.match(html, /name="robots" content="noindex/);
    }
    for (const path of ["/public-search.css", "/public-search-tokens.css"]) {
      const response = await request(path);
      assert.match(response.headers.get("content-type"), /text\/css/);
      await response.arrayBuffer();
    }
  } finally {
    server.httpServer.closeAllConnections();
    await server.close();
    if (!resolve(cacheDir).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected test cache directory");
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
