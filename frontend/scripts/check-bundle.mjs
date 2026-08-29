import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const assets = new URL("assets/", dist);
const assetDirectory = fileURLToPath(assets);
const names = await readdir(assetDirectory);
const initialAssets = names.filter((name) => /^(index-.*\.(?:js|css))$/.test(name));

if (!initialAssets.length) {
  throw new Error("No hashed entry assets were found in dist/assets.");
}

const limits = { ".js": 350 * 1024, ".css": 100 * 1024 };
for (const name of initialAssets) {
  const bytes = await readFile(join(assetDirectory, name));
  const type = name.endsWith(".js") ? ".js" : ".css";
  const compressed = gzipSync(bytes).byteLength;
  if (compressed > limits[type]) {
    throw new Error(`${name} is ${(compressed / 1024).toFixed(1)} KiB gzip; limit is ${limits[type] / 1024} KiB.`);
  }
  console.log(`${name}: ${(compressed / 1024).toFixed(1)} KiB gzip`);
}
