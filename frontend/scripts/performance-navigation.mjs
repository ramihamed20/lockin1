import { verifyPerformanceBuild } from './fixtures/performance-build.mjs';
import { chromium, devices } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const baseURL = options.url || "http://127.0.0.1:4174";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) throw new Error("Local synthetic server required");
const runs = Math.max(3, Math.min(20, Number(options.runs) || 5));
const mobileNetwork = options.network === "mobile";
const output = resolve(options.output || "output/performance/navigation.json");
const measuredBuildSHA256 = await verifyPerformanceBuild(baseURL, options.artifactRoot || "output/performance/production-dist");
const browser = await chromium.launch({ headless: true });
const browserSession = await browser.newBrowserCDPSession();
const gpu = (await browserSession.send("SystemInfo.getInfo")).gpu;
await browserSession.detach();
const results = [];
try {
  for (let run = 0; run < runs; run++) {
    const context = await browser.newContext({ ...devices["Pixel 5"], serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [], apiRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/v1/")) apiRequests.push(path); });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Performance.enable");
    if (mobileNetwork) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 75000, connectionType: "cellular4g" });
    await page.addInitScript(() => {
      localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
      localStorage.setItem("lock-in.theme.settings", JSON.stringify({ theme: "night", autoTheme: false, character: "none", appIcon: "light" }));
      window.__navigationLab = { lcp: null, cls: 0, longTasks: [], interactions: [] };
      document.addEventListener("click", (event) => {
        const anchor = event.target?.closest?.("a");
        if (anchor?.getAttribute("href") === window.__navigationLab.expectedRoute) {
          window.__navigationLab.routeClickAt = performance.now();
          performance.mark("lockin-route-click");
        }
      }, true);
      let clusterStart = 0, clusterEnd = 0, clusterValue = 0;
      for (const [type, save] of [
        ["largest-contentful-paint", (entry) => { window.__navigationLab.lcp = entry.startTime; window.__navigationLab.lcpElement = { tag: entry.element?.tagName, className: String(entry.element?.className || ""), size: entry.size }; }],
        ["layout-shift", (entry) => {
          if (entry.hadRecentInput) return;
          if (entry.startTime - clusterEnd > 1000 || entry.startTime - clusterStart > 5000) { clusterStart = entry.startTime; clusterValue = 0; }
          clusterEnd = entry.startTime; clusterValue += entry.value;
          window.__navigationLab.cls = Math.max(window.__navigationLab.cls, clusterValue);
        }],
        ["longtask", (entry) => window.__navigationLab.longTasks.push({ start: entry.startTime, duration: entry.duration })],
        ["event", (entry) => { if (entry.interactionId) window.__navigationLab.interactions.push({ type: entry.name, duration: entry.duration, interactionId: entry.interactionId }); }]
      ]) {
        try { new PerformanceObserver((list) => list.getEntries().forEach(save)).observe({ type, buffered: true, durationThreshold: 16 }); } catch { /* unavailable observer */ }
      }
    });
    async function settled() {
      await page.evaluate(async () => { await document.fonts.ready; await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); });
    }
    async function snapshot() {
      return page.evaluate(() => ({ ...window.__navigationLab, navigation: performance.getEntriesByType("navigation")[0]?.toJSON(), resources: performance.getEntriesByType("resource").map((entry) => ({ path: new URL(entry.name).pathname, type: entry.initiatorType, start: entry.startTime, duration: entry.duration, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize })) }));
    }
    try {
      const cpuCalibration = await page.evaluate(() => { const start = performance.now(); let value = 0; for (let index = 0; index < 500000; index++) value = Math.imul(value ^ index, 1664525); return { durationMs: performance.now() - start, value }; });
      let started = Date.now();
      await page.goto(baseURL + "/#/dashboard", { waitUntil: "domcontentloaded" });
      await page.locator(".continue-card a").waitFor({ timeout: 45000 });
      await settled();
      const coldStudyNavigationMs = Date.now() - started;
      await page.locator('.dashboard-layout:has(.dash-states:not([aria-busy="true"]))').waitFor({ timeout: 45000 });
      await settled();
      const coldReadyMs = Date.now() - started;
      await page.waitForTimeout(700);
      const cold = await snapshot();
      started = Date.now();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".continue-card a").waitFor({ timeout: 45000 });
      await settled();
      const warmStudyNavigationMs = Date.now() - started;
      await page.locator('.dashboard-layout:has(.dash-states:not([aria-busy="true"]))').waitFor({ timeout: 45000 });
      await settled();
      const warmReadyMs = Date.now() - started;
      await page.waitForTimeout(700);
      const warm = await snapshot();
      const routes = [];
      if (options.cpuProfile === "1") { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
      if (options.routeTrace === "1") await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing", transferMode: "ReturnAsStream" });
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const [name, target, ready] of [
          ["materials", "/materials", "#cohort-materials-heading"],
          ["subject", "/materials/catalog/perf-subject-1", "#catalog-subject-heading"],
          ["sheet", "/materials/catalog/perf-subject-1/sheets/sheet-1", "#catalog-sheet-heading"],
          ["materials-return", "/materials", "#cohort-materials-heading"],
          ["dashboard-return", "/", '.dashboard-layout:has(.dash-states:not([aria-busy="true"]))']
        ]) {
          const link = page.locator(`a[href="#${target}"]:visible`).first();
          const requestedAt = await page.evaluate((target) => {
            window.__navigationLab.expectedRoute = "#" + target;
            window.__navigationLab.routeClickAt = null;
            return performance.now();
          }, target);
          started = Date.now();
          await link.click();
          await page.waitForURL((url) => url.hash === "#" + target);
          // Observe real continuation usability independently, without delaying
          // the existing complete-data milestone or changing its definition.
          const studyReady = name === "dashboard-return"
            ? page.locator(".continue-card a").waitFor().then(settled).then(() => page.evaluate(() => performance.now()))
            : null;
          await page.locator(ready).waitFor();
          await settled();
          const readyMs = Date.now() - started;
          const clickTiming = await page.evaluate((requestedAt) => {
            const clickAt = window.__navigationLab.routeClickAt;
            performance.mark("lockin-route-ready");
            return { clickAt, readyAt: performance.now(), actionWaitMs: clickAt === null ? null : clickAt - requestedAt, clickToReadyMs: clickAt === null ? null : performance.now() - clickAt };
          }, requestedAt);
          const studyReadyAt = studyReady ? await studyReady : null;
          routes.push({ name, cycle, readyMs, ...clickTiming, studyNavigationClickToReadyMs: studyReadyAt === null || clickTiming.clickAt === null ? null : studyReadyAt - clickTiming.clickAt });
        }
      }
      let routeTrace = null;
      if (options.routeTrace === "1") {
        const complete = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
        await cdp.send("Tracing.end");
        const { stream } = await complete;
        let trace = "";
        while (true) {
          const part = await cdp.send("IO.read", { handle: stream });
          trace += part.data;
          if (part.eof) break;
        }
        await cdp.send("IO.close", { handle: stream });
        await mkdir(resolve(output, ".."), { recursive: true });
        routeTrace = output.replace(/\.json$/, "") + "-route-trace-" + run + ".json";
        await writeFile(routeTrace, trace);
      }
      let cpuProfile = null;
      if (options.cpuProfile === "1") {
        const { profile } = await cdp.send("Profiler.stop");
        cpuProfile = output.replace(/\.json$/, "") + "-cpu-" + run + ".json";
        await writeFile(cpuProfile, JSON.stringify(profile));
      }
      results.push({ run, cpuProfile, routeTrace, cpuCalibration, coldReadyMs, warmReadyMs, coldStudyNavigationMs, warmStudyNavigationMs, cold, warm, routes, routeResources: (await snapshot()).resources, interactions: (await snapshot()).interactions, apiRequests, errors });
      console.log(JSON.stringify({ run, coldReadyMs, warmReadyMs, lcp: cold.lcp, cls: cold.cls, errors }));
    } finally { await context.close(); }
  }
} finally {
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify({ schema: 2, date: new Date().toISOString(), sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), buildIndexSha256: measuredBuildSHA256, environment: { build: options.build || "ordinary production", variant: options.variant || "current", readyDefinition: "readyMs waits for all six fresh dashboard requests; studyNavigationMs waits for usable local continuation link", artifactRoot: options.artifactRoot || "output/performance/production-dist", browser: browser.version(), device: "Playwright Pixel 5 emulation", cpuRate: 4, network: mobileNetwork ? "1.6Mbps down / 0.6Mbps up / 150ms latency CDP" : "localhost without throttle", server: options.server || "ordinary production build, Node gzip text/immutable assets; synthetic HTTP APIs; no API routing", cpuProfile: options.cpuProfile === "1", routeTrace: options.routeTrace === "1", serviceWorker: "blocked", installPrompt: "already dismissed", graphics: gpu.featureStatus, renderer: gpu.auxAttributes.glRenderer, runs }, results }, null, 2));
  await browser.close();
}
