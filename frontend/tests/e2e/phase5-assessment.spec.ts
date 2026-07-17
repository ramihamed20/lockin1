import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const user = {
  id: "e2e-user",
  email: "student@example.com",
  full_name: "Rami Student",
  preferred_language: "en",
  status: "active",
  is_email_verified: true,
  roles: ["student"],
  date_joined: "2026-07-17T00:00:00Z"
};
const quizId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000001";
const questionId = "21000000-0000-4000-8000-000000000001";
const correctOptionId = "30000000-0000-4000-8000-000000000001";
const wrongOptionId = "30000000-0000-4000-8000-000000000002";
const resultId = "40000000-0000-4000-8000-000000000001";
const pageOf = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });

const quiz = {
  id: quizId,
  version: {
    id: "11000000-0000-4000-8000-000000000001",
    version_number: 1,
    academic_node_id: "12000000-0000-4000-8000-000000000001",
    academic_node_title: "Oral anatomy",
    title: "Cranial nerves checkpoint",
    instructions: "Choose the best answer.",
    mode: "practice",
    selection_mode: "pool",
    question_count: 5,
    duration_seconds: null,
    maximum_attempts: 0,
    available_from: null,
    available_until: null,
    randomize_questions: true,
    randomize_options: true,
    result_release: "immediate",
    pass_percent: "60.00",
    focus_required: true,
    allowed_difficulties: ["easy", "medium", "hard"],
    language: "en"
  },
  published_at: "2026-07-17T09:00:00Z"
};
const question = {
  id: questionId,
  position: 1,
  prompt: "Which nerve controls facial expression?",
  question_type: "single_choice",
  difficulty: "medium",
  language: "en",
  option_snapshot: [
    { id: correctOptionId, text: "Facial nerve" },
    { id: wrongOptionId, text: "Optic nerve" }
  ],
  max_points: "1.00",
  answer: null
};
const attempt = {
  id: attemptId,
  quiz_id: quizId,
  quiz_version_id: quiz.version.id,
  quiz_title: quiz.version.title,
  mode: "practice",
  status: "active",
  review_only: true,
  requested_question_count: 1,
  server_revision: 1,
  started_at: "2026-07-17T10:00:00Z",
  deadline_at: null,
  completed_at: null,
  focus_required: true,
  focus_context: { context_type: "quiz", context_id: attemptId },
  server_time: "2026-07-17T10:00:00Z",
  result_id: null,
  questions: [question]
};
const result = {
  id: resultId,
  attempt_id: attemptId,
  quiz_title: quiz.version.title,
  mode: "practice",
  attempt_status: "submitted",
  released: true,
  release_at: "2026-07-17T10:02:00Z",
  score_points: "1.00",
  maximum_points: "1.00",
  percentage: "100.00",
  passed: true,
  answered_count: 1,
  unanswered_count: 0,
  submitted_at: "2026-07-17T10:02:00Z",
  questions: [{
    ...question,
    selected_option_ids: [correctOptionId],
    correct_option_ids: [correctOptionId],
    correct: true,
    explanation: "The facial nerve supplies the muscles of facial expression."
  }]
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith("/auth/session")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) });
    } else if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrf_token: "e2e-csrf" }) });
    } else if (path === "/api/v1/quizzes") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pageOf([quiz])) });
    } else if (path === "/api/v1/assessment-review") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(pageOf([{
          question_id: "13000000-0000-4000-8000-000000000001",
          prompt: "Identify the facial nerve.",
          academic_node_id: quiz.version.academic_node_id,
          academic_node_title: "Oral anatomy",
          difficulty: "medium",
          due_at: "2026-07-17T09:00:00Z",
          interval_days: 1,
          repetitions: 0,
          lapses: 1,
          mastery_state: "learning"
        }]))
      });
    } else if (path === `/api/v1/quizzes/${quizId}`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(quiz) });
    } else if (path === `/api/v1/quizzes/${quizId}/attempts` && request.method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ attempt, resumed: false }) });
    } else if (path === `/api/v1/attempts/${attemptId}`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(attempt) });
    } else if (path === `/api/v1/attempts/${attemptId}/questions/${questionId}/answer` && request.method() === "PUT") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ selected_option_ids: [correctOptionId], client_revision: 1, server_revision: 2, saved_at: "2026-07-17T10:01:00Z" })
      });
    } else if (path === `/api/v1/attempts/${attemptId}/activities`) {
      await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
    } else if (path === `/api/v1/attempts/${attemptId}/submit` && request.method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
    } else if (path === `/api/v1/assessment-results/${resultId}`) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }) });
    }
  });
});

test("review queue is accessible, responsive, and action-oriented", async ({ page }, testInfo) => {
  await page.goto("/assessments");
  await expect(page.getByRole("heading", { name: "Turn study into mastery." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start due review" })).toHaveAttribute(
    "href",
    `/assessments/quizzes/${quizId}?review=1`
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("assessment-home.png"), fullPage: true });
});

test("focused attempt autosaves, supports RTL, and reveals answers only after submit", async ({ page }, testInfo) => {
  await page.goto(`/assessments/quizzes/${quizId}?review=1`);
  await page.getByRole("button", { name: "Start due review" }).click();
  await expect(page).toHaveURL(new RegExp(`/assessments/attempts/${attemptId}$`));
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Which nerve controls facial expression/ })).toBeVisible();

  await page.getByRole("radio", { name: "Facial nerve" }).check();
  await expect(page.getByRole("status", { name: "" })).toContainText("Answer saved");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  if (testInfo.project.name.includes("mobile")) {
    await page.evaluate(() => localStorage.setItem("lockin.locale", "ar"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => localStorage.setItem("lockin.locale", "en"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await page.getByRole("radio", { name: "Facial nerve" }).check();
    await expect(page.getByRole("status", { name: "" })).toContainText("Answer saved");
  } else {
    const languageButton = page.locator(".attempt-header__actions button").nth(1);
    await languageButton.click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await languageButton.click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  }

  await page.getByRole("button", { name: "Review and submit" }).click();
  await expect(page.getByRole("dialog", { name: "Submit this attempt?" })).toBeVisible();
  await page.getByRole("button", { name: "Submit attempt" }).click();
  await expect(page).toHaveURL(new RegExp(`/assessments/results/${resultId}$`));
  await expect(page.getByText("100.00%")).toBeVisible();
  await expect(page.getByText("The facial nerve supplies the muscles of facial expression.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("assessment-result.png"), fullPage: true });
});
