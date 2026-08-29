import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { focusApi } from "../src/api/focus.js";
import { __testing } from "../src/api/client.js";
import { canAccessRoute } from "../src/lib/authz.js";

const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;
  __testing.reset();
});

test("Lock In API uses the persisted Django contracts for setup, recovery, actions, notes, and tasks", async () => {
  globalThis.document = { cookie: "csrftoken=csrf" };
  __testing.reset();
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return response({ session: { id: "session", status: "active" }, tasks: [], timing: { server_now: "2026-01-01T00:00:00Z", active_elapsed_seconds: 0, break_elapsed_seconds: 0 }, daily_summary: {} });
  };

  await focusApi.getLockIn();
  await focusApi.startLockIn({ documentVersionId: "document", clientInstanceId: "00000000-0000-4000-8000-000000000001", sessionType: "timed", plannedDurationSeconds: 1500, breakDurationSeconds: 300, goal: "Goal", topic: "Topic", note: "Note", tasks: [] });
  await focusApi.getLockInSession("session");
  await focusApi.lockInAction("session", "pause");
  await focusApi.updateLockInNote("session", { body: "A note", expectedRevision: 2 });
  await focusApi.addLockInTask("session", { clientTaskId: "00000000-0000-4000-8000-000000000002", title: "Task" });
  await focusApi.toggleLockInTask("session", "task");

  assert.deepEqual(calls, [
    { url: "/api/v1/focus/lock-in", method: "GET", body: undefined },
    { url: "/api/v1/focus/lock-in", method: "POST", body: { client_instance_id: "00000000-0000-4000-8000-000000000001", session_type: "timed", goal: "Goal", topic: "Topic", note: "Note", tasks: [], document_version_id: "document", planned_duration_seconds: 1500, break_duration_seconds: 300 } },
    { url: "/api/v1/focus/lock-in/session", method: "GET", body: undefined },
    { url: "/api/v1/focus/lock-in/session/pause", method: "POST", body: {} },
    { url: "/api/v1/focus/lock-in/session/note", method: "PATCH", body: { body: "A note", expected_revision: 2 } },
    { url: "/api/v1/focus/lock-in/session/tasks", method: "POST", body: { client_task_id: "00000000-0000-4000-8000-000000000002", title: "Task" } },
    { url: "/api/v1/focus/lock-in/session/tasks/task/toggle", method: "POST", body: {} }
  ]);
});

test("Lock In route delegates entitlement enforcement to Django after authentication", () => {
  const student = { id: "student", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/lock-in"), true);
  assert.equal(canAccessRoute(student, "/lock-in/session-id"), true);
  assert.equal(canAccessRoute(student, "/lock-in/session-id/extra"), false);
});

test("Lock In sends a team name only when a team session is requested", async () => {
  globalThis.document = { cookie: "csrftoken=csrf" };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return response({ session: { id: "session", status: "active" }, tasks: [], timing: { server_now: "2026-01-01T00:00:00Z", active_elapsed_seconds: 0, break_elapsed_seconds: 0 }, daily_summary: {} });
  };

  await focusApi.startLockIn({ documentVersionId: null, clientInstanceId: "00000000-0000-4000-8000-000000000003", sessionType: "timed", plannedDurationSeconds: 1500, teamName: "Oral Anatomy Squad" });

  assert.equal(calls[0].url, "/api/v1/focus/lock-in");
  assert.equal(calls[0].body.team_name, "Oral Anatomy Squad");
});

test("Lock In team creation, joining, and chat use Django endpoints", async () => {
  globalThis.document = { cookie: "csrftoken=csrf" };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return response({ team: { id: "team" }, messages: [] });
  };

  await focusApi.createLockInTeam("Oral Anatomy Squad");
  await focusApi.joinLockInTeam("AB12CD34");
  await focusApi.getLockInTeamMessages("team");
  await focusApi.sendLockInTeamMessage("team", "Ready to focus?");

  assert.deepEqual(calls, [
    { url: "/api/v1/focus/lock-in/teams", method: "POST", body: { name: "Oral Anatomy Squad" } },
    { url: "/api/v1/focus/lock-in/teams/join", method: "POST", body: { invite_code: "AB12CD34" } },
    { url: "/api/v1/focus/lock-in/teams/team/messages", method: "GET", body: undefined },
    { url: "/api/v1/focus/lock-in/teams/team/messages", method: "POST", body: { body: "Ready to focus?" } }
  ]);
});

test("Lock In is presented as coming soon without exposing the active workspace route", async () => {
  const [app, layout, comingSoon, styles, dashboard, catalogue] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/LockInComingSoon.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/i18n.js", import.meta.url), "utf8")
  ]);

  assert.match(app, /path="\/lock-in" element={<LockInComingSoon/);
  assert.match(app, /path="\/lock-in\/:sessionId" element={<LockInComingSoon/);
  assert.match(layout, /location\.pathname === "\/lock-in"/);
  // The wording lives in the message catalogue now, so both halves are checked:
  // the page asks for the key, and English still reads the way it did.
  assert.match(comingSoon, /t\("lockIn\.comingSoon"\)/);
  assert.match(catalogue, /"lockIn\.comingSoon": "Coming soon"/);
  assert.match(comingSoon, /t\("lockIn\.openStudyPlan"\)/);
  assert.match(catalogue, /"lockIn\.openStudyPlan": "Open Study Plan"/);
  assert.match(styles, /\.lock-in-coming-soon/);
  assert.doesNotMatch(dashboard, /Focus session|FocusTimerCard|Enter Lock In Mode/);
});
