import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

/**
 * Arabic reverses the reading direction, and two things have to follow it.
 *
 * Icons that mean "next", "back" or "opens elsewhere" point along the reading
 * direction, so they must face the other way. And a Latin or numeric run inside
 * an Arabic page reorders unless it is isolated: "3 sheets" rendered as
 * "sheets 3", and a trailing full stop jumped to the front of its sentence.
 *
 * The catalogue is bundled rather than fetched, so this page renders both a
 * mixed run and a directional icon without any seeded data.
 */

async function signIn(page, language) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    // The gated routes need the access contract answered before they render.
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "rtl", email: "rtl@example.test", full_name: "RTL Student", preferred_language: language, status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the direction tests" } }) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/materials");
  // The catalogue page is lazily loaded behind the session bootstrap, which is
  // slower to settle than the default expectation window on a cold start.
  await expect(page.locator(".catalog-tile").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
}

/** Where the first and last glyph of an element's text actually paint. */
function readGlyphOrder(selector) {
  const element = document.querySelector(selector);
  const node = element.firstChild;
  const text = node.textContent;
  const rectFor = (start, end) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range.getBoundingClientRect();
  };
  return {
    text,
    direction: window.getComputedStyle(element).direction,
    firstLeft: rectFor(0, 1).left,
    lastLeft: rectFor(text.length - 1, text.length).left
  };
}

// Subject names come from the bundled catalogue and stay in Latin script
// whatever the interface language, so this is the mixed run that never goes
// away. Without an isolate it is reordered by the surrounding Arabic.
test("a Latin run keeps its own order inside an Arabic page", async ({ page }) => {
  await signIn(page, "ar");

  const title = await page.evaluate(readGlyphOrder, ".catalog-tile__copy strong");
  expect(title.text).toMatch(/^[A-Za-z]/);
  expect(title.direction, "the Latin run is not isolated from the Arabic page").toBe("ltr");
  expect(title.firstLeft, `"${title.text}" is painted in reverse`).toBeLessThan(title.lastLeft);
});

test("the same run is unchanged in English", async ({ page }) => {
  await signIn(page, "en");

  const title = await page.evaluate(readGlyphOrder, ".catalog-tile__copy strong");
  expect(title.direction).toBe("ltr");
  expect(title.firstLeft).toBeLessThan(title.lastLeft);
  const meta = await page.evaluate((selector) => document.querySelector(selector).textContent, ".catalog-tile__copy small");
  expect(meta).toMatch(/^\d+ sheets?$/);
});

// A count is not one string with a number dropped in: Arabic has six count
// categories and reads its own digits.
test("a count is written and numbered the way Arabic writes counts", async ({ page }) => {
  await signIn(page, "ar");

  const counts = await page.evaluate(() => [...document.querySelectorAll(".catalog-tile__copy small")].map((node) => node.textContent));
  expect(counts.length).toBeGreaterThan(0);
  for (const count of counts) {
    // Arabic-Indic digits, then an Arabic word - no Latin digits, no "sheets".
    expect(count, "the count is not localised").toMatch(/^[\u0660-\u0669]+\s[\u0600-\u06FF]+$/);
  }
  // Three and four take the same (few) form; the plural is chosen, not appended.
  expect(new Set(counts).size).toBeGreaterThan(1);
});

test("directional icons face the reading direction in Arabic", async ({ page }) => {
  await signIn(page, "ar");

  const icons = await page.evaluate(() => {
    const style = (selector) => {
      const element = document.querySelector(selector);
      return element ? window.getComputedStyle(element).transform : "missing";
    };
    return {
      // A chevron that means "next".
      chevron: style(".catalog-tile__end svg[data-mirror-rtl]"),
      // An icon that means a thing rather than a direction.
      book: style(".catalog-tile__icon svg")
    };
  });

  // scaleX(-1) is matrix(-1, 0, 0, 1, 0, 0).
  expect(icons.chevron).toMatch(/^matrix\(-1,/);
  expect(icons.book, "a non-directional icon was mirrored too").toBe("none");
});

test("directional icons are left alone in English", async ({ page }) => {
  await signIn(page, "en");

  const chevron = await page.evaluate(() => window.getComputedStyle(document.querySelector(".catalog-tile__end svg[data-mirror-rtl]")).transform);
  expect(chevron).toBe("none");
});
