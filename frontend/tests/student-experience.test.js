import assert from "node:assert/strict";
import test from "node:test";
import { activityCalendar } from "../src/lib/progressCalendar.js";
import { recentStudyEntries } from "../src/lib/recentStudy.js";
import { experienceMessages } from "../src/lib/experienceMessages.js";
import { translate } from "../src/lib/i18n.js";

const calendar = { start: "2026-10-05", today: "2026-10-26", qualified_days: ["2020-01-01", "2026-10-05", "2026-10-26", "2026-10-26", "2026-10-27"] };
const format = value => value.toISOString().slice(0, 10);

test("calendar counts only distinct qualified days inside the displayed elapsed period", () => {
  const result = activityCalendar(calendar, "2026-10-26", key => key, format);
  assert.equal(result.activeDays, 2);
  assert.equal(result.elapsedDays, 22);
  assert.equal(result.consistencyRate, 9);
  assert.equal(result.cells[0].days[0].state, "qualified");
  assert.equal(result.cells[0].days[1].state, "future");
  assert.equal(result.cells[3].days[0].key, "2026-10-05");
});

test("missing calendar evidence never manufactures zero activity from XP transactions", () => {
  assert.equal(activityCalendar(null, null, key => key, format), null);
  assert.equal(activityCalendar({ ...calendar, today: "bad" }, null, key => key, format), null);
});

test("another device resumes server history while newer unsynced local work stays first", () => {
  const server = [{ material_slug: "anatomy", material_title: "Anatomy", sheet_slug: "sheet-1", sheet_title: "Sheet 1", updated_at: "2026-10-25T10:00:00Z" }];
  assert.equal(recentStudyEntries(server)[0].path, "/materials/catalog/anatomy/sheets/sheet-1/workspace");
  const local = [{ path: "/materials/catalog/histology/sheets/new/workspace", openedAt: "2026-10-25T11:00:00Z" }];
  assert.equal(recentStudyEntries(server, local)[0].path, local[0].path);
  const duplicates = recentStudyEntries(server, [{ ...recentStudyEntries(server)[0], openedAt: "2026-10-25T12:00:00Z" }]);
  assert.equal(duplicates.length, 1);
});

test("every new experience message is translated in both production catalogues", () => {
  assert.deepEqual(Object.keys(experienceMessages.ar).sort(), Object.keys(experienceMessages.en).sort());
  for (const locale of ["ar", "en"]) for (const key of Object.keys(experienceMessages[locale])) assert.notEqual(translate(locale, key), key);
  assert.match(translate("ar", "settings.serverNotificationsHint"), /أمان/);
});
