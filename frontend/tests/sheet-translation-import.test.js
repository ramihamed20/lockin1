import assert from "node:assert/strict";
import test from "node:test";
import { parseTranslationImport, translationTemplate, translationWriteBody } from "../src/lib/sheetTranslationImport.js";
const source = { sheet_id: "sheet-1", edition: "university", file_id: "pdf-1", checksum: "a".repeat(64), page_count: 3, pages: [{ page: 1, text: "old", revision: 4 }] };
const doc = { format: "lockin_translation_v1", edition: "university", pages: [{ page: 2, text: "الثانية كاملة" }, { page: 1, text: "الأولى كاملة", source_text: "Original" }] };

test("imports complete text with physical page numbers and optional original", () => {
  const pages = parseTranslationImport("\uFEFF" + JSON.stringify(doc), source);
  assert.deepEqual(pages.map((p) => p.page), [1, 2]); assert.equal(pages[0].text, "الأولى كاملة");
  assert.equal(pages[0].source_text, "Original"); assert.equal(pages[1].source_text, "");
});
test("rejects duplicate/out-of-range pages and invalid text before saving", () => {
  for (const pages of [[], [{ page: 0, text: "نص" }], [{ page: 4, text: "نص" }], [{ page: 1, text: "نص" }, { page: 1, text: "آخر" }], [{ page: "1", text: "نص" }], [{ page: 1, text: "" }], [{ page: 1, text: 42 }], [{ page: 1, text: "x".repeat(60001) }], [{ page: 1, text: "bad\0text" }]]) assert.throws(() => parseTranslationImport(JSON.stringify({ ...doc, pages }), source));
  assert.throws(() => parseTranslationImport("invalid", source), /invalidJson/);
  assert.throws(() => parseTranslationImport(JSON.stringify({ ...doc, format: "other" }), source), /invalidFormat/);
});
test("checks sheet, edition and exact PDF identity", () => {
  for (const overrides of [{ edition: "lockin" }, { sheet_id: "sheet-2" }, { file_id: "pdf-2" }, { checksum: "b".repeat(64) }]) assert.throws(() => parseTranslationImport(JSON.stringify({ ...doc, ...overrides }), source), /wrongSource/);
});
test("writes use the loaded source and current per-page revisions", () => {
  const body = translationWriteBody(source, parseTranslationImport(JSON.stringify(doc), source));
  assert.equal(body.file_id, source.file_id); assert.equal(body.checksum, source.checksum);
  assert.deepEqual(body.pages.map((p) => p.expected_revision), [4, 0]); assert.equal(source.pages.length, 1);
});
test("template covers every physical page and pins this edition", () => {
  const template = translationTemplate(source); assert.deepEqual(template.pages.map((p) => p.page), [1, 2, 3]);
  assert.equal(template.edition, "university"); assert.equal(template.file_id, "pdf-1");
  template.pages.forEach((p) => { p.text = `ترجمة كاملة ${p.page}`; });
  assert.equal(parseTranslationImport(JSON.stringify(template), source).length, 3);
});
