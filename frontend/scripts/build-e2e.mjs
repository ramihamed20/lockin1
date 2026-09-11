/**
 * Build the bundle the browser tests run against.
 *
 * Identical to `npm run build` except that `LOCKIN_E2E_CATALOG=1` compiles in
 * the fixture catalogue sheets from `e2e/fixtures/catalog.js`. Everything else
 * -- the reader, the workspace, persistence, the service worker -- is the same
 * production code, so the specs still exercise what ships.
 *
 * A separate script rather than an env var typed at the call site: this must be
 * impossible to run by accident when someone means `npm run build`, and the
 * guard below makes the resulting `dist/` self-identifying.
 *
 * The fixture PDFs are not copied into `dist/`. They are served from
 * `e2e/fixtures/pdf/` by `scripts/serve-dist.mjs`, the test-only static server.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const fixtures = resolve(frontendRoot, "e2e/fixtures/pdf");

if (!existsSync(fixtures)) {
  console.error("Reader fixtures are missing. Run: npm run fixtures:pdf");
  process.exit(1);
}

const result = spawnSync("npx", ["vite", "build"], {
  cwd: frontendRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, LOCKIN_E2E_CATALOG: "1" }
});

if (result.status !== 0) process.exit(result.status ?? 1);

console.warn(
  "\nBuilt with E2E catalogue fixtures. This dist/ is for tests only and must not be deployed."
);
