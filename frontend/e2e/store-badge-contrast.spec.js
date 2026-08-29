import { expect, test } from "@playwright/test";

/**
 * Store badges are 10px and bold on a filled brand surface, which is small text
 * under WCAG, so every theme has to clear 4.5:1. Night nearly failed silently:
 * its accent is a light purple, and white ink on it measured 3.25:1 for NEW and
 * 2.97:1 for LIMITED while the three light themes passed.
 *
 * The ratios are measured on the painted colours rather than read out of the
 * stylesheet, because the badges resolve through color-mix() and oklch().
 */

const THEMES = ["night", "day", "dawn", "sunset"];

const BADGES = [
  ".store-badge:not(.popular):not(.limited)",
  ".store-badge.popular",
  ".store-badge.limited",
  ".store-bundle-badge",
  ".store-topup-option em"
];

test("every store badge meets AA in every theme", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: { id: "store", email: "store@example.test", full_name: "Store Shopper", preferred_language: "en", status: "active", is_email_verified: true, roles: ["student"], date_joined: "2026-01-01T00:00:00Z" } }) });
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
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the contrast test" } }) });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/store");
  await expect(page.locator(".store-badge").first()).toBeVisible();

  const measured = await page.evaluate(({ themes, badges }) => {
    // Painting the colour and reading the pixel back is the only way to resolve
    // color-mix() and oklch() to sRGB without reimplementing either.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    function channels(color) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2]];
    }
    function luminance(color) {
      const linear = (value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      };
      const [red, green, blue] = channels(color);
      return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    }

    const themeBefore = document.documentElement.dataset.theme;
    const results = [];
    for (const theme of themes) {
      document.documentElement.dataset.theme = theme;
      for (const selector of badges) {
        const element = document.querySelector(selector);
        if (!element) {
          results.push({ theme, selector, ratio: null });
          continue;
        }
        const style = window.getComputedStyle(element);
        const pair = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
        results.push({ theme, selector, ratio: Number(((pair[0] + 0.05) / (pair[1] + 0.05)).toFixed(2)) });
      }
    }
    if (themeBefore) document.documentElement.dataset.theme = themeBefore;
    return results;
  }, { themes: THEMES, badges: BADGES });

  expect(measured).toHaveLength(THEMES.length * BADGES.length);
  for (const badge of measured) {
    expect(badge.ratio, `${badge.selector} is not rendered in ${badge.theme}`).not.toBeNull();
    expect(badge.ratio, `${badge.selector} in ${badge.theme}`).toBeGreaterThanOrEqual(4.5);
  }
});
