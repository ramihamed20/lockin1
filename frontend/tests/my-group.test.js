import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canAccessRoute } from "../src/lib/authz.js";
import { translate } from "../src/lib/i18n.js";
import {
  SUBJECT_KEYS,
  clockLabel,
  draftFromPreferences,
  practicalChoices,
  sessionsByDay,
  slotLabel,
  timetableGrid,
  timetableRows,
  withPracticalChoice
} from "../src/lib/myGroup.js";

const en = (key) => translate("en", key);
const ar = (key) => translate("ar", key);

test("students can open the My Group timetable route", () => {
  assert.equal(canAccessRoute({ id: "s", roles: ["student"] }, "/my-group"), true);
});

test("time slots use localized AM/PM and keep Latin digits", () => {
  assert.equal(slotLabel(en, { start_time: "08:00", end_time: "10:00" }), "8:00 AM – 10:00 AM");
  assert.equal(slotLabel(en, { start_time: "10:00", end_time: "12:00" }), "10:00 AM – 12:00 PM");
  assert.equal(slotLabel(ar, { start_time: "12:00", end_time: "14:00" }), "12:00 م – 2:00 م");
  assert.equal(clockLabel(ar, "08:00"), "8:00 ص");
});

test("every subject and day has one name per language, never both", () => {
  for (const subject of SUBJECT_KEYS) {
    const english = en(`myGroup.subject.${subject}`);
    const arabic = ar(`myGroup.subject.${subject}`);
    assert.doesNotMatch(english, /[؀-ۿ]/);
    assert.match(arabic, /[؀-ۿ]/);
    assert.doesNotMatch(arabic, /[A-Za-z]/);
  }
  assert.equal(en("myGroup.title"), "My Group");
  assert.equal(ar("myGroup.title"), "مجموعتي");
  assert.equal(ar("myGroup.subject.conservative_endodontics_1"), "العلاج التحفظي وعلاج الجذور 1");
  assert.equal(ar("myGroup.day.monday"), "الإثنين");
});

test("resolved sessions land in their day and slot cells", () => {
  const timetable = {
    days: ["sunday", "monday"],
    slots: [{ start_time: "08:00", end_time: "10:00" }, { start_time: "10:00", end_time: "12:00" }],
    sessions: [
      { kind: "theory", subject: "general_pathology", day: "sunday", start_time: "08:00" },
      { kind: "practical", subject: "pharmacology", day: "sunday", start_time: "08:00" },
      { kind: "practical", subject: "microbiology", day: "monday", start_time: "10:00" }
    ]
  };
  const grid = timetableGrid(timetable);
  assert.deepEqual(grid[0][0].map((s) => s.subject), ["general_pathology", "pharmacology"]);
  assert.equal(grid[0][1].length, 0);
  assert.deepEqual(grid[1][1].map((s) => s.subject), ["microbiology"]);
});

test("a subject override applies alone and choosing the default removes it", () => {
  const draft = draftFromPreferences({ theory_group: "A", default_practical_group: "C1", practical_overrides: {} });
  const overridden = withPracticalChoice(draft, "pharmacology", { scheduleSet: "B", practicalGroup: "C1" });
  const choices = practicalChoices(overridden);
  assert.deepEqual(choices.pharmacology, { scheduleSet: "B", practicalGroup: "C1" });
  assert.deepEqual(choices.microbiology, { scheduleSet: "A", practicalGroup: "C1" });
  const reverted = withPracticalChoice(overridden, "pharmacology", { scheduleSet: "A", practicalGroup: "C1" });
  assert.deepEqual(reverted.practicalOverrides, {});
});

test("the My Group card sits directly below the Review queue on the Dashboard", async () => {
  const source = await readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
  assert.match(source, /<ReviewQueue items=\{reviewItems\} \/>\s*<MyGroupCard \/>/);
});

const SLOTS = [["08:00", "10:00"], ["10:00", "12:00"], ["12:00", "14:00"], ["14:00", "16:00"]].map(([start_time, end_time]) => ({ start_time, end_time }));

test("a lecture across two slots spans them and keeps its own time", () => {
  // Year 1, Theory A + Practical C, Tuesday: 09:00–12:00 anatomy, then two practicals.
  const timetable = {
    days: ["tuesday"],
    slots: SLOTS,
    sessions: [
      { kind: "practical", subject: "dental_materials", day: "tuesday", start_time: "12:00", end_time: "14:00" },
      { kind: "theory", subject: "general_anatomy", day: "tuesday", start_time: "09:00", end_time: "12:00" },
      { kind: "practical", subject: "physiology", day: "tuesday", start_time: "14:00", end_time: "16:00" }
    ]
  };
  const [{ cells }] = timetableRows(timetable);
  assert.deepEqual(cells.map((cell) => [cell.slotIndex, cell.span, cell.sessions.map((s) => s.subject)]), [
    [0, 2, ["general_anatomy"]],
    [2, 1, ["dental_materials"]],
    [3, 1, ["physiology"]]
  ]);
  assert.equal(cells[0].sessions[0].offSlot, true);
  assert.equal(cells[1].sessions[0].offSlot, false);
  assert.equal(slotLabel(en, cells[0].sessions[0]), "9:00 AM – 12:00 PM");
});

test("regular two-hour sessions keep one cell per slot and empty slots stay empty", () => {
  const [{ cells }] = timetableRows({
    days: ["sunday"],
    slots: SLOTS,
    sessions: [{ kind: "theory", subject: "histology", day: "sunday", start_time: "10:00", end_time: "12:00" }]
  });
  assert.deepEqual(cells.map((cell) => [cell.span, cell.sessions.length]), [[1, 0], [1, 1], [1, 0], [1, 0]]);
});

test("the day list is chronological with theory first in a shared slot", () => {
  const [monday] = sessionsByDay({
    days: ["monday"],
    slots: SLOTS,
    sessions: [
      { kind: "theory", subject: "dental_materials", day: "monday", start_time: "14:00", end_time: "16:00" },
      { kind: "practical", subject: "general_anatomy", day: "monday", start_time: "12:00", end_time: "14:00" },
      { kind: "practical", subject: "x", day: "monday", start_time: "08:00", end_time: "10:00" },
      { kind: "theory", subject: "dental_anatomy", day: "monday", start_time: "08:00", end_time: "10:00" }
    ]
  });
  assert.deepEqual(monday.sessions.map((s) => `${s.start_time} ${s.kind}`), ["08:00 theory", "08:00 practical", "12:00 practical", "14:00 theory"]);
});

test("Year 1 subjects have their official names in both languages", () => {
  const names = {
    general_anatomy: ["General Anatomy", "التشريح العام"],
    histology: ["Histology", "علم الأنسجة"],
    physiology: ["Physiology", "علم وظائف الأعضاء"],
    biochemistry: ["Biochemistry", "الكيمياء الحيوية"],
    dental_materials: ["Dental Materials", "خواص مواد الأسنان"],
    dental_anatomy: ["Dental Anatomy", "التشريح الوصفي للأسنان"]
  };
  for (const [subject, [english, arabic]] of Object.entries(names)) {
    assert.equal(en(`myGroup.subject.${subject}`), english);
    assert.equal(ar(`myGroup.subject.${subject}`), arabic);
  }
});
