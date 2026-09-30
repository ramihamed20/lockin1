import assert from "node:assert/strict";
import test from "node:test";
import { biweeklyApi } from "../src/api/biweekly.js";
import { countdownDays, groupHistory, periodLabel } from "../src/lib/biweekly.js";
import { canAccessRoute } from "../src/lib/authz.js";

test("countdown uses the exact closing timestamp", () => {
  assert.equal(countdownDays("2026-10-13T00:00:00Z", Date.parse("2026-10-07T00:00:00Z")), 6);
  assert.equal(countdownDays("2026-10-13T00:00:00Z", Date.parse("2026-10-13T00:00:00Z")), 0);
});

test("multiple 14-day periods remain visible within the same archive month", () => {
  const history = [
    { id: "second", period_start: "2026-10-13T00:00:00Z", period_end: "2026-10-27T00:00:00Z" },
    { id: "first", period_start: "2026-09-29T00:00:00Z", period_end: "2026-10-13T00:00:00Z" },
    { id: "older", period_start: "2026-09-15T00:00:00Z", period_end: "2026-09-29T00:00:00Z" }
  ];
  const groups = groupHistory(history, "en");
  assert.equal(groups[0].month, "October 2026");
  assert.deepEqual(groups[0].reports.map((row) => row.id), ["second", "first"]);
  assert.equal(groups[1].month, "September 2026");
  assert.match(periodLabel(history[0].period_start, history[0].period_end, "en"), /Oct 13, 2026.*Oct 26, 2026/);
});

test("student routes and owned PDF paths cover Analysis and Review history", () => {
  const student = { id: "student-1", roles: ["student"] };
  assert.equal(canAccessRoute(student, "/analysis"), true);
  assert.equal(canAccessRoute(student, "/analysis/report-id"), true);
  assert.equal(canAccessRoute(student, "/review/biweekly/report-id"), true);
  assert.equal(canAccessRoute(student, "/review/biweekly/report-id/test"), true);
  assert.equal(biweeklyApi.pdfUrl("analysis", "old-id"), "/api/v1/biweekly/analysis/old-id/pdf");
  assert.equal(biweeklyApi.pdfUrl("review", "old-id", true), "/api/v1/biweekly/review/old-id/pdf?preview=1");
});
