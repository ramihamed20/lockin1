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
      topic: "Epidermis",
      difficulty: "easy",
      xp_value: 5,
      source_page: 7,
      answer: null,
      choices: [
        { id: "one-a", text: "Basal", position: 0 },
        { id: "one-b", text: "Spinous", position: 1 },
        { id: "one-c", text: "Granular", position: 2 }
      ]
    },
    {
      id: "question-two",
      question_type: "true_false",
      prompt: "Keratinocytes are the main epidermal cell.",
      topic: "Epidermis",
      difficulty: "medium",
      xp_value: 10,
      source_page: null,
      answer: null,
      choices: [
        { id: "two-a", text: "True", position: 0 },
        { id: "two-b", text: "False", position: 1 }
      ]
    }
  ]
};

/** The server's grading, keyed by question: correct choice, explanation, XP. */
const GRADING = {
  "question-one": { correct: "one-a", explanation: "Melanocytes reside in the basal layer.", xp: 5 },
  "question-two": { correct: "two-a", explanation: "They form most of the epidermis.", xp: 10 }
};

async function mockStudent(page, { directory = DIRECTORY, submissions = [] } = {}) {
  const recorded = {};
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
    const answering = pathname.match(/^\/api\/v1\/catalog\/sheets\/[^/]+\/questions\/([^/]+)\/answer$/);
    if (answering && request.method() === "POST") {
      const questionId = answering[1];
      const { choice_ids: choiceIds } = request.postDataJSON();
      submissions.push({ questionId, choiceIds });
      const grading = GRADING[questionId];
      const created = !recorded[questionId];
      recorded[questionId] ||= {
        selected_choice_ids: choiceIds,
        correct_choice_ids: [grading.correct],
        is_correct: choiceIds.length === 1 && choiceIds[0] === grading.correct,
        explanation: grading.explanation,
        // XP is earned only by a correct answer.
        xp_awarded: choiceIds.length === 1 && choiceIds[0] === grading.correct ? grading.xp : 0,
        answered_at: "2026-09-18T10:00:00Z"
      };
      return json({ question_id: questionId, created, answer: recorded[questionId], xp_total: 0 }, created ? 201 : 200);
    }
    if (request.method() === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
}

test("a published sheet is reachable from Questions and its questions can be answered", async ({
  page
}, testInfo) => {
  const submissions = [];
  await mockStudent(page, { submissions });
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

  // One question at a time, with its place in the sheet.
  await expect(page.getByRole("heading", { name: "Which layer contains melanocytes?" })).toBeVisible();
  await expect(page.getByText("Question 1 of 2")).toBeVisible();
  await expect(page.getByText("1 remaining")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

  const card = page.locator(".question-card");
  // The answer is not given away before the student commits to one, and there
  // is no separate confirm step: the tap is the answer.
  await expect(card.getByText("Melanocytes reside in the basal layer.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check answer" })).toHaveCount(0);
  await card.getByRole("button", { name: /Spinous/ }).click();

  await expect(card.getByText("Not quite")).toBeVisible();
  await expect(card.getByText("Melanocytes reside in the basal layer.")).toBeVisible();
  // A wrong answer earns nothing, so no reward is shown.
  await expect(card.getByText(/\+\d+ XP/)).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Basal/ })).toHaveClass(/correct/);
  await expect(card.getByRole("button", { name: /Spinous/ })).toHaveClass(/wrong/);
  // Locked: a second tap cannot submit again.
  await expect(card.getByRole("button", { name: /Basal/ })).toBeDisabled();
  expect(submissions).toEqual([{ questionId: "question-one", choiceIds: ["one-b"] }]);

  // The result stays until the student moves on.
  await expect(page.getByText("Question 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: /Next question/ }).click();
  await expect(page.getByText("Question 2 of 2")).toBeVisible();
  await expect(page.getByText("0 remaining")).toBeVisible();
  await card.getByRole("button", { name: /True/ }).click();
  await expect(card.getByText("Correct")).toBeVisible();
  await expect(card.getByText("+10 XP")).toBeVisible();
  expect(submissions).toHaveLength(2);

  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("1 of 2 correct")).toBeVisible();
  await expect(page.locator(".question-player-summary").getByText("+10 XP")).toBeVisible();

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
