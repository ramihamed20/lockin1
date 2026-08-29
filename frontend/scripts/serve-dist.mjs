import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

function publicFile(requestPath) {
  const clean = normalize(requestPath.replace(/^[/\\]+/, ""));
  const candidate = resolve(root, clean);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : root;
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", `http://${host}`).pathname);
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
      process.exitCode = 1;
    }
  });
  server.closeAllConnections?.();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
