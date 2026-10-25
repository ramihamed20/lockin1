import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "../src/lib/i18n.js";
import { dayWorkload, rebaseTaskDraft, DEFAULT_STUDY_DAYS, addDays, dayState, materialFor, toggleSubject, weekDays, weekOf, weekProgress, profileDraft, profileRequest } from "../src/studyPlan/model.js";
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
  draft.subjects = " Anatomy، Physiology,  \n Pathology , anatomy";
  const request = profileRequest(draft);
  assert.deepEqual(request.subjects, ["A", "Anatomy", "Physiology", "Pathology"]);
  assert.equal("subjectList" in request, false);
  assert.equal(draft.timezone, profile.timezone);
  draft.weekdays.push(4);
  assert.deepEqual(profile.weekdays, [0, 2]);
});

test("a new plan leaves Friday free and never sends more than twelve subjects", () => {
  const draft = profileDraft({ configured: false, mode: "custom", weekdays: [0, 1, 2, 3, 4], subjects: [], timezone: "UTC", daily_minutes: 60, session_minutes: 25 });
  assert.deepEqual(draft.weekdays, DEFAULT_STUDY_DAYS);
  assert.equal(draft.weekdays.includes(4), false);
  draft.subjectList = Array.from({ length: 11 }, (_, index) => `S${index}`);
  draft.subjects = "Extra, Another";
  assert.equal(profileRequest(draft).subjects.length, 12);
});

test("subject chips toggle without case duplicates and match catalog materials", () => {
  const chosen = toggleSubject(["Anatomy"], "anatomy");
  assert.deepEqual(chosen, []);
  assert.deepEqual(toggleSubject(chosen, "Histology"), ["Histology"]);
  const materials = [{ slug: "oral-histology", title: "Oral Histology" }];
  assert.equal(materialFor("oral histology ", materials)?.slug, "oral-histology");
  assert.equal(materialFor("", materials), null);
  assert.equal(materialFor("Physics", materials), null);
});

test("week progress and day state summarize self-reported completion", () => {
  assert.deepEqual(weekProgress({ planned_minutes: 100, completed_minutes: 25 }), { done: 25, total: 100, percent: 25 });
  assert.equal(weekProgress({ planned_minutes: 0, completed_minutes: 0 }).percent, 0);
  const items = [
    { scheduled_date: "2026-10-12", status: "completed" },
    { scheduled_date: "2026-10-13", status: "completed" },
    { scheduled_date: "2026-10-13", status: "planned" }
  ];
  assert.equal(dayState(items, "2026-10-12"), "done");
  assert.equal(dayState(items, "2026-10-13"), "planned");
  assert.equal(dayState(items, "2026-10-14"), "empty");
});

test("every new planner message is translated and interpolation works in both languages", () => {
  assert.deepEqual(Object.keys(studyPlanMessages.en).sort(), Object.keys(studyPlanMessages.ar).sort());
  for (const locale of ["en", "ar"]) {
    for (const key of Object.keys(studyPlanMessages[locale])) assert.notEqual(translate(locale, key), key);
    const label = translate(locale, "plan.beginnerProgress", { days: 3, minutes: 15 });
    assert.doesNotMatch(label, /\{days\}|\{minutes\}/);
  }
});


test("refreshing a task preserves dirty fields and adopts other server edits", () => {
  const previous = { title: "Read", subject: "Anatomy", scheduled_date: "2026-10-16", duration_minutes: 25 };
  const draft = { title: "My title", subject: "Anatomy", scheduledDate: "2026-10-16", durationMinutes: "25" };
  assert.deepEqual(rebaseTaskDraft(draft, previous, { ...previous, title: "Other title", duration_minutes: 40 }), {
    ...draft, durationMinutes: 40
  });
  assert.equal(draft.durationMinutes, "25");
});

test("daily budget retains completed time, isolates dates and exposes catch-up overload", () => {
  const profile = { configured: true, mode: "normal", daily_minutes: 60, weekdays: [0, 1, 2, 3, 5, 6] };
  const items = [
    { scheduled_date: "2026-10-25", duration_minutes: 25, status: "completed" },
    { scheduled_date: "2026-10-25", duration_minutes: 45, status: "planned" },
    { scheduled_date: "2026-10-26", duration_minutes: 60, status: "planned" }
  ];
  assert.deepEqual(dayWorkload(profile, items, "2026-10-25"), { available: 60, planned: 70, remaining: 0, overflow: 10 });
  assert.deepEqual(dayWorkload(profile, items, "2026-10-26"), { available: 60, planned: 60, remaining: 0, overflow: 0 });
  assert.equal(items[0].status, "completed");
});

test("rest days have no capacity and modes without availability do not invent one", () => {
  const profile = { configured: true, mode: "normal", daily_minutes: 120, weekdays: [0] };
  const items = [{ scheduled_date: "2026-10-23", duration_minutes: 15, status: "planned" }];
  assert.deepEqual(dayWorkload(profile, items, "2026-10-23"), { available: 0, planned: 15, remaining: 0, overflow: 15 });
  assert.deepEqual(dayWorkload(profile, [], "2026-10-26"), { available: 120, planned: 0, remaining: 120, overflow: 0 });
  for (const mode of ["beginning", "custom"]) assert.equal(dayWorkload({ ...profile, mode }, items, "2026-10-23"), null);
  assert.equal(dayWorkload({ ...profile, configured: false }, items, "2026-10-23"), null);
});
