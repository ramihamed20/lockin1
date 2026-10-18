import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { ID, mockAdmin } from "./helpers/mock-admin-workspace.js";

test.use({ serviceWorkers: "block" });

const SUBJECT = { id: ID, title: "All Questions test subject", college_key: "university-faculty", college_title: "جامعة الاختبار — كلية طب الأسنان", specialty_key: "dentistry", specialty_title: "Dentistry", academic_year_key: "year-two", academic_year_title: "Year 2", sheet_count: 1, published_count: 1, draft_count: 0 };
const SHEET = { id: ID, title: "All Questions test sheet", revision: 1, position: 0, workflow_status: "published", student_visible: true, question_count: 0, active_study_enabled: true, pdf: { page_count: 4 }, editions: [{ edition: "university", available: true, page_count: 4 }, { edition: "lockin", available: true, page_count: 4 }] };

function context(start = 1) {
  const pages = Array.from({ length: 3 - start }, (_, index) => start + index + 1);
  return {
    edition: "university", edition_label: "University Sheet", settings_revision: 1,
    active_study_enabled: true, total_pdf_pages: 4, eligible_study_pages: pages.length,
    effective_start_page: start + 1, effective_end_page: 3,
    excluded_start_pages: start, excluded_end_pages: 1,
    saved_excluded_start_pages: 1, saved_excluded_end_pages: 1, exclusions_changed: start !== 1,
    difficulties: ["easy", "medium", "hard"].map((difficulty) => ({
      difficulty, label: difficulty[0].toUpperCase() + difficulty.slice(1),
      question_format: "pages", questions_per_page: 20, page_numbers: pages,
      number_of_parts: 1, page_ranges: [{ part: 1, start_page: start + 1, end_page: 3 }],
      questions_per_checkpoint: 15, final_exam_questions: 2, prompt_template_supported: true,
      existing: { revision: 0, checkpoint_question_count: 0, final_exam_question_count: 0 }
    })), sheet_questions: { existing_count: 0, all_questions_count: 0, max_count: 200 }
  };
}

function question(tag, index) {
  return index === 1 ? { type: "true_false", question: `Statement ${tag}`, correct_answer: false, explanation: `Reason ${tag}` }
    : { question: `Question ${tag}`, options: { A: "First", B: "Second", C: "Third", D: "Fourth" }, correct_answer: "C", explanation: `Reason ${tag}` };
}

function document() {
  return {
    active_study: Object.fromEntries(context().difficulties.map((row) => [row.difficulty, {
      pages: row.page_numbers.map((page) => ({ page, questions: Array.from({ length: 20 }, (_, i) => question(`${row.difficulty}-${page}-${i}`, i)) })),
      final_exam: { questions: Array.from({ length: 2 }, (_, i) => question(`${row.difficulty}-final-${i}`, i)) }
    }])), sheet_questions: { questions: [question("normal-0", 0), question("normal-1", 1)] }
  };
}

function validation() {
  return { valid: true, errors: [], error_count: 0, summary: {
    difficulties: context().difficulties.map((row) => ({ ...row, ok: true,
      parts: row.page_numbers.map((page) => ({ part: page, start_page: page, end_page: page, expected: 20, received: 20, ok: true })),
      part_questions_received: 40, final_exam: { expected: 2, received: 2, ok: true }
    })), sheet_questions: { expected: 2, received: 2, ok: true }, total_expected: 128, total_received: 128
  } };
}

async function openAllQuestions(page, locale = "en") {
  const requests = [];
  await mockAdmin(page, { locale });
  await page.route("**/operations/admin/content/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body = { count: 0, results: [] };
    if (url.pathname.endsWith("/subjects")) body = { count: 1, results: [SUBJECT] };
    else if (url.pathname.endsWith("/sheets")) body = { subject: SUBJECT, count: 1, results: [SHEET] };
    else if (url.pathname.endsWith("/all-questions/validate") || (url.pathname.endsWith("/all-questions") && request.method() === "PUT")) {
      requests.push({ method: request.method(), body: request.postDataJSON() });
      body = validation();
    } else if (url.pathname.endsWith("/all-questions")) body = context(Number(url.searchParams.get("excluded_start_pages") || 1));
    else if (url.pathname.includes("active-study")) body = { ...context(), enabled: true };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/#/operations/admin/content");
  await page.getByRole("combobox", { name: "College", exact: true }).selectOption(SUBJECT.college_key);
  await page.getByRole("combobox", { name: "Specialty", exact: true }).selectOption(SUBJECT.specialty_key);
  await page.getByRole("combobox", { name: "Year / batch", exact: true }).selectOption(SUBJECT.academic_year_key);
  await page.getByRole("button", { name: new RegExp(SUBJECT.title) }).click();
  await page.locator(".admin-sheet-row summary").click();
  await page.getByRole("tab", { name: "All Questions", exact: true }).click();
  const panel = page.locator(".admin-all-questions");
  await expect(panel.getByRole("button", { name: "Validate", exact: true })).toBeEnabled();
  await panel.getByRole("spinbutton", { name: "Number of Questions", exact: true }).fill("2");
  return { panel, requests };
}

test("desktop: one prompt, one file, preview and one explicit save", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { panel, requests } = await openAllQuestions(page);
  await panel.getByText("Exam style (optional)", { exact: true }).click();
  await panel.locator(".admin-all-questions-style textarea").fill("Use concise clinical vignettes.");
  await panel.getByRole("button", { name: "Show prompt", exact: true }).click();
  const prompt = await panel.getByRole("textbox", { name: "All Questions prompt", exact: true }).inputValue();
  expect(prompt).toContain("Use concise clinical vignettes.");
  expect(prompt).toContain('"pages":');
  expect(prompt).not.toContain('"parts":');
  const downloaded = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download the same prompt (.txt)", exact: true }).click();
  const download = await downloaded;
  const promptPath = testInfo.outputPath("single-prompt.txt");
  await download.saveAs(promptPath);
  expect(await readFile(promptPath, "utf8")).toBe(prompt);
  await panel.getByRole("button", { name: "Hide prompt", exact: true }).click();

  const payload = document();
  await panel.locator('input[type="file"]').setInputFiles({ name: "all-banks.json", mimeType: "application/json", buffer: Buffer.from("\uFEFF" + JSON.stringify(payload)) });
  await expect(panel.getByRole("textbox", { name: "Paste All Questions JSON", exact: true })).toHaveValue(JSON.stringify(payload));
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).toBeEnabled();
  expect(requests).toEqual([{ method: "POST", body: { payload, sheet_question_count: 2, excluded_start_pages: 1, excluded_end_pages: 1 } }]);

  await panel.getByText("Preview questions", { exact: true }).click();
  const preview = panel.locator(".admin-all-questions-preview");
  await expect(preview.locator("article")).toContainText("Question easy-2-0");
  await preview.getByRole("spinbutton", { name: "Question number", exact: true }).fill("2");
  await expect(preview.locator("article")).toContainText("Correct answer: False");
  await preview.getByRole("combobox", { name: "Question set", exact: true }).selectOption("hard-final");
  await expect(preview.locator("article")).toContainText("Question hard-final-0");
  await preview.getByRole("combobox", { name: "Question set", exact: true }).selectOption("normal");
  await expect(preview.locator("article")).toContainText("Question normal-0");
  await expect(preview.locator("article")).toHaveCount(1);
  await panel.screenshot({ path: testInfo.outputPath("all-questions-desktop.png") });

  await panel.getByRole("button", { name: "Save All Questions", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("All Questions saved: 128");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual({ method: "PUT", body: {
    payload, sheet_question_count: 2, excluded_start_pages: 1, excluded_end_pages: 1,
    settings_revision: 1, expected_revisions: { easy: 0, medium: 0, hard: 0 }, publish_sheet_questions: true
  } });
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).toHaveCount(0);
});

test("Arabic phone: upload, review controls and stale validation fit RTL", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { panel, requests } = await openAllQuestions(page, "ar");
  await expect(panel.getByRole("list", { name: "إضافة جميع الأسئلة" })).toBeVisible();
  await panel.locator('input[type="file"]').setInputFiles({ name: "bank.txt", mimeType: "text/plain", buffer: Buffer.from(JSON.stringify(document())) });
  await panel.getByRole("button", { name: "Validate", exact: true }).click();
  await panel.getByText("معاينة الأسئلة", { exact: true }).click();
  await panel.getByRole("combobox", { name: "مجموعة الأسئلة", exact: true }).selectOption("medium-page-3");
  await expect(panel.locator("article")).toContainText("Question medium-3-0");
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(await panel.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  for (const control of [panel.locator('input[type="file"]'), panel.getByRole("combobox", { name: "مجموعة الأسئلة", exact: true })]) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await panel.screenshot({ path: testInfo.outputPath("all-questions-arabic-phone.png") });
  // Editing after validation removes the save action immediately.
  await panel.getByRole("textbox", { name: "Paste All Questions JSON", exact: true }).fill(JSON.stringify(document()) + " ");
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).toBeEnabled();
  await panel.getByRole("combobox", { name: "First pages to exclude", exact: true }).selectOption("2");
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).not.toBeEnabled();
  expect(requests.every((request) => request.method === "POST")).toBe(true);
  expect(errors).toEqual([]);
});

test("invalid upload preserves pasted text and does not call validation or save", async ({ page }) => {
  const { panel, requests } = await openAllQuestions(page);
  const input = panel.getByRole("textbox", { name: "Paste All Questions JSON", exact: true });
  await input.fill(JSON.stringify(document()));
  await panel.locator('input[type="file"]').setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{truncated") });
  await expect(panel.getByRole("alert")).toContainText("Invalid JSON syntax");
  await expect(input).toHaveValue(JSON.stringify(document()));
  await expect(panel.getByRole("button", { name: "Save All Questions", exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
});
