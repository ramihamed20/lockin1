import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("the catalog reader bundles one matching maintained PDF.js runtime and worker", async () => {
  const [packageJson, adapter, reader] = await Promise.all([
    readFile(projectFile("package.json"), "utf8").then(JSON.parse),
    readFile(projectFile("src/workspace/catalog/pdfJsAdapter.js"), "utf8"),
    readFile(projectFile("src/workspace/catalog/ContinuousA4Pdf.jsx"), "utf8")
  ]);

  assert.equal(packageJson.dependencies["pdfjs-dist"], "6.3.289");
  assert.match(adapter, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
  assert.match(adapter, /pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url/);
  assert.match(reader, /import \{ loadPdfLibrary \} from "\.\/pdfJsAdapter\.js"/);
  assert.doesNotMatch(reader, /window\.pdfjsLib|\/pdf\.min\.js|\/pdf\.worker\.min\.js/);
});

test("obsolete public PDF.js assets are absent and Welcome assets remain present", async () => {
  await assert.rejects(access(projectFile("public/pdf.min.js")));
  await assert.rejects(access(projectFile("public/pdf.worker.min.js")));
  await Promise.all([
    access(projectFile("public/icons/lockin-light-192-v2.png")),
    access(projectFile("public/assets/mascot-study-640.webp"))
  ]);
});
