import { defineConfig, devices } from "@playwright/test";

const usesExternalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./output/playwright/results",
  reporter: [["list"], ["html", { outputFolder: "./output/playwright/report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
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
            `"${process.execPath}" ./node_modules/vite/bin/vite.js preview --configLoader runner --host 127.0.0.1 --port 5173 --strictPort`,
          url: "http://127.0.0.1:5173",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      })
});
