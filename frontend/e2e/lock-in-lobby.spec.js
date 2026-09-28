import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";

const OUTPUT = new URL("../output/playwright/", import.meta.url);

async function connect(page, language = "en", initialTeam = null) {
  let team = initialTeam;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession({ preferred_language: language }) });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "lobby-csrf" });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (pathname === "/api/v1/focus/lock-in") return json({ active_session: null, materials: [], teams: team ? [team] : [], team_rankings: [], server_now: "2026-09-28T00:00:00Z" });
    if (pathname === "/api/v1/focus/lock-in/leaderboard") return json({ solo: [], teams: [] });
    if (pathname === "/api/v1/focus/lock-in/teams/join" && method === "POST") return json({ error: { code: "not_found", message: "Team not found." } }, 400);
    if (pathname === "/api/v1/focus/lock-in/teams" && method === "POST") {
      const body = request.postDataJSON();
      team = {
        id: "00000000-0000-4000-8000-000000000001", name: body.name, max_members: body.max_members,
        invite_code: "482731", member_count: 1, joining_locked: false, closed_at: null,
        role: "owner", self_member_id: "membership-1", members: [{ member_id: "membership-1", user_id: null,
          name: body.anonymous ? "Anonymous 01" : "E2E Student", anonymous: Boolean(body.anonymous), role: "owner", status: "offline" }]
      };
      return json({ team }, 201);
    }
    if (pathname === "/api/v1/focus/lock-in/teams/00000000-0000-4000-8000-000000000001" && method === "GET") return json({ team });
    if (method === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  if (language === "ar") await page.addInitScript(() => localStorage.setItem("lock-in.locale", "ar"));
}

async function screenshot(page, name) {
  await expect(page.locator(".offline-indicator")).toBeHidden({ timeout: 8_000 });
  mkdirSync(fileURLToPath(OUTPUT), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(name, OUTPUT)), fullPage: true });
}

for (const [name, viewport] of Object.entries({
  desktop: { width: 1440, height: 900 },
  ipad: { width: 768, height: 1024 },
  phone: { width: 320, height: 720 },
  landscape: { width: 667, height: 375 }
})) {
  test(`Lockin lobby fits ${name}`, async ({ page }) => {
    await connect(page);
    await page.setViewportSize(viewport);
    await page.goto("/#/lock-in");
    await expect(page.getByRole("heading", { name: "Solo / Team" })).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await screenshot(page, `lockin-${name}.png`);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("sidebar enters the dedicated Lockin surface", async ({ page }) => {
  await connect(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/dashboard");
  await page.locator(".sidebar").getByRole("link", { name: "Lockin Mode" }).click();
  await expect(page.getByRole("heading", { name: "Solo / Team" })).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCount(0);
});

test("create anonymous team and show host controls", async ({ page }) => {
  await connect(page);
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /02 Team/ }).click();
  await page.getByRole("button", { name: /Create Team/ }).click();
  await page.getByRole("textbox", { name: "Team name" }).fill("Evening study");
  await page.getByRole("checkbox", { name: "Stay Anonymous" }).check();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evening study" })).toBeVisible();
  await expect(page.getByText("Anonymous 01")).toBeVisible();
  await expect(page.getByText("E2E Student")).toHaveCount(0);
  await expect(page.getByText("482731")).toBeVisible();
  await expect(page.getByText("Host controls")).toBeVisible();
  await screenshot(page, "lockin-team-lobby.png");
});

test("Solo setup keeps anonymous choice", async ({ page }) => {
  await connect(page);
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /01 Solo/ }).click();
  await expect(page.getByRole("heading", { name: "Solo", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Stay Anonymous" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Duration" })).toBeVisible();
  await screenshot(page, "lockin-solo-setup.png");
});

test("Join Team accepts digits and shows an inline error", async ({ page }) => {
  await connect(page);
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /02 Team/ }).click();
  await page.getByRole("button", { name: /Join Team/ }).click();
  const code = page.getByRole("textbox", { name: "Team code" });
  await code.fill("12ab34");
  await expect(code).toHaveValue("1234");
  await expect(page.getByRole("button", { name: "Join", exact: true })).toBeDisabled();
  await code.fill("482731");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Team not found.");
});

test("team members do not see host controls", async ({ page }) => {
  const team = {
    id: "00000000-0000-4000-8000-000000000001", name: "Study circle", max_members: 8,
    invite_code: "482731", member_count: 2, joining_locked: false, closed_at: null,
    role: "member", self_member_id: "membership-2", members: [
      { member_id: "membership-1", user_id: "owner", name: "Owner", role: "owner" },
      { member_id: "membership-2", user_id: "e2e-student", name: "E2E Student", role: "member" }
    ]
  };
  await connect(page, "en", team);
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /Study circle/ }).click();
  await expect(page.getByRole("heading", { name: "Study circle" })).toBeVisible();
  await expect(page.getByText("Host controls")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave Team" })).toBeVisible();
});

test("full team and long name remain usable on a narrow phone", async ({ page }) => {
  const members = Array.from({ length: 8 }, (_, index) => ({
    member_id: `membership-${index + 1}`,
    user_id: index ? null : "e2e-student",
    name: index ? `Anonymous ${String(index + 1).padStart(2, "0")}` : "E2E Student",
    role: index ? "member" : "owner"
  }));
  const team = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "A long evening study team for anatomy and oral surgery",
    max_members: 8, member_count: 8, invite_code: "482731", joining_locked: false,
    closed_at: null, role: "owner", self_member_id: "membership-1", members
  };
  await connect(page, "en", team);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /A long evening study team/ }).click();
  await page.locator(".lm-member-menu summary").first().click();
  await expect(page.getByRole("button", { name: "Transfer Host" })).toBeVisible();
  await page.locator(".lm-member-menu summary").first().click();
  await page.locator(".lm-settings summary").click();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await screenshot(page, "lockin-full-phone.png");
});

test("Arabic lobby keeps codes legible", async ({ page }) => {
  await connect(page, "ar");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/lock-in");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "فردي / فريق" })).toBeVisible();
  await page.getByRole("button", { name: /02 فريق/ }).click();
  await page.getByRole("button", { name: /الانضمام لفريق/ }).click();
  const code = page.getByRole("textbox", { name: "رمز الفريق" });
  await code.fill("482731");
  await expect(code).toHaveAttribute("dir", "ltr");
  await screenshot(page, "lockin-rtl-join.png");
});
