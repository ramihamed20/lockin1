import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

/**
 * My Group for University of Tripoli Dentistry, Year 1 and Year 2: first-time
 * onboarding, the Dashboard invitation for existing students, the timetable at
 * every size in English and Arabic, changing groups, and persistence.
 *
 * Every payload comes from the real server resolver
 * (e2e/fixtures/myGroupPayloads.json is generated from apps.class_schedule for
 * all 8 Year 1 and 16 Year 2 combinations). The mock below only stores which
 * combination the account saved, the way the server does, so a second browser
 * context reading it is a second device reading the account.
 */

const FIXTURES = JSON.parse(readFileSync(new URL("./fixtures/myGroupPayloads.json", import.meta.url), "utf8"));
const PROGRAM = { id: "p", code: "dentistry-tripoli", name_en: "Dentistry — Tripoli", name_ar: "طب الأسنان طرابلس" };
const COHORTS = {
  "year-1": { id: "cohort-y1", code: "year-1", name_en: "Dentistry — Tripoli — First Year", name_ar: "طب أسنان طرابلس سنة أولى", program: PROGRAM },
  "year-2": { id: "cohort-y2", code: "year-2", name_en: "Dentistry — Tripoli — Second Year", name_ar: "طب أسنان طرابلس سنة ثانية", program: PROGRAM }
};

/** The account as the server holds it: its year, its saved groups, its welcome state. */
function createAccount({ year = "year-1", saved = "", welcome = false, available = true } = {}) {
  return {
    year,
    saved,
    welcome,
    available,
    puts: /** @type {any[]} */ ([]),
    mutations: /** @type {string[]} */ ([]),
    payload() {
      if (!this.available) return FIXTURES.unavailable;
      return this.saved ? FIXTURES[this.year].combos[this.saved] : FIXTURES[this.year].unconfigured;
    }
  };
}

async function connect(page, account, { language = "en", delay = 0, fail = false } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const user = () => studentSession({ preferred_language: language, cohort: COHORTS[account.year], welcome_required: account.welcome });
    if (method !== "GET" && pathname !== "/api/v1/auth/csrf") account.mutations.push(`${method} ${pathname}`);
    if (pathname === "/api/v1/auth/session") return json({ user: user() });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "e2e-csrf-token" });
    if (await fulfillAccessContract(route, pathname)) return undefined;
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (pathname === "/api/v1/account/welcome/complete") {
      account.welcome = false;
      return json({ user: user() });
    }
    if (pathname === "/api/v1/my-group") {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (fail) return json({ error: { code: "server_error", message: "Down" } }, 500);
      if (method === "PUT") {
        const body = request.postDataJSON();
        account.puts.push(body);
        const key = `${body.theory_group}/${body.default_practical_group}`;
        // The server refuses groups from another year.
        if (!FIXTURES[account.year].combos[key]) return json({ error: { code: "my_group_rejected", message: "Choose a valid practical group for your year." } }, 400);
        account.saved = key;
      }
      return json(account.payload());
    }
    if (method === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  if (language === "ar") await page.addInitScript(() => window.localStorage.setItem("lock-in.locale", "ar"));
}

async function noHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Walks the Theory -> Practical -> Review steps and confirms. */
async function chooseGroups(scope, { theory, practical, practicalOptions, language = "en" }) {
  const L = language === "ar"
    ? { next: "التالي", confirm: "تأكيد", theory: "مجموعة النظري" }
    : { next: "Next", confirm: "Confirm", theory: "Theory Group" };
  const next = scope.getByRole("button", { name: L.next });
  // Nothing is chosen for the student.
  await expect(scope.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(next).toBeDisabled();
  await scope.getByRole("radio", { name: theory, exact: true }).check();
  await next.click();
  const radios = scope.getByRole("radio");
  await expect(radios).toHaveCount(practicalOptions.length);
  for (const [index, option] of practicalOptions.entries()) await expect(radios.nth(index)).toHaveAccessibleName(option);
  await expect(scope.getByRole("radio", { checked: true })).toHaveCount(0);
  await scope.getByRole("radio", { name: practical, exact: true }).check();
  await next.click();
  const review = scope.locator(".mg-review-card");
  await expect(review).toContainText(L.theory);
  await expect(review.locator("dd").first()).toHaveText(theory);
  await expect(review.locator("dd").nth(1)).toHaveText(practical);
  await scope.getByRole("button", { name: L.confirm }).click();
}

const YEAR_1_PRACTICAL = ["A", "B", "C", "D"];
const YEAR_2_PRACTICAL = ["A1", "A2", "B1", "B2", "C1", "C2", "D1", "D2"];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 }
];

/* ----------------------------------------------------------- Onboarding */

test("a new Year 1 student picks Theory, then Practical, reviews and confirms during onboarding", async ({ page }, testInfo) => {
  const account = createAccount({ year: "year-1", welcome: true });
  await connect(page, account);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/#/dashboard");

  const flow = page.locator(".mg-flow");
  await expect(flow.getByText("Step 1 of 3")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("onboarding-year1-step1.png"), fullPage: true });
  await chooseGroups(flow, { theory: "B", practical: "C", practicalOptions: YEAR_1_PRACTICAL });

  // Then the usual welcome, and the Dashboard shows the chosen groups.
  await expect(page.locator("#welcome-title")).toBeVisible();
  expect(account.puts).toEqual([{ theory_group: "B", default_practical_group: "C", practical_overrides: {} }]);
  await page.locator(".welcome-actions .btn-primary").click();
  const card = page.locator(".mg-card");
  await expect(card.locator(".mg-badge").filter({ hasText: "Theory" })).toContainText("B");
  await expect(card.locator(".mg-badge").filter({ hasText: "Practical" })).toContainText("C");
});

test("a new Year 2 student gets the Year 2 groups in onboarding, in Arabic on a phone", async ({ page }, testInfo) => {
  const account = createAccount({ year: "year-2", welcome: true });
  await connect(page, account, { language: "ar" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/dashboard");
  const flow = page.locator(".mg-flow");
  await expect(flow.getByText("الخطوة 1 من 3")).toBeVisible();
  await noHorizontalScroll(page);
  await chooseGroups(flow, { theory: "A", practical: "A2", practicalOptions: YEAR_2_PRACTICAL, language: "ar" });
  await expect(page.locator("#welcome-title")).toBeVisible();
  expect(account.puts.at(-1)).toMatchObject({ theory_group: "A", default_practical_group: "A2" });
  await page.screenshot({ path: testInfo.outputPath("onboarding-year2-phone-ar.png"), fullPage: true });
});

test("onboarding can be left for later, and the Dashboard then invites instead", async ({ page }) => {
  const account = createAccount({ year: "year-1", welcome: true });
  await connect(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/dashboard");
  await page.getByRole("button", { name: "Set up later" }).click();
  await expect(page.locator("#welcome-title")).toBeVisible();
  expect(account.puts).toEqual([]);
  await page.locator(".welcome-actions .btn-primary").click();
  await expect(page.locator(".mg-card--invite")).toBeVisible();
});

for (const year of ["year-1", "year-2"]) {
  test(`an existing ${year} student without a group is invited on the Dashboard, never interrupted`, async ({ page }, testInfo) => {
    const account = createAccount({ year });
    await connect(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/dashboard");
    // No forced flow: the Dashboard loads, with a quiet invitation card.
    const invite = page.locator(".mg-card--invite");
    await expect(invite.getByRole("heading", { name: "My Group" })).toBeVisible();
    await expect(page.locator(".mg-flow")).toHaveCount(0);
    await expect(invite).toContainText("Set your group to see your timetable.");
    await invite.screenshot({ path: testInfo.outputPath(`dashboard-invite-${year}.png`) });
    await invite.getByRole("link", { name: "Set up My Group" }).click();

    await expect(page).toHaveURL(/#\/my-group$/);
    const practical = year === "year-1" ? YEAR_1_PRACTICAL : YEAR_2_PRACTICAL;
    await chooseGroups(page.locator(".mg-flow"), { theory: "A", practical: practical[2], practicalOptions: practical });
    await expect(page.locator("table.mg-grid")).toBeVisible();
    await page.goto("/#/dashboard");
    await expect(page.locator(".mg-card .mg-badge").filter({ hasText: "Practical" })).toContainText(practical[2]);
    await expect(page.locator(".mg-card--invite")).toHaveCount(0);
  });
}

test("My Group opened before setup shows the setup flow there too", async ({ page }) => {
  await connect(page, createAccount({ year: "year-1" }));
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/#/my-group");
  await expect(page.locator(".mg-flow").getByRole("heading", { level: 1, name: "My Group" })).toBeVisible();
  await noHorizontalScroll(page);
});

/* ---------------------------------------------------------- Persistence */

test("the saved group survives a reload and appears on another device", async ({ page, browser }, testInfo) => {
  const account = createAccount({ year: "year-1" });
  await connect(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/my-group");
  await chooseGroups(page.locator(".mg-flow"), { theory: "B", practical: "D", practicalOptions: YEAR_1_PRACTICAL });
  await expect(page.locator(".mg-page-head .mg-badge").filter({ hasText: "Practical" })).toContainText("D");

  // Nothing about the choice lives in the browser.
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }));
  expect(stored).not.toMatch(/theory_group|practical_group|my-?group/i);

  await page.reload();
  await expect(page.locator(".mg-page-head .mg-badge").filter({ hasText: "Theory" })).toContainText("B");
  await expect(page.locator(".mg-page-head .mg-badge").filter({ hasText: "Practical" })).toContainText("D");

  // A phone with a fresh browser: nothing shared but the account.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await phone.newPage();
  await connect(other, account);
  await other.goto("/#/my-group");
  await expect(other.locator(".mg-page-head .mg-badge").filter({ hasText: "Theory" })).toContainText("B");
  await expect(other.locator(".mg-page-head .mg-badge").filter({ hasText: "Practical" })).toContainText("D");
  await expect(other.locator(".mg-agenda-item")).toHaveCount(FIXTURES["year-1"].combos["B/D"].timetable.sessions.length);
  await other.screenshot({ path: testInfo.outputPath("persistence-other-device.png"), fullPage: true });
  await phone.close();
});

/* --------------------------------------------------------- Change group */

test("changing group asks for review and confirmation and touches nothing else", async ({ page }, testInfo) => {
  const account = createAccount({ year: "year-1", saved: "A/C" });
  await connect(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/my-group");
  await expect(page.locator(".mg-session")).toHaveCount(FIXTURES["year-1"].combos["A/C"].timetable.sessions.length);

  // Cancelling saves nothing.
  await page.getByRole("button", { name: "Change group" }).click();
  await page.locator("#my-group-change").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#my-group-change")).toHaveCount(0);
  expect(account.puts).toEqual([]);

  await page.getByRole("button", { name: "Change group" }).click();
  const panel = page.locator("#my-group-change");
  // Starts from the current groups; a new theory group clears the practical one,
  // since practical groups belong to their theory group.
  await expect(panel.getByRole("radio", { name: "A", exact: true })).toBeChecked();
  await panel.getByRole("radio", { name: "B", exact: true }).check();
  await panel.getByRole("button", { name: "Next" }).click();
  await expect(panel.getByRole("radio", { checked: true })).toHaveCount(0);
  await panel.getByRole("radio", { name: "D", exact: true }).check();
  await panel.getByRole("button", { name: "Next" }).click();
  await expect(panel).toContainText("Your university, year, subscription, progress, XP and streak stay exactly as they are.");
  await page.screenshot({ path: testInfo.outputPath("change-group-review.png"), fullPage: true });
  const before = account.mutations.length;
  await panel.getByRole("button", { name: "Confirm" }).click();

  await expect(page.locator("#my-group-change")).toHaveCount(0);
  await expect(page.locator(".mg-page-head .mg-badge").filter({ hasText: "Theory" })).toContainText("B");
  await expect(page.locator(".mg-page-head .mg-badge").filter({ hasText: "Practical" })).toContainText("D");
  // The only write was the group itself.
  expect(account.mutations.slice(before)).toEqual(["PUT /api/v1/my-group"]);
  expect(account.puts).toEqual([{ theory_group: "B", default_practical_group: "D", practical_overrides: {} }]);
});

/* ------------------------------------------------------------ Timetable */

for (const language of ["en", "ar"]) {
  test(`Year 1 Theory A + Practical C reads clearly at every size (${language})`, async ({ page }, testInfo) => {
    const payload = FIXTURES["year-1"].combos["A/C"];
    await connect(page, createAccount({ year: "year-1", saved: "A/C" }), { language });
    await page.clock.setFixedTime(new Date("2026-09-29T09:00:00")); // a Tuesday
    const theory = language === "ar" ? "نظري" : "Theory";
    const practical = language === "ar" ? "عملي" : "Practical";
    const anatomy = language === "ar" ? "التشريح العام" : "General Anatomy";
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("about:blank");
      await page.goto("/#/my-group");
      const card = page.locator(".mg-page-card");
      await expect(card.locator(".mg-page-head .mg-badge").filter({ hasText: theory })).toContainText("A");
      await expect(card.locator(".mg-page-head .mg-badge").filter({ hasText: practical })).toContainText("C");
      const wide = await card.evaluate((node) => node.getBoundingClientRect().width >= 720);
      expect(wide).toBe(viewport.name === "desktop" || viewport.name === "ipad-landscape");
      if (wide) {
        const grid = card.locator("table.mg-grid");
        await expect(grid.locator(".mg-session")).toHaveCount(payload.timetable.sessions.length);
        // The continuous 09:00–12:00 lecture spans two columns and states its time.
        const lecture = grid.locator("tr.is-today td[colspan='2'] .mg-session");
        await expect(lecture).toContainText(anatomy);
        await expect(lecture.locator(".mg-session-time")).toHaveText(language === "ar" ? "9:00 ص – 12:00 م" : "9:00 AM – 12:00 PM");
        await expect(grid.locator(".mg-session--theory").first()).toContainText(`${theory} · MS`);
      } else {
        await expect(card.locator("table.mg-grid")).toBeHidden();
        const tuesday = card.locator(".mg-agenda-day.is-today");
        // Chronological, time first: the lecture, then the two practicals.
        await expect(tuesday.locator(".mg-agenda-item")).toHaveCount(3);
        await expect(tuesday.locator(".mg-agenda-item").first()).toContainText(anatomy);
        await expect(tuesday.locator(".mg-agenda-time").nth(1)).toHaveText(language === "ar" ? "12:00 م – 2:00 م" : "12:00 PM – 2:00 PM");
        await expect(tuesday.locator(".mg-agenda-item").nth(1)).toContainText(practical);
        await expect(card.locator(".mg-agenda-item")).toHaveCount(payload.timetable.sessions.length);
      }
      await noHorizontalScroll(page);
      await page.screenshot({ path: testInfo.outputPath(`year1-${language}-${viewport.name}.png`), fullPage: true });
    }
  });
}

test("Year 2 keeps its timetable, Customize and group model", async ({ page }, testInfo) => {
  const payload = FIXTURES["year-2"].combos["A/A1"];
  await connect(page, createAccount({ year: "year-2", saved: "A/A1" }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/my-group");
  const grid = page.locator("table.mg-grid");
  await expect(grid.locator(".mg-session")).toHaveCount(payload.timetable.sessions.length);
  await expect(grid.locator(".mg-session--practical").first()).toContainText("Practical · A1");
  await expect(page.getByRole("button", { name: "Customize" })).toBeVisible();
  await page.getByRole("button", { name: "Change group" }).click();
  await page.locator("#my-group-change").getByRole("button", { name: "Next" }).click();
  await expect(page.locator("#my-group-change").getByRole("radio")).toHaveCount(8);
  await page.screenshot({ path: testInfo.outputPath("year2-desktop.png"), fullPage: true });
});

test("Year 1 never shows Year 2 groups or subjects, and Year 2 never shows Year 1's", async ({ page }) => {
  await connect(page, createAccount({ year: "year-1", saved: "B/A" }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/my-group");
  await expect(page.locator(".mg-session").first()).toBeVisible();
  const text = await page.locator(".mg-page-card").innerText();
  for (const subject of ["General Pathology", "Microbiology", "Pharmacology", "Oral Histology", "Prosthodontics"]) expect(text).not.toContain(subject);
  await expect(page.getByRole("button", { name: "Customize" })).toHaveCount(0);
  const metas = await page.locator("table.mg-grid .mg-session-meta").allInnerTexts();
  expect(metas.length).toBeGreaterThan(0);
  expect(metas.every((meta) => /(MS|DS)1\d0/.test(meta))).toBe(true);

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await connect(page, createAccount({ year: "year-2", saved: "B/A1" }));
  await page.goto("about:blank");
  await page.goto("/#/my-group");
  await expect(page.locator(".mg-session").first()).toBeVisible();
  const year2 = await page.locator(".mg-page-card").innerText();
  for (const subject of ["General Anatomy", "Dental Materials", "Dental Anatomy", "Biochemistry", "Physiology"]) expect(year2).not.toContain(subject);
});

test("a cohort without a timetable sees no My Group card and a calm message", async ({ page }) => {
  await connect(page, createAccount({ available: false }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/dashboard");
  await expect(page.locator(".dashboard-stats-grid").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".mg-card")).toHaveCount(0);
  await page.goto("/#/my-group");
  await expect(page.getByText("My Group isn’t available for your year yet.")).toBeVisible();
});

test("the dashboard card shows the student's groups and opens the timetable", async ({ page }, testInfo) => {
  await connect(page, createAccount({ year: "year-1", saved: "A/C" }));
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[2], VIEWPORTS[3]]) {
    await page.setViewportSize(viewport);
    await page.goto("about:blank");
    await page.goto("/#/dashboard");
    const card = page.locator(".mg-card");
    await expect(card.getByRole("heading", { name: "My Group" })).toBeVisible();
    await expect(card.locator(".mg-badge").filter({ hasText: "Theory" })).toContainText("A");
    await expect(card.locator(".mg-badge").filter({ hasText: "Practical" })).toContainText("C");
    await expect(card.getByRole("link", { name: "Change group" })).toHaveAttribute("href", /my-group\?change=1/);
    await noHorizontalScroll(page);
    await card.screenshot({ path: testInfo.outputPath(`dashboard-card-${viewport.name}.png`) });
  }
  await page.setViewportSize(VIEWPORTS[0]);
  await page.locator(".mg-card-main").click();
  await expect(page).toHaveURL(/#\/my-group$/);
  await expect(page.locator("table.mg-grid")).toBeVisible();
});

test("loading and failure each have a calm state", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await connect(page, createAccount({ year: "year-1", saved: "A/C" }), { delay: 4000 });
  await page.goto("/#/dashboard");
  const loading = page.locator(".mg-card--loading");
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await loading.screenshot({ path: testInfo.outputPath("card-loading.png") });
  await expect(page.locator(".mg-card .mg-badge").first()).toBeVisible({ timeout: 10000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
  await connect(page, createAccount({ year: "year-1" }), { fail: true });
  await page.goto("about:blank");
  await page.goto("/#/dashboard");
  const failed = page.locator(".mg-card").filter({ hasText: "My Group could not be loaded." });
  await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Year 2 per-subject customizing stays reachable on a phone in Arabic", async ({ page }, testInfo) => {
  await connect(page, createAccount({ year: "year-2", saved: "A/A1" }), { language: "ar" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/my-group?customize=1");
  const panel = page.locator("#my-group-customize");
  await expect(panel.locator(".mg-override-row")).toHaveCount(7);
  await expect(panel.locator(".mg-override-row select")).toHaveCount(14);
  await noHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath("customize-phone-ar.png"), fullPage: true });
});
