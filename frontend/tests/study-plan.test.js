import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "../src/lib/i18n.js";
import { addDays, weekDays, weekOf, profileDraft, profileRequest } from "../src/studyPlan/model.js";
import { studyPlanMessages } from "../src/lib/studyPlanMessages.js";

test("planner calendar crosses months and years without shifting week boundaries", () => {
  assert.equal(weekOf("2027-01-01"), "2026-12-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(weekDays("2026-10-12").at(-1), "2026-10-18");
});

test("plan preferences preserve the account timezone and normalize Arabic subject separators", () => {
  const profile = { configured: true, mode: "normal", weekdays: [0, 2], subjects: ["A"], timezone: "Africa/Tripoli", daily_minutes: 60, session_minutes: 25 };
  const draft = profileDraft(profile);
  draft.subjects = " Anatomy، Physiology,  \n Pathology ";
  assert.deepEqual(profileRequest(draft).subjects, ["Anatomy", "Physiology", "Pathology"]);
  assert.equal(draft.timezone, profile.timezone);
  draft.weekdays.push(4);
  assert.deepEqual(profile.weekdays, [0, 2]);
});

test("every new planner message is translated and interpolation works in both languages", () => {
  assert.deepEqual(Object.keys(studyPlanMessages.en).sort(), Object.keys(studyPlanMessages.ar).sort());
  for (const locale of ["en", "ar"]) {
    for (const key of Object.keys(studyPlanMessages[locale])) assert.notEqual(translate(locale, key), key);
    const label = translate(locale, "plan.beginnerProgress", { days: 3, minutes: 15 });
    assert.doesNotMatch(label, /\{days\}|\{minutes\}/);
  }
});
