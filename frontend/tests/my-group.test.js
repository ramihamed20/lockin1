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
  slotLabel,
  timetableGrid,
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
