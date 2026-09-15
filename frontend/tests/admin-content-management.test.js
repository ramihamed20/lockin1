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
  assert.match(page, /Replace \$\{editionLabel\} PDF/);
  assert.match(page, /Archive selected/);
  assert.match(page, /Move to/);
  assert.match(page, /Delete permanently/);
  assert.match(page, /summary_file_id: summaryManaged\?\.id \|\| null/);
  assert.match(page, /Choose Sheet Summary PDF/);
  assert.match(page, /replaceSheetSummaryPdf/);
  assert.match(page, /removeSheetSummaryPdf/);
  assert.match(page, /Normal Mode only/);
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

test("Active Study JSON management validates, previews, replaces, and deletes one difficulty", () => {
  assert.match(api, /activeStudyQuestions/);
  assert.match(api, /validateActiveStudyQuestions/);
  assert.match(api, /saveActiveStudyQuestions/);
  assert.match(api, /deleteActiveStudyQuestions/);
  assert.match(api, /active-study\/questions\//);
  assert.match(page, /Import JSON/);
  assert.match(page, /Edit \/ Replace JSON/);
  assert.match(page, /Delete content/);
  assert.match(page, /JSON needs correction/);
  assert.match(page, /ActiveStudyQuestionPreview/);
  assert.match(page, /Needs Review/);
  assert.match(page, /Validate the current JSON before saving/);
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

test("sheet page-count fields stay editable while typing", () => {
  const activeStudy = page.slice(page.indexOf("function ExclusionField"));
  // The total page count must never be readOnly/disabled: admins type and clear it.
  assert.doesNotMatch(activeStudy, /readOnly=\{Boolean\(sheet\.pdf\?\.page_count\)\}/);
  assert.match(activeStudy, /<span>Total PDF pages<\/span><input type="number" inputMode="numeric"/);
  assert.match(activeStudy, /value=\{form\.total_pdf_pages\} onChange=\{\(event\) => change\("total_pdf_pages", event\.target\.value\)\}/);
  // Custom exclusion mode is held in state, so clearing the box cannot unmount it.
  assert.match(activeStudy, /const \[custom, setCustom\] = useState/);
  assert.match(activeStudy, /\{custom && <input type="number" inputMode="numeric"/);
  assert.doesNotMatch(activeStudy, /preset === "custom" &&/);
});

test("Active Study previews through the backend planner and blames the exact invalid field", () => {
  assert.match(api, /previewActiveStudyPlan/);
  assert.match(api, /active-study\/preview/);
  // Preview drives what the cards render, so parts and ranges match what Save stores.
  assert.match(page, /adminControlApi\.previewActiveStudyPlan/);
  assert.match(page, /planned\.difficulties\.find/);
  assert.match(page, /Previewing unsaved boundaries/);
  // Field-scoped errors from the envelope land on their own input.
  assert.match(page, /function fieldErrorMap/);
  assert.match(page, /<FieldError errors=\{errors\} field="total_pdf_pages"/);
  assert.match(page, /error=\{errors\.excluded_start_pages\}/);
  assert.match(page, /error=\{errors\.excluded_end_pages\}/);
});

test("a blank Active Study field never overwrites saved boundaries", () => {
  assert.match(page, /function activeStudyBoundaryBody/);
  assert.match(page, /if \(raw !== "" && Number\.isFinite\(Number\(raw\)\)\) body\[key\] = Number\(raw\)/);
  assert.match(page, /total_pdf_pages: data\.data\.total_pdf_pages \?\? ""/);
  assert.doesNotMatch(page, /total_pdf_pages: form\.total_pdf_pages === "" \? null/);
});

test("the prompt-template warning only fires when a real plan has no template", () => {
  assert.match(page, /difficulty\.plan_available === false && <p className="form-alert error">Active Study parts cannot be calculated yet/);
  assert.match(page, /difficulty\.plan_available !== false && !difficulty\.prompt_template_supported/);
  assert.match(page, /A matching prompt template is not configured yet/);
});

test("Admin manages both sheet editions through one interface", () => {
  assert.match(page, /const EDITIONS = \[/);
  assert.match(page, /function EditionTabs\(/);
  assert.match(page, /University Sheet/);
  assert.match(page, /Lockin Sheet/);
  // The same Active Study panel, PDF and summary controls serve either edition.
  assert.match(page, /<ActiveStudySettings key=\{edition\} sheet=\{sheet\} edition=\{edition\}/);
  assert.match(page, /adminControlApi\.replaceSheetLockinPdf/);
  assert.match(page, /adminControlApi\.removeSheetLockinPdf/);
  assert.match(page, /replaceSheetSummaryPdf\(sheet\.id, \{ expected_revision: sheet\.revision, summary_file_id: managed\.id \}, edition\)/);
  assert.match(api, /lockin-pdf/);
  assert.match(api, /activeStudySettings\(sheetId, edition = ""\)/);
  // One question bank: it is imported on the University Sheet tab only.
  assert.match(page, /Questions are shared with the University Sheet/);
  assert.match(page, /sharedBank=\{Boolean\(plan\.parts_follow_university\)\}/);
});
