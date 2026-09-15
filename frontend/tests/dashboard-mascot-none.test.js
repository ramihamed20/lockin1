import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Dashboard omits the mascot column rather than rendering an empty preview", async () => {
  const source = await readFile(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(source, /const hasMascot = themeSettings\.character !== "none"/);
  assert.match(source, /dashboard-main--no-mascot/);
  assert.match(source, /\{hasMascot && <div className="dashboard-right">/);
  assert.match(styles, /\.dashboard-main--no-mascot\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});

test("the dawn and sunset scenes are framed a little closer, and no other theme moves", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  // One knob, read by every rule that transforms the scene, so a per-theme
  // zoom is not cancelled by the hover rule.
  assert.match(styles, /transform: scale\(var\(--scene-zoom, 1\)\)/);
  assert.match(styles, /:root\[data-theme="dawn"\] \.scene-card,\s*\n:root\[data-theme="sunset"\] \.scene-card \{\s*\n\s*--scene-zoom: 1\.1;/);
  // Centred on the cat rather than the middle of the room.
  assert.match(styles, /--scene-zoom-origin: 56% 64%;/);
  // Hover reads the same value instead of resetting it to none.
  assert.match(styles, /\.scene-card:hover:where\(html\.ix-hover \*\) \.scene-theme \{\s*\n\s*transform: scale\(var\(--scene-zoom, 1\)\);/);
  // Day and night are never given a zoom, so they render exactly as before.
  assert.doesNotMatch(styles, /data-theme="(day|night)"\] \.scene-card \{[^}]*--scene-zoom/);
});
