import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  ...base,
  testMatch: ["public-search.spec.js", "public-knowledge-settings.spec.js"],
  workers: 2,
  projects: [
    { name: "public-desktop", use: { ...devices["Desktop Chrome"], channel: "chromium" } },
    { name: "public-iphone-safari", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "public-ipad-safari", use: { ...devices["iPad Pro 11"], browserName: "webkit" } }
  ]
});
