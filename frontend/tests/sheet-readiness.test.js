import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readinessSummary, sheetReadiness } from "../src/lib/sheetReadiness.js";

const pdf = { file_id: "f", original_name: "sheet.pdf" };
const readySheet = { workflow_status: "published", student_visible: true, pdf, question_count: 20, published_question_count: 20, summary_pdf: null };

test("a published sheet with a PDF and live questions is ready", () => {
  assert.deepEqual(sheetReadiness(readySheet), { state: "ready", label: "Ready", issues: [] });
});

test("a missing PDF blocks the sheet and says what to upload", () => {
  const result = sheetReadiness({ ...readySheet, workflow_status: "draft", pdf: null });
  assert.equal(result.state, "blocked");
  assert.equal(result.label, "Missing PDF");
  assert.match(result.issues[0].detail, /Upload the University Sheet PDF/);
});

test("published but unreachable is a blocker, not a success", () => {
  const result = sheetReadiness({ ...readySheet, student_visible: false });
  assert.equal(result.state, "blocked");
  assert.ok(result.issues.some((issue) => issue.code === "unreachable"));
});

test("question states are reported as the next action", () => {
  assert.equal(sheetReadiness({ ...readySheet, question_count: 0, published_question_count: 0 }).issues[0].label, "Needs questions");
  const drafts = sheetReadiness({ ...readySheet, question_count: 12, published_question_count: 0 });
  assert.equal(drafts.state, "attention");
  assert.match(drafts.issues[0].detail, /12 questions are saved as drafts/);
  const partial = sheetReadiness({ ...readySheet, question_count: 12, published_question_count: 10 });
  assert.equal(partial.state, "ready", "a partly published bank is information, not a problem");
  assert.equal(partial.issues[0].label, "10 of 12 questions live");
});

test("summary PDF problems are named", () => {
  assert.equal(sheetReadiness({ ...readySheet, summary_pdf: { deliverable: false } }).issues[0].code, "summary-scanning");
  assert.equal(sheetReadiness({ ...readySheet, summary_pdf: { deliverable: true, student_visible: false } }).issues[0].code, "summary-draft");
});

test("drafts and archived sheets are not reported as ready", () => {
  assert.equal(sheetReadiness({ ...readySheet, workflow_status: "draft" }).state, "draft");
  assert.equal(sheetReadiness({ ...readySheet, workflow_status: "archived" }).label, "Archived");
});

test("the list summary counts each state", () => {
  assert.deepEqual(
    readinessSummary([readySheet, { ...readySheet, pdf: null }, { ...readySheet, workflow_status: "draft" }, { ...readySheet, question_count: 0 }]),
    { ready: 1, attention: 1, blocked: 1, draft: 1 }
  );
});

test("the admin sheet list renders readiness from this module", async () => {
  const source = await readFile(new URL("../src/pages/AdminContentManagement.jsx", import.meta.url), "utf8");
  assert.match(source, /import \{ readinessSummary, sheetReadiness \} from "\.\.\/lib\/sheetReadiness\.js";/);
  assert.match(source, /<SheetReadiness readiness=\{readiness\} \/>/);
});
