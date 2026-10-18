import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

test.use({ serviceWorkers: "block", hasTouch: true });

async function setup(page, language = "en", { completedBefore = [], wrong = () => false } = {}) {
  const calls = [];
  let run = null;
  let closed = null;
  const pdf = await readFile(new URL("./fixtures/pdf/sheet-41.pdf", import.meta.url));
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now())));
  await page.route("**/e2e-fixtures/pdf/**", (route) => route.fulfill({ contentType: "application/pdf", body: pdf }));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path === "/api/v1/auth/session") return json({ user: studentSession({ preferred_language: language }) });
    if (path === "/api/v1/auth/csrf") return json({ csrf_token: "test-token" });
    if (path === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (await fulfillAccessContract(route, path)) return;
    if (path === "/api/v1/focus/lock-in") return json({ active_session: null });
    if (path === "/api/v1/catalog/materials") return json({ results: [], count: 0 });
    if (path.startsWith("/api/v1/focus/managed-active-study/sheets/")) return json({ sheet_id: "e2e-vitamin-1", enabled: true, difficulties: ["easy", "medium", "hard"].map((difficulty) => ({ difficulty, status: "ready", number_of_parts: 8, page_ranges: [{ part: 1, start_page: 1, end_page: 41 }], progress: null, pomodoro_progress: run, completed: false, customization_available: true, pomodoro_available: true, eligible_study_pages: 41 })) });
    if (path.endsWith("/pomodoro-clock")) {
      calls.push({ action: "pomodoro-clock", body: route.request().postDataJSON() });
      return json({ run });
    }
    if (path === "/api/v1/focus/managed-active-study/start") {
      const body = route.request().postDataJSON();
      calls.push({ action: "start", body });
      const resumed = Boolean(run);
      run ||= { id: "pomodoro-run", sheet_id: "e2e-vitamin-1", difficulty: body.difficulty, study_mode: body.study_mode, status: "active", stage: "reading", current_part: 1, number_of_parts: 1, current_page_range: { part: 1, start_page: 1, end_page: 41 }, page_ranges: [{ part: 1, start_page: 1, end_page: 41 }], completed_parts: [...completedBefore], questions_per_checkpoint: 15 };
      return json({ resumed, run }, resumed ? 200 : 201);
    }
    if (path.endsWith("/complete-reading")) {
      closed = route.request().postDataJSON();
      calls.push({ action: "complete-reading", body: closed });
      const range = { ...run.current_page_range, end_page: closed.end_page, question_count: closed.question_count };
      run = { ...run, stage: "checkpoint", current_page_range: range, page_ranges: [...run.page_ranges.slice(0, run.current_part - 1), range, { part: run.current_part + 1, start_page: closed.end_page + 1, end_page: 41 }], number_of_parts: run.current_part + 1 };
      return json({ run });
    }
    if (path.endsWith("/questions")) return json({ run, kind: "checkpoint", attempt_id: `pomo-attempt-${run.current_part}`, total: closed.question_count, questions: Array.from({ length: closed.question_count }, (_, index) => ({ position: index + 1, question: `Timed question ${index + 1}`, options: { A: "First answer", B: "Second answer", C: "Third answer", D: "Fourth answer" }, answered: null })) });
    if (path.endsWith("/submit")) {
      const body = route.request().postDataJSON();
      calls.push({ action: "submit", body });
      run = { ...run, stage: "reading", current_part: run.current_part + 1, completed_parts: [...run.completed_parts, run.current_part], current_page_range: run.page_ranges.at(-1), last_outcome: "passed" };
      const review = body.answers.map((item) => ({ position: item.position, page: Math.ceil(item.position / 2), correct: !wrong(item.position), correct_answer: "B", explanation: "Synthetic sheet evidence" }));
      const score = review.filter((item) => item.correct).length;
      return json({ run, result: { passed: true, score, total: closed.question_count, review, pomodoro_summary: { tests: run.completed_parts.map((part) => ({ part, score, total: closed.question_count })), average_percent: Math.round((100 * score) / closed.question_count), final_score: null, final_total: null } } });
    }
    return json({ count: 0, results: [], error: { code: "not_found", message: "Synthetic fixture" } }, 404);
  });
  await page.goto("/#/materials/catalog/biochemistry-1/sheets/vitamin-1/workspace");
  return calls;
}

async function start(page) {
  const dialog = page.locator(".workspace-v2-mode-dialog");
  await dialog.getByRole("button", { name: /^Pomodoro style/ }).click();
  await dialog.locator(".workspace-v2-active-start").click();
  await expect(page.locator(".pomodoro-study-clock")).toBeVisible();
  await expect(page.locator(".workspace-v2-page-number")).toHaveAttribute("aria-label", /(?:PDF page|صفحة PDF)/, { timeout: 20000 });
}

async function jump(page, number) {
  await page.locator(".workspace-v2-page-number").click();
  const field = page.locator(".workspace-v2-page-input input");
  await field.fill(String(number));
  await field.press("Enter");
  await expect(page.locator(".workspace-v2-page-number strong")).toHaveText(String(number));
  // Jumping closes this surface automatically on phones; tablets keep it open.
  if (page.viewportSize().width > 820) await page.locator(".workspace-v2-page-number").click();
  await expect(page.locator(".workspace-v2-page-navigator")).not.toBeVisible();
  await expect(page.locator(".workspace-v2-page-number strong")).toHaveText(String(number));
}

test("phone 390: countdown survives reload and tests pages one to seven with up to forty questions", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page);
  await start(page);
  await page.clock.fastForward(60_000);
  const before = await page.locator(".pomodoro-study-time").innerText();
  await page.reload();
  await start(page);
  const after = await page.locator(".pomodoro-study-time").innerText();
  expect(after).not.toBe("25:00");
  expect(Number(after.slice(0, 2))).toBeLessThanOrEqual(Number(before.slice(0, 2)));
  await jump(page, 7);
  const clock = page.locator(".pomodoro-study-clock");
  const bounds = await clock.boundingBox();
  expect(bounds.width).toBeLessThan(170);
  expect(bounds.x + bounds.width).toBeGreaterThan(370);
  await page.screenshot({ path: testInfo.outputPath("pomodoro-phone-clock.png") });
  await page.clock.fastForward(25 * 60 * 1000);
  const dialog = page.getByRole("dialog", { name: "25 minutes finished", exact: true });
  await expect(dialog).toContainText("Pages 1–7");
  const count = dialog.getByRole("spinbutton", { name: "Number of questions", exact: true });
  await expect(count).toHaveAttribute("max", "40");
  await count.fill("41");
  await expect(dialog.getByRole("button", { name: "Start page test", exact: true })).toBeDisabled();
  await count.fill("40");
  await page.screenshot({ path: testInfo.outputPath("pomodoro-phone-test-setup.png") });
  await dialog.getByRole("button", { name: "Start page test", exact: true }).click();
  await expect(page.locator(".workspace-v2-quiz-dialog")).toContainText("Question 1 of 40");
  expect(calls.find((call) => call.action === "complete-reading").body).toEqual({ part: 1, end_page: 7, question_count: 40 });
});

test("iPad 1180: pause, page test, five-minute break and next unread pages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const calls = await setup(page);
  await start(page);
  const clock = page.locator(".pomodoro-study-clock");
  expect((await clock.boundingBox()).width).toBeGreaterThanOrEqual(140);
  await clock.getByRole("button", { name: "Pause timer", exact: true }).click();
  const paused = await clock.getByRole("timer").innerText();
  await page.clock.fastForward(60_000);
  await expect(clock.getByRole("timer")).toHaveText(paused);
  await clock.getByRole("button", { name: "Resume timer", exact: true }).click();
  await jump(page, 7);
  await page.screenshot({ path: testInfo.outputPath("pomodoro-ipad-clock.png") });
  await page.clock.fastForward(25 * 60 * 1000);
  const dialog = page.getByRole("dialog", { name: "25 minutes finished", exact: true });
  await dialog.getByRole("spinbutton", { name: "Number of questions", exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Start page test", exact: true }).click();
  const quiz = page.locator(".workspace-v2-quiz-dialog");
  for (let index = 0; index < 5; index++) {
    await quiz.getByRole("radio", { name: /Second answer/ }).click();
    await quiz.getByRole("button", { name: index === 4 ? "Submit test" : "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Continue studying", exact: true }).click();
  await expect(clock).toContainText("Break");
  await expect(clock.getByRole("timer")).toContainText("05:");
  await page.clock.fastForward(5 * 60 * 1000);
  await clock.getByRole("button", { name: "Start next 25 minutes", exact: true }).click();
  await jump(page, 10);
  await page.clock.fastForward(25 * 60 * 1000);
  await expect(dialog).toContainText("Pages 8–10");
  expect(calls.filter((call) => call.action === "submit")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Arabic 375: right-hand translucent clock and single-page question capacity", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, "ar");
  await start(page);
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  const clock = page.locator(".pomodoro-study-clock");
  const bounds = await clock.boundingBox();
  expect(bounds.x + bounds.width).toBeGreaterThan(355);
  expect((await clock.getByRole("button").boundingBox()).height).toBeGreaterThanOrEqual(44);
  const alpha = await clock.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(alpha).not.toMatch(/rgb\(\d+, \d+, \d+\)/);
  await page.clock.fastForward(25 * 60 * 1000);
  const dialog = page.getByRole("dialog", { name: "انتهت 25 دقيقة", exact: true });
  await expect(dialog.getByRole("spinbutton", { name: "عدد الأسئلة", exact: true })).toHaveAttribute("max", "15");
  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
  expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("pomodoro-arabic-test-setup.png") });
});

async function passPageTest(page, count, minutes = 25) {
  await page.clock.fastForward(minutes * 60 * 1000);
  const dialog = page.getByRole("dialog", { name: `${minutes} minutes finished`, exact: true });
  await dialog.getByRole("spinbutton", { name: "Number of questions", exact: true }).fill(String(count));
  await dialog.getByRole("button", { name: "Start page test", exact: true }).click();
  const quiz = page.locator(".workspace-v2-quiz-dialog");
  for (let index = 0; index < count; index++) {
    await quiz.getByRole("radio", { name: /Second answer/ }).click();
    await quiz.getByRole("button", { name: index === count - 1 ? "Submit test" : "Next", exact: true }).click();
  }
}

test("phone 390: the result scores each page, opens a weak one, and the clock is saved for other devices", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page, "en", { wrong: (position) => position === 3 || position === 4 });
  await start(page);
  await jump(page, 7);
  await passPageTest(page, 6);
  const scores = page.locator(".pomodoro-page-scores li");
  await expect(scores).toHaveText(["Page 12/2", "Page 20/2", "Page 32/2"]);
  await expect(page.locator(".pomodoro-result")).toContainText("Session so far");
  const weak = page.getByRole("button", { name: "Open page 2 to read it again", exact: true });
  expect((await weak.boundingBox()).height).toBeGreaterThanOrEqual(32);
  await weak.click();
  await expect(page.locator(".workspace-v2-quiz-backdrop")).toHaveCount(0);
  await expect(page.locator(".workspace-v2-page-number strong")).toHaveText("2");
  // Saved a moment after each change: the break that follows the passed test reaches the server.
  const lastSaved = () => calls.filter((call) => call.action === "pomodoro-clock").at(-1)?.body.clock;
  await page.clock.runFor(1000);
  await expect.poll(() => lastSaved()?.phase).toBe("break");
  const saved = lastSaved();
  expect(saved).toMatchObject({ version: 1, part: 2 });
  expect(Number.isInteger(saved.updatedAt)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("iPad 1180: the fourth page test earns a 15-minute break with four filled dots", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await setup(page, "en", { completedBefore: [1, 2, 3] });
  await start(page);
  const clock = page.locator(".pomodoro-study-clock");
  await expect(clock.locator(".pomodoro-study-cycles i.is-done")).toHaveCount(3);
  await jump(page, 7);
  await passPageTest(page, 4);
  await page.getByRole("button", { name: "Continue studying", exact: true }).click();
  await expect(clock).toContainText("Long break");
  await expect(clock.getByRole("timer")).toContainText("15:");
  await expect(clock).toHaveAttribute("data-phase", "break");
  await expect(clock.locator(".pomodoro-study-cycles i.is-done")).toHaveCount(4);
});

test("phone 390: a 50/10 timer length chosen before starting runs a 50-minute cycle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const dialog = page.locator(".workspace-v2-mode-dialog");
  await dialog.getByRole("button", { name: /^Pomodoro style/ }).click();
  await dialog.getByRole("radio", { name: "50 / 10" }).check({ force: true });
  await expect(dialog.getByRole("checkbox", { name: "Play a sound when time is up" })).toBeChecked();
  await dialog.locator(".workspace-v2-active-start").click();
  const clock = page.locator(".pomodoro-study-clock");
  await expect(clock.getByRole("timer")).toHaveText("50:00");
  await page.clock.fastForward(25 * 60 * 1000);
  await expect(page.getByRole("dialog", { name: "50 minutes finished" })).toHaveCount(0);
  await page.clock.fastForward(25 * 60 * 1000);
  await expect(page.getByRole("dialog", { name: "50 minutes finished", exact: true })).toBeVisible();
  await expect(clock).toHaveAttribute("data-phase", "ready");
});
