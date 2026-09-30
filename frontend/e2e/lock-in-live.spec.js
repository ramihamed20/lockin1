import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { fulfillAccessContract, studentSession } from "./fixtures/productionApi.js";
import { isFeatureComingSoon } from "../src/lib/featureAvailability.js";

// Lockin Mode is scheduled; lock-in-coming-soon.spec.js covers the gated route.
test.skip(isFeatureComingSoon("lock-in"), "Lockin Mode is coming soon");

const OUTPUT = new URL("../output/playwright/", import.meta.url);
const ID = "10000000-0000-4000-8000-000000000001";
const TEAM_ID = "20000000-0000-4000-8000-000000000001";

function makeLive(team = null) {
  const now = new Date().toISOString();
  return {
    session: { id: ID, status: "active", started_at: new Date(Date.now() - 182000).toISOString(), ended_at: null,
      planned_duration_seconds: 1500, team_id: team?.id || null,
      team_name: team?.name || "", lock_in_live: true },
    timing: { server_now: now, active_elapsed_seconds: 182, break_elapsed_seconds: 12,
      remaining_seconds: 1318 },
    team, participants: team ? [
      { member_id: "host", name: "E2E Student", role: "owner", presence: "focused" },
      { member_id: "private", name: "Anonymous 01", role: "member", anonymous: true, presence: "break" }
    ] : [], member_count: team ? 2 : 1,
    self_presence: team ? team.role === "member" ? "break" : "focused" : null,
    is_host: team ? team.role === "owner" : true
  };
}

function makeTeam(role = "owner") {
  return { id: TEAM_ID, name: "Anatomy focus", invite_code: "482731", member_count: 2,
    max_members: 8, joining_locked: false, closed_at: null, active_session_id: null,
    can_resume_session: false, role, self_member_id: role === "owner" ? "host" : "private",
    members: [
      { member_id: "host", name: "E2E Student", role: "owner" },
      { member_id: "private", name: "Anonymous 01", role: "member", anonymous: true }
    ] };
}

async function connect(page, { team = null, active = false, language = "en", otherPresence = "break" } = {}) {
  let live = active ? makeLive(team) : null;
  if (live && team) live.participants[1].presence = otherPresence;
  if (active && team) { team.active_session_id = ID; team.can_resume_session = true; }
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    const json = (payload, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession({ preferred_language: language }) });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "live-csrf" });
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
    if (pathname === "/api/v1/focus/lock-in" && method === "GET") return json({ active_session: live, materials: [], teams: team ? [team] : [], team_rankings: [], server_now: new Date().toISOString() });
    if (pathname === "/api/v1/focus/lock-in" && method === "POST") {
      live = makeLive(request.postDataJSON().team_id ? team : null);
      if (team) { team.active_session_id = ID; team.can_resume_session = true; }
      return json(live, 201);
    }
    if (pathname === `/api/v1/focus/lock-in/${ID}` && method === "GET") return json(live);
    if (pathname === `/api/v1/focus/lock-in/teams/${TEAM_ID}` && method === "GET") return json({ team });
    if (pathname === `/api/v1/focus/lock-in/teams/${TEAM_ID}/join-session` && method === "POST") {
      team.can_resume_session = true;
      return json(live);
    }
    if (pathname === `/api/v1/focus/lock-in/teams/${TEAM_ID}` && method === "PATCH") {
      Object.assign(team, request.postDataJSON());
      live.team = team;
      return json({ team });
    }
    if (pathname === `/api/v1/focus/lock-in/${ID}/presence` && method === "POST") {
      const presence = request.postDataJSON().presence;
      live = { ...live, self_presence: presence, participants: live.participants.map((item, index) =>
        index === (team?.role === "member" ? 1 : 0) ? { ...item, presence } : item), timing: { ...live.timing, server_now: new Date().toISOString() } };
      return json(live);
    }
    if (pathname.startsWith(`/api/v1/focus/lock-in/${ID}/`) && method === "POST") {
      const action = pathname.split("/").at(-1);
      if (action === "leave-session") return json({ left: true, team_id: TEAM_ID });
      const status = { pause: "paused", resume: "active", "start-break": "on_break",
        "end-break": "active", complete: "completed" }[action] || live.session.status;
      live = { ...live, session: { ...live.session, status,
        ended_at: status === "completed" ? new Date().toISOString() : null },
        timing: { ...live.timing, server_now: new Date().toISOString() } };
      return json(live);
    }
    if (method === "GET") return json({ count: 0, results: [] });
    return json({ error: { code: "not_found", message: "Unused" } }, 404);
  });
  return () => live;
}

async function screenshot(page, name) {
  await expect(page.locator(".offline-indicator")).toBeHidden({ timeout: 8_000 });
  mkdirSync(fileURLToPath(OUTPUT), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(name, OUTPUT)), fullPage: true });
}

test("Solo starts, pauses, takes a break, resumes and ends", async ({ page }) => {
  await connect(page);
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /01 Solo/ }).click();
  await page.getByRole("button", { name: "Start Lockin" }).click();
  await expect(page.getByRole("main", { name: "Lockin Session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /21:/ })).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Break" }).click();
  await expect(page.getByText("Break", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "End Lockin" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "End Lockin" }).click();
  await expect(page.locator(".lm-live-summary h1")).toContainText(/^\d+:\d{2}$/);
  await expect(page.getByText("LOCKED IN")).toBeVisible();
  await screenshot(page, "lockin-live-summary.png");
});

test("Team member waits while host has the Start action", async ({ page }) => {
  const team = makeTeam("member");
  await connect(page, { team });
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /Anatomy focus/ }).click();
  await expect(page.getByText("Waiting", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Lockin" })).toHaveCount(0);
});

test("Team host starts one shared session with anonymous presence", async ({ page }) => {
  const team = makeTeam();
  await connect(page, { team });
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /Anatomy focus/ }).click();
  await page.getByRole("button", { name: "Start Lockin" }).click();
  await page.getByRole("button", { name: "Start Lockin" }).click();
  await expect(page.getByRole("main", { name: "Lockin Session" })).toBeVisible();
  await expect(page.getByText("Anonymous 01")).toBeVisible();
  await screenshot(page, "lockin-live-member-break.png");
  await expect(page.getByLabel("Members").getByText("Break", { exact: true })).toBeVisible();
  await page.locator(".lm-live-more summary").click();
  await expect(page.getByRole("button", { name: "Lock joining" })).toBeVisible();
  await screenshot(page, "lockin-live-team-host.png");
});

test("Team member resumes from Break, has no host controls, and can leave", async ({ page }) => {
  await connect(page, { team: makeTeam("member"), active: true });
  await page.goto(`/#/lock-in/${ID}`);
  await expect(page.locator(".lm-live-more summary")).toHaveCount(0);
  await expect(page.getByText("Anonymous 01")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: "Break" })).toBeVisible();
  await page.getByRole("button", { name: "Leave Session" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Leave Session" }).click();
  await expect(page.getByRole("heading", { name: "Solo / Team" })).toBeVisible();
});

test("Active session is offered as Resume on Lockin home", async ({ page }) => {
  await connect(page, { active: true });
  await page.goto("/#/lock-in");
  await page.getByRole("button", { name: /Resume.*Solo/ }).click();
  await expect(page.getByRole("main", { name: "Lockin Session" })).toBeVisible();
});

test("Away presence remains distinct from Break", async ({ page }) => {
  await connect(page, { team: makeTeam(), active: true, otherPresence: "away" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/lock-in/${ID}`);
  await expect(page.getByLabel("Members").getByText("Away")).toBeVisible();
  await screenshot(page, "lockin-live-away.png");
});

for (const [name, viewport] of Object.entries({
  desktop: { width: 1440, height: 900 }, ipad: { width: 768, height: 1024 },
  phone: { width: 320, height: 720 }, landscape: { width: 667, height: 375 }
})) {
  test(`Live session fits ${name}`, async ({ page }) => {
    await connect(page, { team: makeTeam(), active: true });
    await page.setViewportSize(viewport);
    await page.goto(`/#/lock-in/${ID}`);
    await expect(page.getByRole("main", { name: "Lockin Session" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await screenshot(page, `lockin-live-${name}.png`);
  });
}

test("Arabic live timer stays left to right and resumes after refresh", async ({ page }) => {
  await connect(page, { active: true, language: "ar" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/lock-in/${ID}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".lm-live-clock h1")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.getByRole("main", { name: "Lockin Session" })).toBeVisible();
  await screenshot(page, "lockin-live-rtl.png");
});
