import { defineConfig, devices } from "@playwright/test";

// CI installs Chromium only, so the Safari gate is opt-in and runs on request:
// `npx playwright test --project=webkit-focus`.
const webkitRequested = process.env.PLAYWRIGHT_WEBKIT === "1"
  || process.argv.some((argument) => argument.includes("webkit-focus"));
const externalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";
// Test workers reload this config in child processes that do not receive the
// original CLI arguments, so the choice is published through the environment.
if (webkitRequested) process.env.PLAYWRIGHT_WEBKIT = "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  projects: webkitRequested
    ? [
      // Safari drives the iPad and iPhone experience and diverges from Chromium
      // on touch, pointer capture, canvas blending, and animation frame rates,
      // so the Focus Workspace specs also run on WebKit.
      //
      // Tests tagged @chromium-only navigate to the workspace more than once.
      // Playwright cannot keep a mocked API alive across a second navigation of
      // a service-worker controlled page on WebKit, which is a limitation of the
      // harness rather than of the workspace.
      { name: "webkit-focus", testMatch: /focus-.*\.spec\.js/, grepInvert: /@chromium-only/, use: { ...devices["Desktop Safari"] } }
    ]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
  webServer: externalServer ? undefined : {
    command: "node scripts/serve-dist.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
