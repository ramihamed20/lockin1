import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_AUTOMATION_PDF_BYTES,
  automationAgentInstructions,
  draftSheetPayload,
  sheetTitleFromFilename,
  validateAutomationFiles
} from "../src/lib/adminAutomation.js";

test("automation sheet names are derived safely and are bounded", () => {
  assert.equal(sheetTitleFromFilename("Cell_Injury.pdf"), "Cell Injury");
  assert.equal(sheetTitleFromFilename("Inflammation.PDF"), "Inflammation");
  assert.equal(sheetTitleFromFilename("  .pdf"), "Untitled sheet");
  assert.ok(sheetTitleFromFilename("a".repeat(500) + ".pdf").length <= 220);
});

test("bulk PDF validation enforces size, extension and maximum batch count", () => {
  const pdf = { name: "Inflammation.pdf", type: "application/pdf", size: 512 };
  assert.equal(validateAutomationFiles([pdf]).length, 1);
  assert.throws(() => validateAutomationFiles([]), /Choose at least one PDF/);
  assert.throws(() => validateAutomationFiles(Array.from({length: 21}, () => pdf)), /at most 20/);
  assert.throws(() => validateAutomationFiles([{ ...pdf, name: "payload.exe" }]), /not a PDF/);
  assert.throws(() => validateAutomationFiles([{ ...pdf, size: MAX_AUTOMATION_PDF_BYTES + 1 }]), /50 MB/);
});

test("AI-sourced sheets can only be created as unpublished, non-notifying drafts", () => {
  const payload = draftSheetPayload({ filename: "Pharma.pdf", fileId: "verified-file-id" });
  assert.equal(payload.title, "Pharma");
  assert.equal(payload.primary_file_id, "verified-file-id");
  assert.equal(payload.publish, false);
  assert.equal(payload.notify_students, false);
  assert.equal(payload.allow_download, false);
  assert.equal(payload.reject_duplicate_pdf, true);
});

test("the exported agent instructions require a real PDF and treat references as untrusted", () => {
  const result = automationAgentInstructions({ prompt: "EXACT ALL QUESTIONS CONTRACT", sheetTitle: "Dental", sheetId: "id1", referenceNotes: "Past exams" });
  assert.match(result, /Read the PDF sheet supplied by the operator/);
  assert.match(result, /untrusted content/);
  assert.match(result, /EXACT ALL QUESTIONS CONTRACT/);
  assert.match(result, /Past exams/);
  assert.doesNotMatch(result, /auto[- ]?execute|skip permissions/i);
});

test("Admin 2.0 reuses real server imports, capability checks and a separate operator-driven AI handoff", async () => {
  const [hub, areas, routes, operations, actionBar] = await Promise.all([
    readFile(new URL("../src/pages/admin/AdminAutomationHub.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/studioAreas.js", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/authz.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/OperationsAdmin.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin/Admin2ActionBar.jsx", import.meta.url), "utf8")
  ]);
  assert.match(hub, /managementApi\.uploadFile/);
  assert.match(hub, /adminControlApi\.createSheet/);
  assert.match(hub, /adminControlApi\.allQuestionsContext/);
  assert.match(hub, /adminControlApi\.validateAllQuestions/);
  assert.match(hub, /adminControlApi\.saveAllQuestions/);
  assert.match(hub, /publish_sheet_questions: false/);
  assert.match(hub, /draft_sheet_revision: ctx\.sheet_revision/);
  assert.match(hub, /context\.sheet_revision !== task\.sheet_revision/);
  assert.match(hub, /<AllQuestionsPreview payload=\{item\.payload\}/);
  assert.match(hub, /existingQuestionSets/);
  assert.match(hub, /content\.manage/);
  assert.match(hub, /assessments\.manage/);
  assert.match(hub, /This application does not invoke agy/);
  assert.match(areas, /\["automation", "Automation", "content\.view"/);
  assert.match(routes, /path: "\/operations\/admin\/automation", capability: "content\.view"/);
  assert.match(operations, /AdminAutomationHub/);
  assert.match(operations, /Admin2ActionBar/);
  assert.match(actionBar, /hasOperationalCapability/);
});
