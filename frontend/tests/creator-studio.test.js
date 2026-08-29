import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/pages/OperationsAdmin.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/pages/creator-studio.css", import.meta.url), "utf8");

test("Creator Studio exposes the unified operational information architecture", () => {
  for (const area of ["Overview", "Students", "Subscriptions", "Content", "Questions", "Analytics", "Notifications", "Activity", "System", "Settings"]) {
    assert.match(page, new RegExp(`\\"${area}\\"`));
  }
  assert.match(page, /CreatorStudioHeader/);
  assert.match(page, /creator-global-search/);
});

test("overview uses stored analytics without fake metric fallbacks", () => {
  assert.match(page, /analytics\.users\.online_now/);
  assert.match(page, /analytics\.learning\.focus_sessions_today/);
  assert.match(page, /analytics\.learning\.focus_activity/);
  assert.match(page, /overview\.queues/);
  assert.doesNotMatch(page, /Math\.random|mockMetric|fakeMetric/);
});

test("Creator Studio is responsive and keeps wide data inside bounded containers", () => {
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /\.creator-table-wrap[\s\S]*overflow-x: auto/);
  assert.match(styles, /prefers-reduced-motion/);
});
