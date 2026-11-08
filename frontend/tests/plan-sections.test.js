import assert from "node:assert/strict";
import test from "node:test";
import { nextSession, subjectSections, taskDestination } from "../src/studyPlan/sections.js";

test("task links preserve sheet, edition, range and question identity", () => {
  const url = "/questions/categories/anatomy?plan_item=task-1&edition=lockin";
  assert.equal(taskDestination({ start_url: url, subject: "Anatomy" }, []), url);
  assert.equal(taskDestination({ subject: " anatomy " }, [{ title: "Anatomy", slug: "human anatomy" }]), "/materials/catalog/human%20anatomy");
  assert.equal(taskDestination({ subject: "Unknown" }, []), "/materials");
});
test("next session is chronological and does not reorder input", () => {
  const items = [
    { id: "tomorrow", status: "planned", scheduled_date: "2026-11-02" },
    { id: "done", status: "completed", scheduled_date: "2026-11-01" },
    { id: "late", status: "planned", scheduled_date: "2026-10-31" },
    { id: "today", status: "planned", scheduled_date: "2026-11-01" }
  ];
  assert.equal(nextSession(items, "2026-11-01").id, "today");
  assert.equal(items[0].id, "tomorrow");
  assert.equal(nextSession([], "2026-11-01"), null);
});
test("subjects merge casing, retain completed work and isolate overdue work", () => {
  const item = { id: "a", subject: " anatomy ", status: "completed" };
  const late = { id: "b", subject: "Anatomy", status: "planned" };
  const groups = subjectSections(["Anatomy", "Physiology"], [item, item, late], [late], [{ title: "Anatomy", slug: "anatomy" }]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].items, [item]);
  assert.deepEqual(groups[0].overdue, [late]);
  assert.equal(groups[0].material.slug, "anatomy");
  assert.equal(groups[1].items.length, 0);
});
