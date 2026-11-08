import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const testsDir = join(root, "tests");
// Deferred-feature unit tests remain in the repository for a later release.
// Keep shared PDF reader, Review, authentication, and public-access tests.
const deferred = /^(?:knowledge-.*|connected-learning|lock-in-.*)\.test\.js$/;
const suites = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js") && !deferred.test(name))
  .sort()
  .map((name) => join(testsDir, name));
if (!suites.length) throw new Error("No active release unit tests");
const result = spawnSync(process.execPath, ["--test", ...suites], { stdio: "inherit" });
process.exit(result.status ?? 1);
