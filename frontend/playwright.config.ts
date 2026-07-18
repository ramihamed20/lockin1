import { defineConfig, devices } from "@playwright/test";

const usesExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true";
const serverUrl = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
);
if (
  serverUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(serverUrl.hostname) ||
  !/^\d+$/.test(serverUrl.port)
) {
  throw new Error("PLAYWRIGHT_BASE_URL must be an explicit local HTTP URL with a port.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./output/playwright/results",
  reporter: [["list"], ["html", { outputFolder: "./output/playwright/report", open: "never" }]],
  use: {
    baseURL: serverUrl.origin,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ],
  ...(usesExternalServer
    ? {}
    : {
        webServer: {
          command:
            `"${process.execPath}" ./node_modules/vite/bin/vite.js preview --configLoader runner --host ${serverUrl.hostname} --port ${serverUrl.port} --strictPort`,
          url: serverUrl.origin,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      })
});
