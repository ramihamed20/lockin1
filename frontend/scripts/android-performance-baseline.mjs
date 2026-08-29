import { chromium, devices } from "@playwright/test";

const baseURL = process.env.PERF_BASE_URL || "http://127.0.0.1:4173";
const diagnosticMode = process.argv.includes("--diagnostic-effects-off");
const staticChromeMode = process.argv.includes("--diagnostic-static-chrome");
const standaloneMode = process.argv.includes("--standalone");
const screenshotOnly = process.argv.includes("--screenshot-only");
const tabletMode = process.argv.includes("--tablet");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...(tabletMode ? {
    viewport: { width: 834, height: 1194 },
    screen: { width: 834, height: 1194 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36"
  } : devices["Pixel 5"]),
  serviceWorkers: "block",
  reducedMotion: "no-preference"
});
const page = await context.newPage();
const session = await context.newCDPSession(page);

await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await session.send("Performance.enable");

await page.addInitScript(({ standalone }) => {
  localStorage.setItem("lock-in.theme.settings", JSON.stringify({
    theme: "night",
    autoTheme: false,
    character: "black",
    appIcon: "light"
  }));
  if (!standalone) return;
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const result = nativeMatchMedia(query);
    if (query !== "(display-mode: standalone)") return result;
    return {
      ...result,
      matches: true,
      media: query,
      onchange: null,
      addListener: result.addListener?.bind(result),
      removeListener: result.removeListener?.bind(result),
      addEventListener: result.addEventListener.bind(result),
      removeEventListener: result.removeEventListener.bind(result),
      dispatchEvent: result.dispatchEvent.bind(result)
    };
  };
}, { standalone: standaloneMode });

await page.route("**/api/v1/**", async (route) => {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const path = pathname.replace(/\/$/, "");
  const json = (body, status = 200) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });

  if (path === "/api/v1/auth/session") {
    return json({
      user: {
        id: "android-perf-student",
        email: "android-perf@example.test",
        full_name: "Android Performance Student",
        preferred_language: "en",
        status: "active",
        is_email_verified: true,
        roles: ["student"],
        date_joined: "2026-01-01T00:00:00Z"
      }
    });
  }
  if (path === "/api/v1/operations/session") {
    return json({ error: { code: "permission_denied", message: "Student account" } }, 403);
  }
  if (path === "/api/v1/account/dashboard") {
    return json({ account: { active_sessions: 1 } });
  }
  if (path === "/api/v1/learning/dashboard") {
    return json({ completed_count: 14, bookmark_count: 8 });
  }
  if (path === "/api/v1/review-queue") {
    return json({ count: 4, next: null, previous: null, results: Array.from({ length: 4 }, (_, index) => ({
      id: `review-${index}`,
      prompt: `Clinical review question ${index + 1}: identify the relevant dental structure and the best next step.`,
      selected_answers: ["Previous answer"],
      correct_answers: ["Correct answer"],
      subject_key: "oral-histology",
      subject_label: "Oral Histology",
      source_label: "Practice quiz",
      source_question_index: index + 1,
      answered_at: "2026-08-23T12:00:00Z"
    })) });
  }
  if (path === "/api/v1/review-bank") {
    return json({ count: 4, active_count: 4, hidden_count: 0, subjects: [], results: [] });
  }
  if (path === "/api/v1/progression/streak") {
    return json({ current_streak: 7, longest_streak: 12 });
  }
  if (path === "/api/v1/notifications/summary") {
    return json({ unread_count: 0 });
  }
  if (request.method() === "GET") return json({ count: 0, next: null, previous: null, results: [] });
  return json({ error: { code: "not_found", message: `Unused performance fixture: ${request.method()} ${path}` } }, 404);
});

await page.goto(`${baseURL}/#/dashboard`, { waitUntil: "networkidle" });
await page.locator(".dashboard-layout").waitFor({ state: "visible" });
await page.evaluate(async () => {
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

if (diagnosticMode) {
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      filter: none !important;
      box-shadow: none !important;
    }
    .topbar, .bottom-nav { background: var(--surface) !important; }
  ` });
}
if (staticChromeMode) {
  await page.addStyleTag({ content: `
    .topbar, .bottom-nav { position: static !important; }
  ` });
}

if (screenshotOnly) {
  const fileName = tabletMode ? "android-performance-tablet.png" : "android-performance-phone.png";
  await page.screenshot({ path: `output/playwright/${fileName}`, fullPage: true });
  console.log(`Saved output/playwright/${fileName}`);
  await browser.close();
  process.exit(0);
}

const startMetrics = await session.send("Performance.getMetrics");

await page.evaluate(() => {
  window.__androidPerfFrames = [];
  window.__androidPerfLongTasks = [];
  window.__androidPerfStartedAt = performance.now();
  let previous = performance.now();
  const frame = (now) => {
    window.__androidPerfFrames.push(now - previous);
    previous = now;
    if (window.__androidPerfFrames.length < 420) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__androidPerfLongTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ type: "longtask" });
    window.__androidPerfObserver = observer;
  } catch {
    // Long-task timing is not exposed in every Chromium execution mode.
  }
});

const scrollTarget = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
for (let index = 0; index < 4; index += 1) {
  await session.send("Input.synthesizeScrollGesture", {
    x: 195,
    y: 500,
    yDistance: index % 2 === 0 ? -Math.max(500, scrollTarget) : Math.max(500, scrollTarget),
    speed: 850,
    gestureSourceType: "touch",
    repeatCount: 1,
    repeatDelayMs: 80
  });
  await page.waitForTimeout(180);
}
await page.waitForTimeout(700);

const endMetrics = await session.send("Performance.getMetrics");
const start = Object.fromEntries(startMetrics.metrics.map(({ name, value }) => [name, value]));
const end = Object.fromEntries(endMetrics.metrics.map(({ name, value }) => [name, value]));
const deltaMetric = (name) => Number(((end[name] || 0) - (start[name] || 0)).toFixed(4));

const result = await page.evaluate(() => {
  window.__androidPerfObserver?.disconnect();
  const frames = window.__androidPerfFrames.slice(1);
  const sorted = [...frames].sort((a, b) => a - b);
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
  const elements = [...document.querySelectorAll("body *")];
  const expensive = elements.reduce((counts, element) => {
    const style = getComputedStyle(element);
    if (style.backdropFilter && style.backdropFilter !== "none") counts.backdrop += 1;
    if (style.filter && style.filter !== "none") counts.filter += 1;
    if (style.boxShadow && style.boxShadow !== "none") counts.shadow += 1;
    if (style.position === "fixed") counts.fixed += 1;
    if (style.position === "sticky") counts.sticky += 1;
    if (style.animationName && style.animationName !== "none") counts.animated += 1;
    return counts;
  }, { backdrop: 0, filter: 0, shadow: 0, fixed: 0, sticky: 0, animated: 0 });
  const resources = performance.getEntriesByType("resource");
  const navigation = performance.getEntriesByType("navigation")[0];
  const cssRuleCount = [...document.styleSheets].reduce((count, sheet) => {
    try { return count + sheet.cssRules.length; } catch { return count; }
  }, 0);
  return {
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    document: {
      elements: elements.length,
      height: document.documentElement.scrollHeight,
      cssStyleSheets: document.styleSheets.length,
      cssRuleCount,
      ...expensive
    },
    expensiveElements: elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${element.classList.length ? `.${[...element.classList].join(".")}` : ""}`,
        backdrop: style.backdropFilter,
        shadow: style.boxShadow,
        position: style.position,
        animation: style.animationName,
        animationDuration: style.animationDuration
      };
    }).filter((item) => (
      (item.backdrop && item.backdrop !== "none") || item.position === "fixed" || item.position === "sticky" || (item.animation && item.animation !== "none")
    )).slice(0, 40),
    loading: navigation ? {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      loadMs: Math.round(navigation.loadEventEnd),
      transferKiB: Math.round(resources.reduce((total, item) => total + (item.transferSize || 0), 0) / 1024),
      decodedKiB: Math.round(resources.reduce((total, item) => total + (item.decodedBodySize || 0), 0) / 1024),
      requestCount: resources.length
    } : null,
    frames: {
      samples: frames.length,
      averageMs: Number((frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length)).toFixed(2)),
      p95Ms: Number(percentile(0.95).toFixed(2)),
      p99Ms: Number(percentile(0.99).toFixed(2)),
      over20ms: frames.filter((value) => value > 20).length,
      over32ms: frames.filter((value) => value > 32).length,
      over50ms: frames.filter((value) => value > 50).length
    },
    longTasks: {
      count: window.__androidPerfLongTasks.filter((item) => item.start >= window.__androidPerfStartedAt).length,
      totalMs: Number(window.__androidPerfLongTasks.filter((item) => item.start >= window.__androidPerfStartedAt).reduce((sum, item) => sum + item.duration, 0).toFixed(2)),
      maxMs: Number(Math.max(0, ...window.__androidPerfLongTasks.filter((item) => item.start >= window.__androidPerfStartedAt).map((item) => item.duration)).toFixed(2))
    }
  };
});

result.cdp = {
  taskMs: Math.round(deltaMetric("TaskDuration") * 1000),
  scriptMs: Math.round(deltaMetric("ScriptDuration") * 1000),
  layoutMs: Math.round(deltaMetric("LayoutDuration") * 1000),
  styleMs: Math.round(deltaMetric("RecalcStyleDuration") * 1000),
  layouts: Math.round(deltaMetric("LayoutCount")),
  styleRecalcs: Math.round(deltaMetric("RecalcStyleCount"))
};
result.mode = diagnosticMode ? "effects-off" : staticChromeMode ? "static-chrome" : standaloneMode ? "standalone" : "baseline";

console.log(JSON.stringify(result, null, 2));
await browser.close();
