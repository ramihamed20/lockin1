import { expect, test } from "@playwright/test";
import { POLICY_VERSION } from "../src/lib/policyContent.js";
import { signE2eLease } from "./fixtures/offlineLease.js";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

async function connect(page, { locale = "en", empty = false, noCohort = false, failSave = false, failLoad = false, theme = "night", outside = false } = {}) {
  let profile = { included: true, display_mode: "initials" };
  let fail = failLoad;
  await page.addInitScript(({ locale }) => {
    localStorage.setItem("lock-in.locale", locale);
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
  }, { locale });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (url.pathname === "/api/v1/auth/session") return json({ user: studentSession({ preferred_language: locale, theme_settings: { theme, character: "white", autoTheme: false }, policy_version: POLICY_VERSION, policy_accepted_at: "2026-10-26T12:00:00Z" }) });
    if (url.pathname === "/api/v1/auth/csrf") return json({ csrf_token: "rank-mode-csrf" });
    if (await fulfillAccessContract(route, url.pathname)) return;
    if (url.pathname === "/api/v1/offline/lease/") return json({ lease: signE2eLease("e2e-student") });
    if (url.pathname === "/api/v1/offline/manifest/") return json({ items: [], subjects: [], version: 1 });
    if (url.pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (url.pathname === "/api/v1/progression/rankings/profile") {
      if (request.method() === "PUT") {
        if (failSave) return json({ error: { code: "unavailable", message: "Privacy could not be saved." } }, 503);
        profile = request.postDataJSON();
      }
      return json(profile);
    }
    if (url.pathname === "/api/v1/progression/rankings/live") {
      if (fail) { fail = false; return json({ error: { code: "unavailable", message: "Ranking could not be loaded." } }, 503); }
      const monthly = url.searchParams.get("period") === "monthly";
      const own = { entry_key: "self", position: outside ? 150 : 2, score: monthly ? 900 : 300, evidence_count: 15, display_name: "E2E Student", is_me: true };
      const show = !empty && !noCohort;
      return json({
        period: url.searchParams.get("period"), generated_at: "2026-10-26T12:00:00Z",
        period_end: url.searchParams.get("period") === "all_time" ? null : monthly ? "2026-11-01T00:00:00+02:00" : "2026-11-02T00:00:00+02:00", cohort_required: noCohort,
        cohort_name: locale === "ar" ? "طب الأسنان · السنة الثانية · طرابلس" : "Dentistry · Year 2 · Tripoli",
        participant_count: show ? (profile.included ? 2 : 1) : 0,
        points_to_next_rank: show && profile.included ? 100 : null,
        own_entry: show && profile.included ? own : null,
        entries: show ? [{ entry_key: "peer", position: 1, score: monthly ? 1000 : 400, display_name: "A. L.", is_me: false }, ...(profile.included && !outside ? [own] : [])] : []
      });
    }
    return json({ count: 0, results: [] });
  });
}

for (const [width, height, locale, theme] of [[320, 568, "ar", "night"], [390, 844, "ar", "day"], [820, 1180, "ar", "day"], [1180, 820, "en", "night"], [1440, 900, "en", "day"], [667, 375, "en", "day"]]) {
  test(`rank mode renders and changes periods at ${width}px (${locale}, ${theme})`, async ({ page }, testInfo) => {
    await connect(page, { locale, theme });
    await page.setViewportSize({ width, height });
    await page.goto("/#/ranked");
    await expect(page.locator(".rank-mode-row.is-me")).toContainText("300");
    await expect(page.locator(".feature-coming-soon")).toHaveCount(0);
    await expect(page.locator(".rank-mode-periods [aria-selected=true]")).toContainText(locale === "ar" ? "هذا الأسبوع" : "This week");
    await page.getByRole("tab", { name: locale === "ar" ? "هذا الشهر" : "This month", exact: true }).click();
    await expect(page.locator(".rank-mode-row.is-me")).toContainText("900");
    if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator(".rank-mode")).not.toContainText("rankMode.");
    await expect(page.locator(".rank-mode-goal progress")).toHaveAttribute("max", "1000");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.locator(".rank-mode-heading").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`rank-mode-${width}-${locale}-${theme}.png`), fullPage: true });
    if (locale === "en") {
      await page.locator(".rank-mode-panel").last().locator("summary").click();
      await expect(page.locator(".rank-mode-timing")).toContainText("12:00 AM");
      await page.locator(".rank-mode-panel").last().locator("summary").click();
    }
    await page.getByRole("tab", { name: locale === "ar" ? "الإجمالي" : "All time", exact: true }).click();
    await expect(page.locator(".rank-mode-row.is-me")).toContainText("300");
    await expect(page.locator(".rank-mode-timing > span")).toHaveCount(0);
  });
}

test("privacy draft survives period changes and saving hides participation", async ({ page }) => {
  await connect(page);
  await page.goto("/#/ranked");
  await expect(page.locator(".rank-mode-row.is-me")).toBeVisible();
  await page.getByRole("button", { name: "Ranking privacy", exact: true }).click();
  const include = page.getByRole("switch", { name: "Include my score" });
  await include.click();
  await page.getByRole("tab", { name: "This month", exact: true }).click();
  await expect(page.locator(".rank-mode-row.is-me")).toContainText("900");
  await expect(include).not.toBeChecked();
  await page.getByRole("button", { name: "Save visibility", exact: true }).click();
  await expect(page.locator(".rank-mode-panel [role=status]")).toContainText("Privacy preferences saved.");
  await expect(page.locator(".rank-mode-row.is-me")).toHaveCount(0);
  await expect(page.locator(".rank-mode-next")).toContainText("Your participation is hidden");
  await include.click();
  await page.getByRole("button", { name: "Save visibility", exact: true }).click();
  await expect(page.locator(".rank-mode-row.is-me")).toBeVisible();
});

test("failed privacy save preserves the displayed standings and supports retry", async ({ page }) => {
  await connect(page, { failSave: true });
  await page.goto("/#/ranked");
  await expect(page.locator(".rank-mode-row.is-me")).toBeVisible();
  await page.getByRole("button", { name: "Ranking privacy", exact: true }).click();
  await page.getByRole("switch", { name: "Include my score" }).click();
  await page.getByRole("button", { name: "Save visibility", exact: true }).click();
  await expect(page.locator(".rank-mode-panel [role=alert]")).toBeVisible();
  await expect(page.locator(".rank-mode-row.is-me")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save visibility", exact: true })).toBeEnabled();
});

test("empty and unassigned cohorts have useful states", async ({ page }) => {
  await connect(page, { empty: true });
  await page.goto("/#/ranked");
  await expect(page.locator(".rank-mode-board")).toContainText("A fresh opportunity to begin");
  await page.unrouteAll();
  await connect(page, { noCohort: true });
  await page.reload();
  await expect(page.locator(".rank-mode")).toContainText("Complete your academic profile");
  await expect(page.locator(".rank-mode-row")).toHaveCount(0);
});

test("ranking load failure can be retried", async ({ page }) => {
  await connect(page, { failLoad: true });
  await page.goto("/#/ranked");
  await expect(page.locator(".rank-mode .error-panel")).toBeVisible();
  await page.locator(".rank-mode .error-panel button").click();
  await expect(page.locator(".rank-mode-row.is-me")).toBeVisible();
});


test("Find me focuses the student even beyond the top 100", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await connect(page, { outside: true });
  await page.goto("/#/ranked");
  await page.getByRole("button", { name: "Find me", exact: true }).click();
  await expect(page.locator(".rank-mode-own .is-me")).toBeFocused();
  await expect(page.locator(".rank-mode-own .rank-mode-place")).toContainText("150");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keyboard tabs, disclosure and privacy choices work with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await connect(page);
  await page.goto("/#/ranked");
  const weekly = page.getByRole("tab", { name: "This week", exact: true });
  await weekly.focus();
  await weekly.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "This month", exact: true })).toBeFocused();
  await expect(page.locator(".rank-mode-row.is-me")).toContainText("900");
  const privacy = page.locator(".rank-mode-panel").first();
  await expect(privacy).not.toHaveAttribute("open", "");
  await privacy.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(privacy).toHaveAttribute("open", "");
  const fullName = page.getByRole("radio", { name: "Full name", exact: true });
  await fullName.click();
  await expect(fullName).toBeChecked();
  await page.getByRole("button", { name: "Save visibility", exact: true }).click();
  await expect(privacy.locator("[role=status]")).toContainText("Privacy preferences saved.");
  await expect(fullName).toBeChecked();
});
