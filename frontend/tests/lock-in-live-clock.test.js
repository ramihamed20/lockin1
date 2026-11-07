import assert from "node:assert/strict";
import test from "node:test";
import { acceptsLiveResponse, liveClock } from "../src/components/lock-in/liveSession.js";

const snapshot = {
  session: { id: "one", status: "active", planned_duration_seconds: 1500 },
  timing: { active_elapsed_seconds: 600, server_now: "2026-10-27T10:00:00Z" },
  received_at_monotonic_ms: 1000, self_active_seconds: 100, self_running: true,
  session_revision: 3
};
test("room time and personal time stay distinct and bounded", () => {
  assert.deepEqual(liveClock(snapshot, 11000), { room: 610, personal: 110, remaining: 890 });
  assert.equal(liveClock(snapshot, 1001000).remaining, 0);
  assert.equal(liveClock(snapshot, 1001000).personal, 175);
});
test("personal break does not stop the room clock", () => {
  assert.deepEqual(liveClock({ ...snapshot, self_running: false }, 11000), { room: 610, personal: 100, remaining: 890 });
});
test("older network responses cannot undo a transition or completion", () => {
  assert.equal(acceptsLiveResponse(snapshot, { ...snapshot, session_revision: 2 }), false);
  assert.equal(acceptsLiveResponse({ ...snapshot, session: { ...snapshot.session, status: "completed" } }, snapshot), false);
});
