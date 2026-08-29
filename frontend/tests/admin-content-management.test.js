import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/pages/AdminContentManagement.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../src/api/adminControl.js", import.meta.url), "utf8");
const operations = await readFile(new URL("../src/pages/OperationsAdmin.jsx", import.meta.url), "utf8");
const attempt = await readFile(new URL("../src/pages/Attempt.jsx", import.meta.url), "utf8");
const review = await readFile(new URL("../src/pages/Review.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("operations admin exposes capability-gated content management", () => {
  assert.match(operations, /AdminContentManagement/);
  assert.match(operations, /content\.view/);
  assert.match(page, /hasOperationalCapability/);
  assert.match(page, /content\.manage/);
  assert.match(page, /assessments\.manage/);
});

test("sheet and question administration use real Django endpoints", () => {
  for (const route of [
    "/operations/admin/content/subjects",
    "/operations/admin/content/sheets/",
    "/operations/admin/content/questions/bulk",
    "/operations/admin/content/imports"
  ]) assert.match(api, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(page, /Replace PDF/);
  assert.match(page, /Archive selected/);
  assert.match(page, /Move to/);
  assert.match(page, /Delete permanently/);
});

test("strict JSON import includes presets, validation, preview, and safe undo", () => {
  assert.match(page, /lockin_questions_v1/);
  assert.match(page, /Quick Quiz/);
  assert.match(page, /Standard Sheet/);
  assert.match(page, /Exam Style/);
  assert.match(page, /Multiple Select/);
  assert.match(page, /Validate JSON/);
  assert.match(page, /Preview changed — validate again/);
  assert.match(page, /Undo import/);
});

test("multiple-select answers work in attempts and review", () => {
  assert.match(attempt, /question\.question_type === "multiple_select"/);
  assert.match(attempt, /previousIds\.filter/);
  assert.match(review, /item\.answer_mode === "multiple"/);
  assert.match(review, /type=\{multiple \? "checkbox" : "radio"\}/);
});

test("source page remains admin-only and Show Source is not introduced", () => {
  assert.match(page, /source_page/);
  assert.doesNotMatch(attempt, /source_page|Show Source/i);
  assert.doesNotMatch(review, /source_page|Show Source/i);
});

test("content management has tablet, phone, and reduced-motion styling", () => {
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*admin-content-header/);
  assert.match(styles, /@media \(max-width: 639px\)[\s\S]*admin-content-toolbar/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*admin-sheet-row/);
  assert.match(styles, /padding-inline-start/);
  assert.match(styles, /admin-subject-list > button[\s\S]*background: transparent/);
});
