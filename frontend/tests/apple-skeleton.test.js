import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("native-style skeletons are loaded globally, after legacy styles", async () => {
  const main = await read("../src/main.jsx");
  const legacy = main.indexOf('import "./styles/v2.css";');
  const native = main.indexOf('import "./styles/apple-skeleton.css";');
  assert.ok(legacy >= 0 && native > legacy, "shared skeleton styling loads after the old views");
});

test("all four themes use the same semantic placeholder palette", async () => {
  const css = await read("../src/styles/apple-skeleton.css");
  assert.match(css, /@layer system\s*\{/);
  assert.match(css, /--loading-fill:\s*color-mix\(in srgb, var\(--text\) 8%, var\(--surface\)\)/);
  assert.match(css, /\.skeleton \{[^}]*background-image: none;/);
  assert.match(css, /@keyframes lockin-skeleton-breathe/);
  assert.doesNotMatch(css, /linear-gradient\(/, "no sweeping shimmer gradients");
});

test("reduced-motion readers see stable skeletons", async () => {
  const css = await read("../src/styles/apple-skeleton.css");
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.loading-panel \{ animation: none; \}/);
  assert.match(reduced, /animation: none;/);
});

test("route loading uses real screen silhouettes, not a single generic spinner", async () => {
  const ui = await read("../src/components/ui/index.jsx");
  for (const kind of ["dashboard", "review", "study-plan", "notifications", "lock-in", "profile", "progress", "document", "sheet-library"]) {
    assert.ok(ui.includes(`variant === "${kind}"`), `${kind} has a structural skeleton`);
  }
  assert.match(ui, /data-skeleton-system="cupertino"/);
  assert.match(ui, /role="status"/);
  assert.match(ui, /if \(\/\^\\\/review/);
});

test("student screens and dashboard no longer show fake empty states while loading", async () => {
  const paths = [
    ["../src/pages/Notifications.jsx", 'variant="notifications"'],
    ["../src/pages/StudyPlan.jsx", 'variant="study-plan"'],
    ["../src/pages/LockInMode.jsx", 'variant="lock-in"'],
    ["../src/pages/Review.jsx", 'variant="review"']
  ];
  for (const [path, variant] of paths) assert.ok((await read(path)).includes(variant), path);
  const dash = await read("../src/pages/Dashboard.jsx");
  assert.match(dash, /recentStudy\.loading && !recentStudy\.data/);
  assert.match(dash, /continue-card--loading/);
  assert.match(dash, /dashboard-review-loading/);
  assert.match(dash, /skeleton-dash-stat-number/);
});
