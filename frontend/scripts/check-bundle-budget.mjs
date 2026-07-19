import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../dist/", import.meta.url);
const limits = {
  initialJavaScriptGzip: 180 * 1024,
  lazyJavaScriptGzip: 200 * 1024,
  pdfWorkerGzip: 500 * 1024,
  cssGzip: 80 * 1024
};

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else files.push(path);
  }
  return files;
}

const distPath = root.pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const files = await filesIn(distPath);
const measurements = [];
for (const file of files.filter((path) => /\.(?:m?js|css)$/.test(path))) {
  const bytes = await readFile(file);
  measurements.push({
    file: relative(distPath, file).replaceAll("\\", "/"),
    raw: bytes.length,
    gzip: gzipSync(bytes).length
  });
}

const initialJavaScript = measurements
  .filter(({ file }) => /^assets\/index-[^/]+\.js$/.test(file))
  .reduce((total, item) => total + item.gzip, 0);
const lazyJavaScript = Math.max(
  0,
  ...measurements
    .filter(
      ({ file }) =>
        /\.m?js$/.test(file) && !file.includes("pdf.worker") && !file.includes("index-")
    )
    .map(({ gzip }) => gzip)
);
const pdfWorker = Math.max(
  0,
  ...measurements.filter(({ file }) => file.includes("pdf.worker")).map(({ gzip }) => gzip)
);
const css = measurements
  .filter(({ file }) => file.endsWith(".css"))
  .reduce((total, item) => total + item.gzip, 0);

const summary = { initialJavaScript, lazyJavaScript, pdfWorker, css, limits, assets: measurements };
console.log(JSON.stringify(summary, null, 2));

const failures = [];
if (!initialJavaScript) failures.push("No production entry JavaScript asset was found.");
if (!pdfWorker) failures.push("No production PDF worker asset was found.");
if (initialJavaScript > limits.initialJavaScriptGzip) failures.push("Initial JavaScript exceeds budget.");
if (lazyJavaScript > limits.lazyJavaScriptGzip) failures.push("A lazy JavaScript chunk exceeds budget.");
if (pdfWorker > limits.pdfWorkerGzip) failures.push("The PDF worker exceeds budget.");
if (css > limits.cssGzip) failures.push("CSS exceeds budget.");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
