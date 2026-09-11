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
