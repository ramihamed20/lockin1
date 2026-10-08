import { expect, test } from "@playwright/test";
import { STUDIO_AREAS } from "../src/lib/studioAreas.js";

test.use({ serviceWorkers: "block" });
import { ID, STUDENT, mockAdmin } from "./helpers/mock-admin-workspace.js";

const VIEWPORTS = [
  ["320", 320, 640, false], ["Android", 360, 800, true], ["iPhone", 390, 844, true],
  ["iPad portrait", 820, 1180, true], ["iPad landscape", 1180, 820, true], ["desktop", 1440, 900, false]
];
const SUBJECT = { id: ID, title: "Histology synthetic subject", college_key: "university-faculty", college_title: "جامعة الاختبار — كلية طب الأسنان", specialty_key: "dentistry", specialty_title: "Dentistry", academic_year_key: "year-two", academic_year_title: "Year 2 / Batch 2026", sheet_count: 1, published_count: 1, draft_count: 0 };
const SHEET = { id: ID, title: "Synthetic sheet", revision: 1, position: 0, workflow_status: "published", student_visible: true, question_count: 1, published_question_count: 1, active_study_enabled: false, pdf: { page_count: 20 }, editions: [{ edition: "university", available: true, page_count: 20 }, { edition: "lockin", available: false }] };
const PLAN = { enabled: false, edition_label: "University Sheet", total_pdf_pages: 20, eligible_study_pages: 20, excluded_start_pages: 0, excluded_end_pages: 0, questions_per_checkpoint: 15, final_exam_questions: 50, difficulties: [] };
for (const [device, width, height, touch] of VIEWPORTS) {
  test.describe(`content controls ${device}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch });
    test("hierarchy, sheet forms, editions and Active Study fit RTL", async ({ page }, testInfo) => {
      await mockAdmin(page, { locale: "ar" });
      await page.route("**/operations/admin/content/**", async (route) => {
        const { pathname } = new URL(route.request().url());
        let body = { count: 0, results: [] };
        if (pathname.endsWith("/subjects")) body = { count: 1, results: [SUBJECT] };
        else if (pathname.endsWith("/sheets")) body = { subject: SUBJECT, count: 1, results: [SHEET] };
        else if (pathname.includes("active-study")) body = PLAN;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      });
      await page.goto("/#/operations/admin/content");
      await page.getByRole("combobox", { name: "College", exact: true }).selectOption(SUBJECT.college_key);
      await page.getByRole("combobox", { name: "Specialty", exact: true }).selectOption(SUBJECT.specialty_key);
      await page.getByRole("combobox", { name: "Year / batch", exact: true }).selectOption(SUBJECT.academic_year_key);
      await page.getByRole("button", { name: new RegExp(SUBJECT.title) }).click();
      await page.getByRole("button", { name: "Add sheet", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Sheet name", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator(".admin-sheet-row summary").click();
      const tabs = page.getByRole("tablist", { name: "Sheet control center" });
      for (const tab of ["Files", "Questions", "Active Study", "Publication", "Danger Zone"]) {
        await tabs.getByRole("tab", { name: tab, exact: true }).click();
        await expect(page.locator(".admin-sheet-control .loading-panel")).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      }
      await page.getByRole("button", { name: "Archive sheet", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      if (device === "320" || device === "iPad landscape") await page.screenshot({ path: testInfo.outputPath(`content-controls-${width}.png`), fullPage: true });
    });
  });
}
for (const [area, label] of STUDIO_AREAS) {
  for (const [device, width, height, touch] of VIEWPORTS) {
    test.describe(`${area} ${device}`, () => {
      test.use({ viewport: { width, height }, hasTouch: touch });
      test("admin area is usable in Arabic RTL", async ({ page }, testInfo) => {
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await mockAdmin(page, { locale: "ar" });
        await page.goto(`/#/operations/admin/${area}`);
        const main = page.locator(".creator-studio-content");
        await expect(page.locator(".studio-header h1")).toHaveText(label);
        await expect(main.locator(".loading-panel")).toHaveCount(0);
        await expect(main).not.toHaveText("");
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
        if (device === "320" || device === "iPad landscape") await page.screenshot({ path: testInfo.outputPath(`${area}-${width}.png`), fullPage: true });
      });
    });
  }
}

for (const [device, width, height, touch] of VIEWPORTS) {
  test.describe(`student drawer ${device}`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch });
    test("detail controls fit and remain reachable after scrolling", async ({ page }, testInfo) => {
      await mockAdmin(page, { locale: "ar" });
      await page.goto("/#/operations/admin/users");
      await page.getByRole("button", { name: /View/ }).first().click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByRole("heading", { name: STUDENT.full_name })).toBeVisible();
      const close = drawer.getByRole("button", { name: "Close", exact: true });
      expect((await close.boundingBox()).height).toBeGreaterThanOrEqual(44);
      const reason = drawer.getByRole("textbox", { name: "Administrative reason" });
      expect((await reason.boundingBox()).height).toBeGreaterThanOrEqual(44);
      const bounds = await drawer.boundingBox();
      expect(bounds.y).toBe(0);
      expect(bounds.height).toBe(height);
      expect(await drawer.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      if (width === 320) expect((await drawer.boundingBox()).width).toBe(width);
      await drawer.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await expect(close).toBeInViewport();
      if (device === "320" || device === "iPad landscape") await page.screenshot({ path: testInfo.outputPath("student-drawer.png") });
      await close.click();
      await expect(drawer).toHaveCount(0);
    });
  });
}

test("student detail stays modal while loading, traps focus, and restores its trigger", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await mockAdmin(page, { detailGate: pending });
  await page.goto("/#/operations/admin/users");
  const trigger = page.getByRole("button", { name: "View", exact: false }).first();
  await trigger.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  expect(await page.locator("#root").evaluate((node) => node.inert)).toBe(true);
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  release();
  await expect(drawer.getByRole("heading", { name: STUDENT.full_name })).toBeVisible();
  for (let index = 0; index < 12; index++) await page.keyboard.press("Tab");
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.locator("#root").evaluate((node) => node.inert)).toBe(false);
});

test("student detail errors retain a close action", async ({ page }) => {
  await mockAdmin(page, { detailStatus: 500 });
  await page.goto("/#/operations/admin/users");
  await page.getByRole("button", { name: /View/ }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("alert")).toBeVisible();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(drawer).toHaveCount(0);
});

test("directory keeps readable data after a server failure and clears it after permission denial", async ({ page }) => {
  let status = 200;
  await mockAdmin(page, { listStatus: () => status });
  await page.goto("/#/operations/admin/users");
  await expect(page.getByText(STUDENT.email, { exact: true })).toBeVisible();
  status = 500;
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("active");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(STUDENT.email, { exact: true })).toBeVisible();
  status = 403;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(STUDENT.email, { exact: true })).toHaveCount(0);
});

test("an administrative confirmation cannot send duplicate account actions", async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const writes = await mockAdmin(page, { actionGate: pending });
  await page.goto("/#/operations/admin/users");
  await page.getByRole("button", { name: /View/ }).first().click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("textbox", { name: "Administrative reason" }).fill("Synthetic audit reason");
  await drawer.getByRole("button", { name: "Suspend", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(confirmation.getByRole("button", { name: "Working…" })).toBeDisabled();
  await expect.poll(() => writes.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  expect(writes).toHaveLength(1);
  release();
  await expect(confirmation).toHaveCount(0);
});
