import test from "node:test";
import assert from "node:assert/strict";
import { reminderDefaults, reminderRequest, reminderValidation } from "../src/pwa/studyReminder.js";

test("overnight quiet hours reject a study reminder but allow its end boundary", () => {
  const draft = { ...reminderDefaults, enabled: true, quiet_enabled: true };
  assert.equal(reminderValidation({ ...draft, time: "23:00" }), "reminder.timeInQuiet");
  assert.equal(reminderValidation({ ...draft, time: "07:59" }), "reminder.timeInQuiet");
  assert.equal(reminderValidation({ ...draft, time: "08:00" }), "");
  assert.equal(reminderValidation({ ...draft, time: "22:00" }), "reminder.timeInQuiet");
  assert.equal(reminderValidation({ ...draft, quiet_start: "09:00", quiet_end: "17:00", time: "12:00" }), "reminder.timeInQuiet");
});

test("settings validate an active schedule and preserve server-owned pause unless explicitly changed", () => {
  assert.equal(reminderValidation({ ...reminderDefaults, weekdays: [] }), "reminder.chooseDays");
  assert.equal(reminderValidation({ ...reminderDefaults, enabled: true, study_enabled: false }), "reminder.chooseType");
  const draft = { ...reminderDefaults, revision: 7, paused_until: "server-time", next_due_at: "server-time" };
  const request = reminderRequest(draft, "ar");
  assert.equal(request.paused_until, undefined);
  assert.equal(request.next_due_at, undefined);
  assert.equal(request.pause_hours, undefined);
  assert.equal(reminderRequest(draft, "en", 0).pause_hours, 0);
});
