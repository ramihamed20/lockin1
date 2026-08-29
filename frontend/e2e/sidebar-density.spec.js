import { expect, test } from "@playwright/test";

/**
 * The sidebar has to hold every destination the account can reach. How much
 * room that needs depends on the account as much as on the viewport, so the
 * density is measured rather than declared at a breakpoint. These tests use the
 * account with the most destinations, which is where the budget is tightest.
 */

const OPERATIONS_ACCOUNT = {
  roles: ["student", "creator", "moderator", "administrator"],
  capabilities: ["overview.view", "content.manage", "assessments.manage"]
};

const STUDENT_ACCOUNT = { roles: ["student"], capabilities: null };

// Laptop and desktop sizes. Everything at or below 1099px tall used to be
// outside the reach of the height-based rule that rescued the iPad, because it
// was capped at 1199px wide.
const DESKTOP_VIEWPORTS = [
  { width: 1280, height: 800, name: "1280x800" },
  { width: 1440, height: 900, name: "1440x900" },
  { width: 1512, height: 982, name: "1512x982" },
  { width: 1920, height: 1080, name: "1920x1080" }
];

async function mockAccount(page, { roles, capabilities }) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/auth/session") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ user: { id: "density", email: "density@example.test", full_name: "Density Account", preferred_language: "en", status: "active", is_email_verified: true, roles, date_joined: "2026-01-01T00:00:00Z" } })
      });
      return;
    }
    if (pathname === "/api/v1/operations/session") {
      if (!capabilities) {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "permission_denied", message: "Student account" } }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ capabilities, role: "administrator" }) });
      return;
    }
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0, results: [] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "not_found", message: "Not used by the density tests" } }) });
  });
}

/** Waits for the streak reading to settle, since its height moves the line. */
async function openShell(page, viewport, account) {
  await mockAccount(page, account);
  await page.setViewportSize(viewport);
  await page.goto("/#/");
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".sidebar[data-density]")).toHaveCount(1);
  await page.waitForFunction(() => !document.querySelector(".sidebar .streak-card--loading"));
}

function readSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const list = document.querySelector(".sidebar .nav-list");
  const links = [...list.querySelectorAll("a[href^='#/']")];
  return {
    density: sidebar.dataset.density,
    destinations: links.length,
    hidden: Math.max(list.scrollHeight - list.clientHeight, sidebar.scrollHeight - sidebar.clientHeight),
    cue: list.dataset.overflow,
    masked: window.getComputedStyle(list).maskImage !== "none"
  };
}

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`the operations sidebar reaches every destination at ${viewport.name}`, async ({ page }) => {
    await openShell(page, viewport, OPERATIONS_ACCOUNT);
    const sidebar = await page.evaluate(readSidebar);

    // The account carries the student destinations plus its workspace ones.
    expect(sidebar.destinations).toBeGreaterThan(10);
    if (sidebar.hidden > 1) {
      expect(sidebar.cue, "the nav list hides destinations without a cue").not.toBe("none");
      expect(sidebar.masked, "the hidden edge is not faded").toBe(true);
    }

    // Whatever the density, the last destination has to be reachable.
    const lastReachable = await page.evaluate(() => {
      const list = document.querySelector(".sidebar .nav-list");
      const sidebar = document.querySelector(".sidebar");
      list.scrollTop = list.scrollHeight;
      sidebar.scrollTop = sidebar.scrollHeight;
      const links = [...list.querySelectorAll("a[href^='#/']")];
      const last = links[links.length - 1].getBoundingClientRect();
      return last.top >= 0 && last.bottom <= window.innerHeight + 1;
    });
    expect(lastReachable).toBe(true);
  });
}

// The regression this guards: a laptop hid 193px of navigation because the
// height rule that rescued the iPad stopped at 1199px wide.
test("a laptop hides no destinations from an operations account", async ({ page }) => {
  await openShell(page, { width: 1440, height: 900 }, OPERATIONS_ACCOUNT);
  const sidebar = await page.evaluate(readSidebar);
  expect(sidebar.density).toBe("compact");
  expect(sidebar.hidden).toBeLessThanOrEqual(1);
});

// The other half of the contract: density is measured, so a sidebar that fits
// keeps the streak card whole rather than collapsing on every laptop.
test("a sidebar with room to spare keeps its streak card whole", async ({ page }) => {
  await openShell(page, { width: 1920, height: 1080 }, STUDENT_ACCOUNT);
  const sidebar = await page.evaluate(readSidebar);
  expect(sidebar.density).toBe("comfortable");
  expect(sidebar.hidden).toBeLessThanOrEqual(1);

  const streak = await page.evaluate(() => {
    const card = document.querySelector(".sidebar .streak-card");
    return { height: Math.round(card.getBoundingClientRect().height), trackVisible: Boolean(card.querySelector(".streak-card-track")) && window.getComputedStyle(card.querySelector(".streak-card-track")).display !== "none" };
  });
  expect(streak.height).toBeGreaterThan(100);
  expect(streak.trackVisible).toBe(true);
});
