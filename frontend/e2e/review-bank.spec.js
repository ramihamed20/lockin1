import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

const SCREENSHOT_DIR = "output/playwright";

const histologyItem = {
  id: "11111111-1111-4111-8111-111111111111",
  canonical_key: "demo:oral-histology:1",
  subject_key: "oral-histology",
  subject_label: "Oral Histology",
  prompt: "Which tissue covers the anatomical crown of a tooth?",
  explanation_available: true,
  options: [
    { id: "enamel", text: "Enamel" },
    { id: "dentin", text: "Dentin" },
    { id: "cementum", text: "Cementum" },
    { id: "pulp", text: "Dental pulp" }
  ],
  state: "active_review",
  mastery_level: 0,
  mistake_count: 2,
  review_correct_count: 0,
  review_incorrect_count: 1,
  last_mistake_at: "2026-08-22T08:30:00Z",
  next_review_at: "2026-08-22T08:30:00Z",
  original_source: {
    type: "quiz",
    id: "oral-histology-quiz-2",
    label: "Enamel & Dentin Quiz",
    question_index: 3
  }
};

const anatomyItem = {
  ...histologyItem,
  id: "22222222-2222-4222-8222-222222222222",
  canonical_key: "demo:dental-anatomy:1",
  subject_key: "dental-anatomy",
  subject_label: "Dental Anatomy",
  prompt: "Which permanent tooth most often has five cusps?",
  options: [
    { id: "maxillary-first-molar", text: "Maxillary first molar" },
    { id: "mandibular-first-molar", text: "Mandibular first molar" },
    { id: "mandibular-second-molar", text: "Mandibular second molar" },
    { id: "maxillary-second-premolar", text: "Maxillary second premolar" }
  ],
  mistake_count: 1,
  review_incorrect_count: 0,
  original_source: {
    type: "practice",
    id: "tooth-morphology-practice",
    label: "Tooth Morphology Practice",
    question_index: 8
  }
};

const bankPayload = {
  active_count: 3,
  due_count: 3,
  mastered_this_week: 6,
  subjects: [
    {
      subject_key: "oral-histology",
      subject_label_snapshot: "Oral Histology",
      question_count: 2,
      repeated_count: 1,
      latest_mistake_at: "2026-08-22T08:30:00Z"
    },
    {
      subject_key: "dental-anatomy",
      subject_label_snapshot: "Dental Anatomy",
      question_count: 1,
      repeated_count: 0,
      latest_mistake_at: "2026-08-21T16:10:00Z"
    }
  ]
};

const queuePayload = {
  count: 4,
  results: [
    {
      id: "mistake-1",
      prompt: histologyItem.prompt,
      selected_answers: ["Cementum"],
      correct_answers: ["Enamel"],
      subject_key: "oral-histology",
      subject_label: "Oral Histology",
      source_type: "quiz",
      source_label: "Enamel & Dentin Quiz",
      source_question_index: 3,
      answered_at: "2026-08-22T08:30:00Z"
    },
    {
      id: "mistake-2",
      prompt: anatomyItem.prompt,
      selected_answers: ["Mandibular second molar"],
      correct_answers: ["Mandibular first molar"],
      subject_key: "dental-anatomy",
      subject_label: "Dental Anatomy",
      source_type: "practice",
      source_label: "Tooth Morphology Practice",
      source_question_index: 8,
      answered_at: "2026-08-21T16:10:00Z"
    },
    {
      id: "mistake-3",
      prompt: "Which cells form dentin?",
      selected_answers: ["Ameloblasts"],
      correct_answers: ["Odontoblasts"],
      subject_key: "oral-histology",
      subject_label: "Oral Histology",
      source_type: "sheet",
      source_label: "Dentin Study Sheet",
      source_question_index: 5,
      answered_at: "2026-08-20T12:00:00Z"
    },
    {
      id: "mistake-4",
      prompt: "Where is the cusp of Carabelli usually found?",
      selected_answers: ["Mandibular first molar"],
      correct_answers: ["Maxillary first molar"],
      subject_key: "dental-anatomy",
      subject_label: "Dental Anatomy",
      source_type: "mix",
      source_label: "Mixed Practice",
      source_question_index: 11,
      answered_at: "2026-08-19T09:00:00Z"
    }
  ]
};

function sessionPayload({ completed = false } = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    week_key: "2026-W34",
    status: completed ? "completed" : "in_progress",
    total_questions: 1,
    correct_answers: completed ? 1 : 0,
    answered_count: completed ? 1 : 0,
    started_at: "2026-08-22T09:00:00Z",
    completed_at: completed ? "2026-08-22T09:05:00Z" : null,
    questions: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        position: 1,
        selected_option_ids: completed ? ["mandibular-first-molar"] : [],
        was_correct: completed ? true : null,
        answered_at: completed ? "2026-08-22T09:05:00Z" : null,
        review_item: completed
          ? {
              ...anatomyItem,
              state: "hidden_review",
              mastery_level: 2,
              correct_option_ids: ["mandibular-first-molar"],
              explanation: "The mandibular first molar usually has five cusps."
            }
          : anatomyItem
      }
    ]
  };
}

async function mockReviewApi(page, { dailyItems = [histologyItem, anatomyItem], dailyError = false, language = "en", dailySeconds = 30 } = {}) {
  let weeklySession = null;
  const corrected = new Set();

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "review-bank-student",
            email: "student@example.test",
            full_name: "Review Student",
            preferred_language: language,
            status: "active",
            is_email_verified: true,
            roles: ["student"],
            date_joined: "2026-01-01T00:00:00Z"
          }
        })
      });
      return;
    }
    if (pathname === "/api/v1/auth/csrf") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ csrf_token: "review-bank-csrf-token" })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } })
      });
      return;
    }
    // The gated student routes need the access contract before they render.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/review-bank/daily" && method === "GET") {
      const results = dailyItems.filter(item => !corrected.has(item.id));
      await route.fulfill({ status: dailyError ? 503 : 200, contentType: "application/json", body: JSON.stringify(dailyError ? { error: { code: "unavailable", message: "Try again later" } } : { count: Math.min(20, results.length), due_count: results.length, seconds_per_question: dailySeconds, personalized_timing: dailySeconds !== 30, results: results.slice(0, 20) }) });
      return;
    }
    if (pathname === "/api/v1/review-bank" && method === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(bankPayload) });
      return;
    }
    if (pathname === "/api/v1/review-queue" && method === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(queuePayload) });
      return;
    }
    if (pathname === "/api/v1/review-bank/subjects/oral-histology" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ subject_key: "oral-histology", subject_label: "Oral Histology", count: 1, results: [histologyItem] })
      });
      return;
    }
    const dailyItem = dailyItems.find(item => pathname === `/api/v1/review-bank/items/${item.id}/answer`);
    if (dailyItem && method === "POST") {
      const wasCorrect = request.postDataJSON().selected_option_ids.includes("enamel");
      if (wasCorrect) corrected.add(dailyItem.id);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ was_correct: wasCorrect, confidence: request.postDataJSON().confidence, active_seconds: request.postDataJSON().active_seconds, review_item: { ...dailyItem, correct_option_ids: ["enamel"], explanation: "Enamel covers the anatomical crown." } }) });
      return;
    }
    if (pathname === `/api/v1/review-bank/items/${histologyItem.id}/answer` && method === "POST") {
      const selected = request.postDataJSON().selected_option_ids;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          was_correct: selected.includes("enamel"),
          review_item: {
            ...histologyItem,
            state: selected.includes("enamel") ? "hidden_review" : "active_review",
            mastery_level: selected.includes("enamel") ? 1 : 0,
            correct_option_ids: ["enamel"],
            explanation: "Enamel is the mineralized tissue covering the anatomical crown."
          }
        })
      });
      return;
    }
    if (pathname === "/api/v1/weekly-recall" && method === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ available: true, eligible_count: 1, session: weeklySession })
      });
      return;
    }
    if (pathname === "/api/v1/weekly-recall" && method === "POST") {
      weeklySession = sessionPayload();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ available: true, eligible_count: 1, session: weeklySession })
      });
      return;
    }
    if (pathname.includes("/api/v1/weekly-recall/33333333-3333-4333-8333-333333333333/questions/") && method === "POST") {
      weeklySession = sessionPayload({ completed: true });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ session: weeklySession }) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: `Not used by this review test: ${method} ${pathname}` } })
    });
  });
}

async function expectNoHorizontalOverflow(page) {
  await expect.poll(async () => page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }))).toEqual({ document: 0, body: 0 });
}

test.beforeAll(async () => {
  await mkdir(SCREENSHOT_DIR, { recursive: true });
});

test("Review Bank stays responsive and preserves mistake and recall behavior", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockReviewApi(page);

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/#/review");
  await expect(page.getByRole("heading", { name: "Your review today", exact: true })).toBeVisible();
  for (const viewport of [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { name: "Recent mistakes" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    if ([390, 820, 1440].includes(viewport.width)) {
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/review-center-${viewport.width}x${viewport.height}.png`,
        fullPage: true
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/review/bank");
  await expect(page.getByRole("heading", { name: "3 questions to review" })).toBeVisible();
  await page.getByRole("link", { name: /Oral Histology/ }).click();
  await expect(page.getByRole("heading", { name: histologyItem.prompt })).toBeVisible();
  await expect(page.getByText("Oral Histology · Enamel & Dentin Quiz · Q3")).toBeVisible();
  const cementumAnswer = page.getByRole("radio", { name: "C Cementum", exact: true });
  await expect(cementumAnswer).toBeVisible();
  await cementumAnswer.click({ force: true });
  await expect(cementumAnswer).toBeChecked();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Not yet — kept in Review Bank")).toBeVisible();
  await expect(page.getByText("Correct", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/review-answer-mobile-390x844.png`, fullPage: true });

  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/#/review/weekly");
  await expect(page.getByRole("heading", { name: "1 question is ready" })).toBeVisible();
  await page.getByRole("button", { name: "Start Weekly Recall" }).click();
  await expect(page.getByRole("heading", { name: anatomyItem.prompt })).toBeVisible();
  const recallAnswer = page.getByRole("radio", { name: "B Mandibular first molar", exact: true });
  await expect(recallAnswer).toBeVisible();
  await recallAnswer.click({ force: true });
  await expect(recallAnswer).toBeChecked();
  await page.getByRole("button", { name: "Check answer" }).click();
  await expect(page.getByText("Correct — moved to future recall")).toBeVisible();
  await page.getByRole("button", { name: "Finish Weekly Recall" }).click();
  await expect(page.getByRole("heading", { name: "Weekly Recall complete" })).toBeVisible();
  await expect(page.getByText("You remembered 1 of 1")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/weekly-recall-complete-820x1180.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
});


test("daily review limits a mixed session, grades normally and reports recovery", async ({ page }) => {
  const dailyItems = Array.from({ length: 12 }, (_, index) => ({ ...histologyItem, id: `daily-${index}`, subject_label: index % 2 ? "Anatomy" : "Histology", prompt: `Daily question ${index + 1}` }));
  await mockReviewApi(page, { dailyItems });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/review");
  await expect(page.getByText("10 questions · About 5 min", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "10 min", exact: true }).click();
  await expect(page.getByText("12 questions · About 6 min", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start review", exact: true })).toHaveAttribute("href", "#/review/daily?limit=20");
  await page.getByRole("button", { name: "5 min", exact: true }).click();
  await page.getByRole("link", { name: "Start review", exact: true }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  for (let index = 0; index < 10; index += 1) {
    await expect(page.getByRole("heading", { name: `Daily question ${index + 1}`, exact: true })).toBeVisible();
    await page.getByRole("radio", { name: index === 9 ? "C Cementum" : "A Enamel", exact: true }).click({ force: true });
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(index + 1));
    await page.getByRole("button", { name: index === 9 ? "Finish review" : "Next question", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Daily session complete" })).toBeVisible();
  await expect(page.getByText("You answered 9 of 10 correctly.", { exact: true })).toBeVisible();
  await expect(page.locator(".review-result-stats dd")).toHaveText(["9", "1"]);
  await page.getByRole("button", { name: "Another short session" }).click();
  await expect(page.getByRole("heading", { name: "Daily question 10", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "3");
});

test("daily home reflows in Arabic and leaves recall available when caught up", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lock-in.locale", "ar"));
  await mockReviewApi(page, { dailyItems: [], language: "ar" });
  await page.goto("/#/review");
  await expect(page.getByRole("heading", { name: "مراجعتك اليوم" })).toBeVisible();
  for (const viewport of [{ width: 320, height: 700 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  }
  await expect(page.locator(".review-daily-entry a[href='#/review/weekly']")).toBeVisible();
  await expect(page.locator(".review-daily-entry a[href*='/review/daily']")).toHaveCount(0);
});

test("a daily loading failure keeps the bank and weekly recall usable", async ({ page }) => {
  await mockReviewApi(page, { dailyError: true });
  await page.goto("/#/review");
  await expect(page.getByRole("heading", { name: "Weekly Recall", exact: true })).toBeVisible();
  await expect(page.locator(".review-subject-list").getByRole("link", { name: /Oral Histology/ })).toBeVisible();
  await expect(page.locator(".review-daily-entry")).toHaveCount(0);
});


test("dashboard starts the existing daily review route directly", async ({ page }) => {
  await mockReviewApi(page);
  await page.goto("/#/dashboard");
  const start = page.getByRole("link", { name: "Start today’s review", exact: false });
  await expect(start).toHaveAttribute("href", "#/review/daily");
  await start.click();
  await expect(page.getByRole("heading", { name: histologyItem.prompt })).toBeVisible();
});


test("daily review adapts its budget and keeps uncertainty separate from correctness", async ({ page }) => {
  const dailyItems = Array.from({ length: 12 }, (_, index) => ({ ...histologyItem, id: `adaptive-${index}`, prompt: `Adaptive question ${index + 1}` }));
  await mockReviewApi(page, { dailyItems, dailySeconds: 60 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/review");
  await expect(page.getByText("5 questions · About 5 min", { exact: true })).toBeVisible();
  await expect(page.getByText("Estimated from your recent answering pace", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Start review", exact: true }).click();
  for (let index = 0; index < 5; index += 1) {
    const unsure = page.getByRole("button", { name: "Not sure", exact: true });
    await expect(unsure).toHaveAttribute("aria-pressed", "false");
    if (index === 0) await unsure.click();
    await page.getByRole("radio", { name: "A Enamel", exact: true }).click({ force: true });
    const submitted = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/review-bank/items/"));
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    const body = (await submitted).postDataJSON();
    expect(body.confidence).toBe(index === 0 ? "unsure" : "");
    expect(body.active_seconds).toBeGreaterThanOrEqual(1);
    expect(body.active_seconds).toBeLessThanOrEqual(900);
    if (index === 0) await expect(page.getByText("Correct, and marked as uncertain for future recall priority.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: index === 4 ? "Finish review" : "Next question", exact: true }).click();
  }
  await expect(page.getByText("You answered 5 of 5 correctly.", { exact: true })).toBeVisible();
  await expect(page.locator(".review-result-stats dd")).toHaveText(["5", "0", "1"]);
  await expectNoHorizontalOverflow(page);
});


test("reflection guides mistakes and recovery never submits another graded attempt", async ({ page }) => {
  const dailyItems = Array.from({ length: 5 }, (_, index) => ({ ...histologyItem, id: `reflect-${index}`, prompt: `Reflection question ${index + 1}` }));
  await mockReviewApi(page, { dailyItems });
  const submissions = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/review-bank/items/")) submissions.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/review/daily?limit=5");
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("radio", { name: index === 2 ? "A Enamel" : "C Cementum", exact: true }).click({ force: true });
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    if (index === 0) {
      await expect(page.getByRole("group", { name: "Why did you miss it? Optional" })).toBeVisible();
      await page.getByRole("button", { name: "Mixed up facts", exact: true }).click();
      await expect(page.locator(".review-reflection-comparison dd")).toHaveText(["Cementum", "Enamel"]);
      await page.getByRole("button", { name: "Did not understand", exact: true }).click();
      await page.getByRole("button", { name: "Read the explanation", exact: true }).click();
      await expect(page.locator(".question-explanation-text")).toHaveText("Enamel covers the anatomical crown.");
      await page.getByRole("button", { name: "Forgot", exact: true }).click();
      await expect(page.getByText("Try recalling the idea in your own words. An earlier mistake may return in end-of-session practice.")).toBeVisible();
    }
    await page.getByRole("button", { name: index === 4 ? "Finish review" : "Next question", exact: true }).click();
  }
  await expect(page.getByText("You answered 1 of 5 correctly.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Practise earlier mistakes (2)", exact: true }).click();
  for (let index = 0; index < 2; index += 1) {
    await expect(page.getByRole("heading", { name: `Reflection question ${index + 1}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not sure", exact: true })).toHaveCount(0);
    await page.getByRole("radio", { name: "A Enamel", exact: true }).click({ force: true });
    await page.getByRole("button", { name: "Check answer", exact: true }).click();
    await expect(page.getByText("Correct in practice", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: index === 1 ? "Finish practice" : "Next question", exact: true }).click();
  }
  await expect(page.getByText("Extra practice: 2 of 2 correct.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to session results", exact: true }).click();
  await expect(page.getByText("You answered 1 of 5 correctly.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Practise earlier mistakes/ })).toHaveCount(0);
  expect(submissions).toHaveLength(5);
  await expectNoHorizontalOverflow(page);
});

test("the last mistake alone does not trigger an immediate recovery repeat", async ({ page }) => {
  await mockReviewApi(page, { dailyItems: [histologyItem] });
  await page.goto("/#/review/daily?limit=1");
  await page.getByRole("radio", { name: "C Cementum", exact: true }).click({ force: true });
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("button", { name: "Finish review", exact: true }).click();
  await expect(page.getByText("You answered 0 of 1 correctly.", { exact: true })).toBeVisible();
  await expect(page.locator(".review-practice-offer")).toHaveCount(0);
});


test("Arabic mistake reflection and recovery controls reflow on a narrow phone", async ({ page }) => {
  const dailyItems = Array.from({ length: 3 }, (_, index) => ({ ...histologyItem, id: `arabic-reflect-${index}` }));
  await mockReviewApi(page, { dailyItems, language: "ar" });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/#/review/daily?limit=3");
  for (let index = 0; index < 3; index += 1) {
    await page.locator("label.review-choice").filter({ has: page.getByRole("radio", { name: index ? "A Enamel" : "C Cementum", exact: true }) }).click();
    await expect(page.getByRole("radio", { name: index ? "A Enamel" : "C Cementum", exact: true })).toBeChecked();
    await page.locator(".review-submit-answer").click();
    if (index === 0) {
      await page.getByRole("button", { name: "خلطت بين معلومتين", exact: true }).click();
      await expect(page.locator(".review-reflection-comparison dd")).toHaveText(["Cementum", "Enamel"]);
      await expectNoHorizontalOverflow(page);
    }
    await page.locator(".review-session-controls button").click();
  }
  await page.getByRole("button", { name: "إعادة تدريب الأخطاء (1)", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectNoHorizontalOverflow(page);
  await page.locator("label.review-choice").filter({ has: page.getByRole("radio", { name: "A Enamel", exact: true }) }).click();
  await page.locator(".review-submit-answer").click();
  await page.getByRole("button", { name: "إنهاء التدريب", exact: true }).click();
  await expect(page.getByText("التدريب الإضافي: 1 من 1 بشكل صحيح.", { exact: true })).toBeVisible();
});
