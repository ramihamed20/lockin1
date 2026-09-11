import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
// Reader fixtures live outside dist/ on purpose: nothing that serves the
// production bundle can reach them, and no build copies them in. Only this
// test server maps a URL onto them. See e2e/fixtures/catalog.js.
const fixtureRoot = resolve(fileURLToPath(new URL("../e2e/fixtures/pdf/", import.meta.url)));
const FIXTURE_PREFIX = "/e2e-fixtures/pdf/";
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function publicFile(requestPath) {
  const clean = normalize(requestPath.replace(/^[/\\]+/, ""));
  const candidate = resolve(root, clean);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : root;
}

function fixtureFile(pathname) {
  const name = normalize(pathname.slice(FIXTURE_PREFIX.length)).replace(/^[/\\]+/, "");
  const candidate = resolve(fixtureRoot, name);
  if (!candidate.startsWith(`${fixtureRoot}${sep}`) || extname(candidate) !== ".pdf") return null;
  return existsSync(candidate) ? candidate : null;
}

/**
 * Serve a fixture PDF, honouring Range.
 *
 * pdf.js opens a document with a HEAD-like probe and then a burst of ranged
 * reads, and only takes that path when the server advertises byte ranges. The
 * production edge streams private files with ranges, so the tests should
 * exercise the same shape rather than a single full-body GET.
 */
function serveFixture(request, response, file) {
  const total = statSync(file).size;
  const headers = {
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store"
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
  if (!match || (!match[1] && !match[2])) {
    response.writeHead(200, { ...headers, "Content-Length": String(total) });
    if (request.method === "HEAD") return response.end();
    return createReadStream(file).pipe(response);
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
  if (!Number.isFinite(start) || start >= total || start > end) {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${total}` });
    return response.end();
  }
  response.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": String(end - start + 1)
  });
  if (request.method === "HEAD") return response.end();
  return createReadStream(file, { start, end }).pipe(response);
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", `http://${host}`).pathname);

  if (pathname.startsWith(FIXTURE_PREFIX)) {
    const file = fixtureFile(pathname);
    if (!file) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return response.end("fixture not found");
    }
    return serveFixture(request, response, file);
  }

  const candidate = publicFile(pathname);
  const file = existsSync(candidate) && extname(candidate) ? candidate : resolve(root, "index.html");
  response.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(file).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving production files at http://${host}:${port}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close((error) => {
    if (error) {
      console.error("Could not stop the production-file test server", error);
      process.exit(1);
    }
    process.exit(0);
  });
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
