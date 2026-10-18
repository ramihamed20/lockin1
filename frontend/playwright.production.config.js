import { defineConfig, devices } from "@playwright/test";

const webkitRequested = process.env.PLAYWRIGHT_PRODUCTION_WEBKIT === "1"
  || process.argv.some((argument) => argument.includes("webkit-production"));
if (webkitRequested) process.env.PLAYWRIGHT_PRODUCTION_WEBKIT = "1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4174";

export default defineConfig({
  testDir: "./production-e2e", fullyParallel: false, retries: 0,
  use: { serviceWorkers: "block", baseURL },
  projects: webkitRequested
    ? [{ name: "webkit-production", use: { ...devices["Desktop Safari"] } }]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1" ? undefined : {
    command: "node scripts/serve-production-benchmark.mjs", url: baseURL,
    reuseExistingServer: !process.env.CI, timeout: 120000
  }
});
