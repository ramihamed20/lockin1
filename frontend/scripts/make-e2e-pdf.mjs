/**
 * Generate the PDFs the reader end-to-end tests read.
 *
 * The reader specs need a real PDF -- pdf.js parses it, the continuous reader
 * lays it out, and the assertions are about page geometry -- but they must not
 * need study material to do it. The three Biochemistry sheets that used to
 * serve this purpose were deleted because nginx served them from
 * `public/assets/` outside Django, and therefore outside authentication, the
 * subscription gate and `can_access_managed_file`.
 *
 * These files replace them for tests only. They live under `e2e/fixtures/`,
 * never under `public/`, so no build can sweep them into `dist/`. Their content
 * is a page number and a label saying what they are.
 *
 * Page counts match what the specs assert (41 / 17 / 33) so the existing
 * expectations keep testing the reader rather than being rewritten around a new
 * fixture. A4 at 595x842, which is what the continuous reader's layout maths
 * assumes.
 *
 * Regenerate with: npm run fixtures:pdf
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = resolve(fileURLToPath(new URL("../e2e/fixtures/pdf/", import.meta.url)));

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** Files the E2E catalogue injects. Keep in sync with e2e/fixtures/catalog.js. */
const FIXTURES = [
  { name: "sheet-41.pdf", pages: 41 },
  { name: "sheet-17.pdf", pages: 17 },
  { name: "sheet-33.pdf", pages: 33 },
  // Large on purpose. pdf.js only switches to ranged reads once a document is
  // meaningfully bigger than its 64 KiB range chunk; below that it fetches the
  // whole file in one GET. e2e/pdf-range-requests.spec.js measures the request
  // burst the edge rate limit has to absorb, and it can only measure a burst
  // against a document that produces one.
  { name: "sheet-range.pdf", pages: 24, padBytesPerPage: 90_000 }
];

function escapeText(value) {
  return value.replace(/[\\()]/g, (character) => `\\${character}`);
}

function contentStream(pageNumber, pageCount, padBytesPerPage = 0) {
  const lines = [
    { size: 34, y: PAGE_HEIGHT - 120, text: `Page ${pageNumber}` },
    { size: 16, y: PAGE_HEIGHT - 170, text: `Lock-in reader test fixture (${pageCount} pages)` },
    { size: 12, y: PAGE_HEIGHT - 200, text: "Not study material. Generated for automated tests." },
    // A marker low on the page so a test can tell top from bottom when it
    // scrolls, without depending on any real document's content.
    { size: 12, y: 90, text: `end of page ${pageNumber}` }
  ];
  const body = lines
    .map(({ size, y, text }) => `BT /F1 ${size} Tf 60 ${y} Td (${escapeText(text)}) Tj ET`)
    .join("\n");
  // A hairline border gives the rasteriser non-blank pixels on every page.
  const border = `0.6 w 20 20 ${PAGE_WIDTH - 40} ${PAGE_HEIGHT - 40} re S`;
  // Padding as PDF comments: ignored by every parser, but real bytes on the
  // wire. pdf.js only switches to ranged reads once a document is meaningfully
  // larger than its 64 KiB range chunk, and below that it fetches the whole
  // file in a single GET -- so a fixture that is supposed to produce a request
  // burst has to actually be big.
  const paddingLine = `% pad ${"0123456789".repeat(6)}`;
  const padding = padBytesPerPage
    ? `\n${`${paddingLine}\n`.repeat(Math.ceil(padBytesPerPage / (paddingLine.length + 1)))}`
    : "";
  return `${border}\n${body}\n${padding}`;
}

function buildPdf(pageCount, padBytesPerPage = 0) {
  // Object 1 catalog, 2 page tree, 3 font, then per page: page object + stream.
  const objects = [];
  const pageObjectNumbers = [];
  for (let index = 0; index < pageCount; index += 1) {
    pageObjectNumbers.push(4 + index * 2);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] =
    `<< /Type /Pages /Count ${pageCount} ` +
    `/Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  for (let index = 0; index < pageCount; index += 1) {
    const pageNumber = pageObjectNumbers[index];
    const streamNumber = pageNumber + 1;
    const stream = contentStream(index + 1, pageCount, padBytesPerPage);
    objects[pageNumber] =
      "<< /Type /Page /Parent 2 0 R " +
      `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      "/Resources << /Font << /F1 3 0 R >> >> " +
      `/Contents ${streamNumber} 0 R >>`;
    objects[streamNumber] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`;
  }

  const highest = objects.length - 1;
  const chunks = ["%PDF-1.4\n", "%âãÏÓ\n"];
  let offset = Buffer.byteLength(chunks.join(""), "latin1");
  const offsets = [];

  for (let number = 1; number <= highest; number += 1) {
    const body = objects[number];
    if (body === undefined) throw new Error(`Object ${number} is missing.`);
    offsets[number] = offset;
    const serialized = `${number} 0 obj\n${body}\nendobj\n`;
    chunks.push(serialized);
    offset += Buffer.byteLength(serialized, "latin1");
  }

  const xrefOffset = offset;
  const xref = [`xref\n0 ${highest + 1}\n`, "0000000000 65535 f \n"];
  for (let number = 1; number <= highest; number += 1) {
    xref.push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(xref.join(""));
  chunks.push(
    `trailer\n<< /Size ${highest + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return Buffer.from(chunks.join(""), "latin1");
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const { name, pages, padBytesPerPage = 0 } of FIXTURES) {
  const target = resolve(OUTPUT_DIR, name);
  mkdirSync(dirname(target), { recursive: true });
  const pdf = buildPdf(pages, padBytesPerPage);
  writeFileSync(target, pdf);
  console.log(`${name}: ${pages} pages, ${pdf.length} bytes`);
}
