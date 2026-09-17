import { expect, test } from "@playwright/test";
import { studentSession } from "./fixtures/productionApi.js";

/**
 * A student answering the questions an administrator published.
 *
 * Questions used to be a dead end: the page listed subject names from a table
 * compiled into the client and every subject ended at "No questions yet",
 * because nothing ever asked the server for a sheet or a question. It now reads
 * the same catalog Materials does, so a sheet appears here under the title the
 * administrator gave it, with the questions saved against it.
 */

const SHEET_ID = "7c4a0f92-2a2f-4a2a-8f4f-4bb1f0b5a001";

const DIRECTORY = {
  count: 1,
  results: [
    {
      slug: "dentistry-tripoli-year-1-oral-histology",
      title: "Oral Histology",
      questionCount: 2,
      sheets: [
        {
          id: SHEET_ID,
          slug: SHEET_ID,
          number: 1,
          title: "Sheet 1 - Epithelium",
          questionCount: 2
        }
      ]
    }
  ]
};

const SHEET_QUESTIONS = {
  sheet: {
    id: SHEET_ID,
    title: "Sheet 1 - Epithelium",
    material_slug: "dentistry-tripoli-year-1-oral-histology",
    subject_title: "Oral Histology"
  },
  count: 2,
  results: [
    {
      id: "question-one",
      question_type: "single_choice",
      prompt: "Which layer contains melanocytes?",
      explanation: "Melanocytes reside in the basal layer.",
      topic: "Epidermis",
      difficulty: "easy",
      source_page: 7,
      choices: [
        { id: "one-a", text: "Basal", position: 0, is_correct: true },
        { id: "one-b", text: "Spinous", position: 1, is_correct: false },
        { id: "one-c", text: "Granular", position: 2, is_correct: false }
      ]
    },
    {
      id: "question-two",
      question_type: "true_false",
      prompt: "Keratinocytes are the main epidermal cell.",
      explanation: "They form most of the epidermis.",
      topic: "Epidermis",
      difficulty: "medium",
      source_page: null,
      choices: [
        { id: "two-a", text: "True", position: 0, is_correct: true },
        { id: "two-b", text: "False", position: 1, is_correct: false }
      ]
    }
  ]
};

async function mockStudent(page, { directory = DIRECTORY } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession() });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (pathname === "/api/v1/operations/session") {
      return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    }
    if (pathname === "/api/v1/subscriptions/current") {
      return json({
        subscription: {
          id: "questions-subscription",
          status: "active",
          access_allowed: true,
          current_period_ends_at: "2999-01-01T00:00:00Z"
        }
      });
    }
    if (pathname === "/api/v1/entitlements/me") return json({ results: [] });
    if (pathname === "/api/v1/catalog/questions") return json(directory);
    if (pathname === `/api/v1/catalog/sheets/${SHEET_ID}/questions`) return json(SHEET_QUESTIONS);
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
}

test("a published sheet is reachable from Questions and its questions can be answered", async ({
  page
}, testInfo) => {
  await mockStudent(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/#/questions");

  await page.getByRole("link", { name: /AI Sheet/ }).click();

  // The subject carries its live question count, so a student can see there is
  // something to answer before opening it.
  const subject = page.getByRole("link", { name: /Oral Histology/ });
  await expect(subject).toBeVisible();
  await expect(page.getByText("2 questions").first()).toBeVisible();
  await subject.click();

  // The sheet appears under the administrator's own title.
  const sheet = page.getByRole("link", { name: /Sheet 1 - Epithelium/ });
  await expect(sheet).toBeVisible();
  await sheet.click();

  await expect(page.getByRole("heading", { name: "Which layer contains melanocytes?" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Keratinocytes are the main epidermal cell." })
  ).toBeVisible();

  const first = page.locator(".question-card").first();
  // The answer is not given away before the student commits to one.
  await expect(first.getByText("Melanocytes reside in the basal layer.")).toHaveCount(0);
  await first.getByRole("button", { name: /Spinous/ }).click();
  await first.getByRole("button", { name: "Check answer" }).click();

  await expect(first.getByText("Not quite")).toBeVisible();
  await expect(first.getByText("Melanocytes reside in the basal layer.")).toBeVisible();

  await first.getByRole("button", { name: "Try again" }).click();
  await first.getByRole("button", { name: /Basal/ }).click();
  await first.getByRole("button", { name: "Check answer" }).click();
  await expect(first.getByText("Correct")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("questions-sheet-practice.png") });
});

test("a cohort with no published questions is told so, not shown an empty subject list", async ({
  page
}) => {
  await mockStudent(page, { directory: { count: 0, results: [] } });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/#/questions/categories/ai-sheet");

  await expect(page.getByText("No questions yet")).toBeVisible();
});
