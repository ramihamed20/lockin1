import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../src/pages/OperationsAdmin.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/pages/creator-studio.css", import.meta.url), "utf8");

const areas = await readFile(new URL("../src/lib/studioAreas.js", import.meta.url), "utf8");

test("Creator Studio exposes the unified operational information architecture", () => {
  assert.match(page, /const TABS = STUDIO_AREAS;/);
  for (const area of ["Overview", "Students", "Subscriptions", "Content", "Questions", "Analytics", "Notifications", "Activity", "System", "Settings"]) {
    assert.match(areas, new RegExp(`\\"${area}\\"`));
  }
  // One navigation: the app sidebar carries the Studio areas, and each area
  // opens with a breadcrumbed header instead of a second rail and top bar.
  assert.match(page, /function StudioHeader/);
  assert.match(page, /className="ui-breadcrumb"/);
  assert.doesNotMatch(page, /creator-studio-rail|operations-mobile-selector/);
});

test("overview uses stored analytics without fake metric fallbacks", () => {
  assert.match(page, /analytics\.users\.online_now/);
  assert.match(page, /analytics\.learning\.focus_sessions_today/);
  assert.match(page, /analytics\.learning\.focus_activity/);
  assert.match(page, /overview\.queues/);
  assert.doesNotMatch(page, /Math\.random|mockMetric|fakeMetric/);
});

test("Creator Studio is responsive and keeps wide data inside bounded containers", () => {
  // The studio sits beside the product sidebar, so it responds to its own
  // width (a size container), not to the viewport.
  assert.match(page, /className="creator-studio-frame"/);
  assert.match(styles, /\.creator-studio-frame \{ container: studio \/ inline-size;/);
  for (const width of [1099, 939, 699, 479]) {
    assert.match(styles, new RegExp(`@container studio \\(max-width: ${width}px\\)`));
  }
  assert.doesNotMatch(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.creator-table-wrap[\s\S]*overflow-x: auto/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("payment and subscription queues become labelled records instead of sideways tables", () => {
  assert.match(styles, /@container studio \(max-width: 819px\) \{\n  \.ops-table-scroll \{ overflow-x: visible;/);
  assert.match(styles, /\.ops-table td::before \{ content: attr\(data-label\)/);
  for (const console of ["PaymentsConsole", "SubscriptionsConsole"]) {
    const source = readFileSync(new URL(`../src/pages/admin/${console}.jsx`, import.meta.url), "utf8");
    for (const label of ["Status", "Plan"]) assert.match(source, new RegExp(`data-label="${label}"`));
  }
});
