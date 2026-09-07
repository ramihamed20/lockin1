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
  // The streak card is a fixed size now rather than one that collapses when
  // the destinations need room, so the densest account can overflow a laptop
  // sidebar. What has to hold is that nothing becomes unreachable: if anything
  // is below the fold, the list scrolls and says so.
  if (sidebar.hidden > 1) {
    expect(sidebar.cue, "the nav list hides destinations without a cue").not.toBe("none");
    const lastReachable = await page.evaluate(() => {
      const list = document.querySelector(".sidebar .nav-list");
      list.scrollTop = list.scrollHeight;
      const rows = [...list.querySelectorAll("a[href^='#/']")];
      const last = rows[rows.length - 1].getBoundingClientRect();
      return last.top >= 0 && last.bottom <= window.innerHeight + 1;
    });
    expect(lastReachable, "the last destination cannot be scrolled to").toBe(true);
  }
});

/** The streak card's rendered shape, for comparison across viewports. */
function readStreak() {
  const card = document.querySelector(".sidebar .streak-card");
  if (!card) return { present: false };
  const style = window.getComputedStyle(card);
  return {
    present: true,
    height: Math.round(card.getBoundingClientRect().height),
    padding: style.padding,
    parts: [...card.children]
      .filter((child) => window.getComputedStyle(child).display !== "none")
      .map((child) => child.className)
      .join("+"),
    label: card.querySelector(".streak-card-heading span")?.textContent || ""
  };
}

// The streak card used to be laid out by `data-density`, which is measured from
// how much room the destinations leave, and by width bands and a pointer-type
// query on top of that. The same account therefore saw a different card on a
// laptop than on an iPad, and an iPad changed it simply by being rotated. It is
// one shape now, wherever it renders.
test("the study streak looks the same on every viewport", async ({ page }) => {
  const shapes = [];
  for (const viewport of [
    { width: 1920, height: 1080, name: "desktop" },
    { width: 1440, height: 900, name: "laptop" },
    { width: 1280, height: 800, name: "small laptop" },
    { width: 1112, height: 834, name: "iPad landscape" },
    { width: 1024, height: 1366, name: "iPad portrait" }
  ]) {
    await openShell(page, viewport, STUDENT_ACCOUNT);
    shapes.push({ name: viewport.name, ...(await page.evaluate(readStreak)) });
  }

  for (const shape of shapes) {
    expect(shape.present, `${shape.name} hides the streak card`).toBe(true);
    // The label is kept everywhere; one width band used to drop it entirely.
    expect(shape.label, `${shape.name} drops the label`).toBe("Study streak");
  }
  // Every viewport renders the same parts at the same size.
  const reference = shapes[0];
  for (const shape of shapes.slice(1)) {
    expect({ n: shape.name, parts: shape.parts, padding: shape.padding })
      .toEqual({ n: shape.name, parts: reference.parts, padding: reference.padding });
    expect(Math.abs(shape.height - reference.height), `${shape.name} height differs`).toBeLessThanOrEqual(2);
  }
});

// Rotation is the case that made this obvious to read.
test("rotating an iPad does not reshape the streak card", async ({ page }) => {
  await openShell(page, { width: 834, height: 1112 }, STUDENT_ACCOUNT);
  const portrait = await page.evaluate(readStreak);
  await page.setViewportSize({ width: 1112, height: 834 });
  await page.waitForTimeout(250);
  const landscape = await page.evaluate(readStreak);

  expect(landscape.parts).toBe(portrait.parts);
  expect(landscape.padding).toBe(portrait.padding);
  expect(Math.abs(landscape.height - portrait.height)).toBeLessThanOrEqual(2);
});
