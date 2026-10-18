import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/** Refuse stale-server measurements; inspect only a bounded local public index. */
export async function verifyPerformanceBuild(baseURL, artifactRoot) {
  const origin = new URL(baseURL);
  if (!["http:", "https:"].includes(origin.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) || origin.username || origin.password) throw new Error("Explicit local public build required");
  const expected = createHash("sha256").update(await readFile(resolve(artifactRoot, "index.html"))).digest("hex");
  const response = await fetch(new URL("/index.html", origin), { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.body) throw new Error("Local public index is unavailable");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error("Unexpectedly large public index");
    chunks.push(chunk);
  }
  const actual = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
  if (actual !== expected) throw new Error(`Measured server build differs from artifact: ${actual} != ${expected}`);
  return expected;
}
