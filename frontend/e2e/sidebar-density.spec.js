import { expect, test } from "@playwright/test";
import { fulfillAccessContract } from "./fixtures/productionApi.js";

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
  { width: 1366, height: 1024, name: "iPad Pro landscape" },
  { width: 1440, height: 900, name: "1440x900" },
  { width: 1512, height: 982, name: "1512x982" },
  { width: 1920, height: 1080, name: "1920x1080" }
];

async function mockAccount(page, { roles, capabilities }) {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    // The gated routes need the access contract answered before they render.
    if (await fulfillAccessContract(route, pathname)) return;
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
  await page.waitForFunction(() => !document.querySelector(".sidebar .streak-mini[aria-busy]"));
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
    masked: window.getComputedStyle(list).maskImage !== "none",
    scroller: ["auto", "scroll"].includes(window.getComputedStyle(sidebar).overflowY) ? "sidebar" : "list"
  };
}

for (const viewport of DESKTOP_VIEWPORTS) {
  test(`the operations sidebar reaches every destination at ${viewport.name}`, async ({ page }) => {
    await openShell(page, viewport, OPERATIONS_ACCOUNT);
    const sidebar = await page.evaluate(readSidebar);

    // Five primary destinations, four standalone rail entries, and the two
    // operations workspaces must all remain reachable.
    expect(sidebar.destinations).toBe(11);
    // The whole rail owns scrolling on tablets, while wider layouts can keep
    // the list as their scroller. In either case the behavior that matters is
    // that the final destination remains reachable.
    const lastReachable = await page.evaluate(() => {
      const list = document.querySelector(".sidebar .nav-list");
      const sidebar = document.querySelector(".sidebar");
      const scroller = ["auto", "scroll"].includes(window.getComputedStyle(sidebar).overflowY) ? sidebar : list;
      scroller.scrollTop = scroller.scrollHeight;
      const links = [...list.querySelectorAll("a[href^='#/']")];
      const last = links[links.length - 1].getBoundingClientRect();
      return last.top >= 0 && last.bottom <= window.innerHeight + 1;
    });
    expect(lastReachable, `the last destination cannot be reached through the ${sidebar.scroller} scroller`).toBe(true);
  });
}

// The regression this guards: a laptop hid 193px of navigation because the
// height rule that rescued the iPad stopped at 1199px wide.
test("a laptop hides no destinations from an operations account", async ({ page }) => {
  await openShell(page, { width: 1440, height: 900 }, OPERATIONS_ACCOUNT);
  const sidebar = await page.evaluate(readSidebar);
  // The streak card is a fixed size now rather than one that collapses when
  // the destinations need room, so the densest account can overflow a laptop
  // sidebar. What has to hold is that nothing becomes unreachable, regardless
  // of whether the rail or the list owns scrolling at this width.
  if (sidebar.hidden > 1) {
    const lastReachable = await page.evaluate(() => {
      const list = document.querySelector(".sidebar .nav-list");
      const sidebar = document.querySelector(".sidebar");
      const scroller = ["auto", "scroll"].includes(window.getComputedStyle(sidebar).overflowY) ? sidebar : list;
      scroller.scrollTop = scroller.scrollHeight;
      const rows = [...list.querySelectorAll("a[href^='#/']")];
      const last = rows[rows.length - 1].getBoundingClientRect();
      return last.top >= 0 && last.bottom <= window.innerHeight + 1;
    });
    expect(lastReachable, "the last destination cannot be scrolled to").toBe(true);
  }
});

/** Whether the rail's streak reading is on screen, and what it announces. */
function readStreak() {
  const reading = document.querySelector(".sidebar .streak-mini");
  if (!reading) return { present: false };
  return {
    present: true,
    shown: window.getComputedStyle(reading).display !== "none",
    label: reading.getAttribute("aria-label") || ""
  };
}

// The rail holds only the primary destinations, so its streak reading fits at
// every tablet and desktop size, and the full streak card always stays one
// tap away in the expanded navigation.
test("the study streak stays reachable at every tablet and desktop size", async ({ page }) => {
  for (const viewport of [
    { width: 1920, height: 1080, name: "desktop", shown: true },
    { width: 1366, height: 1024, name: "iPad Pro landscape", shown: true },
    { width: 1024, height: 1366, name: "iPad Pro portrait", shown: true },
    { width: 834, height: 1112, name: "iPad portrait", shown: true },
    { width: 1440, height: 900, name: "laptop", shown: true },
    { width: 1112, height: 834, name: "iPad landscape", shown: true },
    { width: 1024, height: 600, name: "short landscape", shown: true }
  ]) {
    await openShell(page, viewport, STUDENT_ACCOUNT);
    const reading = await page.evaluate(readStreak);
    expect(reading.present, `${viewport.name} has no streak reading`).toBe(true);
    expect(reading.shown, `${viewport.name} streak visibility`).toBe(viewport.shown);
    expect(reading.label, `${viewport.name} drops the accessible label`).toMatch(/day study streak/);

    await page.locator(".sidebar .rail-expand").click();
    await expect(page.locator(".mobile-drawer.open .streak-card")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".mobile-drawer.open")).toHaveCount(0);
  }
});
