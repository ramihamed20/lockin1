import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * A missing message key does not throw: translate() falls back to the key
 * itself, so the interface quietly renders "materials.soon" where a word
 * belongs. This sweep opens the student routes in both languages and fails on
 * any visible text that still looks like a key.
 *
 * It also catches the other half of the same mistake - renaming a key and
 * leaving one caller behind.
 */

const STUDENT_ROUTES = [
  "/#/",
  "/#/dashboard",
  "/#/materials",
  "/#/questions",
  "/#/review",
  "/#/study-plan",
  "/#/progress",
  "/#/search",
  "/#/bookmarks",
  "/#/achievements",
  "/#/notifications",
  "/#/store",
  "/#/profile",
  "/#/lock-in"
];

// "namespace.key" or "namespace.key.variant" with no spaces - what an
// unresolved key looks like once it reaches the page.
const KEY_SHAPED = /^[a-z][a-zA-Z]*(\.[a-zA-Z]+){1,2}$/;

async function signIn(page, language) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "sweep", email: "sweep@example.test", full_name: "Sweep Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    // The gated student routes need the access contract before they render.
    if (await fulfillAccessContract(route, pathname)) return;
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the coverage sweep" } }) });
  });
}

/** Visible text and the labels screen readers get, one entry per element. */
function collectStrings() {
  const found = [];
  for (const element of document.querySelectorAll("body *")) {
    if (element.offsetParent === null && element.tagName !== "BODY") continue;
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) found.push(node.textContent.trim());
    }
    for (const attribute of ["aria-label", "placeholder", "title", "alt"]) {
      const value = element.getAttribute(attribute);
      if (value && value.trim()) found.push(value.trim());
    }
  }
  return found;
}

for (const language of ["en", "ar"]) {
  test(`no message key reaches the page in ${language}`, async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, language);
    await page.setViewportSize({ width: 1440, height: 900 });

    const leaks = [];
    for (const route of STUDENT_ROUTES) {
      await page.goto(route);
      // Lock In renders its own immersive screen outside the application
      // shell - the team hub, the setup form and its loading and error states
      // all share `.lock-in-screen` - so the sweep waits on either root.
      await expect(page.locator(".app-shell, .lock-in-screen").first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);
      const strings = await page.evaluate(collectStrings);
      for (const value of strings) {
        if (KEY_SHAPED.test(value)) leaks.push(`${route}: ${value}`);
      }
    }

    expect(leaks, `unresolved message keys rendered as text:\n${leaks.join("\n")}`).toEqual([]);
  });
}
