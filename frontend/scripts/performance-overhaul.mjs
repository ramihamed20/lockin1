import { chromium, webkit } from '@playwright/test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fulfillAccessContract } from '../e2e/fixtures/productionApi.js';
import { E2E_CATALOG_MATERIALS } from '../e2e/fixtures/catalog.js';
import { verifyPerformanceBuild } from './fixtures/performance-build.mjs';
import { PERFORMANCE_CATALOG_MATERIALS } from './fixtures/performance-catalog.mjs';

// Local synthetic production-build lab. No production URLs or student data.
const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const baseURL = options.url || 'http://127.0.0.1:4173';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('This benchmark requires localhost.');
if (options.isolateBrowsers !== undefined && !["0", "1"].includes(options.isolateBrowsers)) throw new Error("isolateBrowsers must be 0 or 1");
const isolateBrowsers = options.isolateBrowsers === "1";
const runs = Math.max(3, Math.min(20, Number(options.runs) || 5));
const cpu = Number(options.cpu) || 4;
if (!Number.isFinite(cpu) || cpu < 1 || cpu > 20) throw new Error('cpu must be 1..20');
if (options.strokes !== undefined && (!Number.isInteger(Number(options.strokes)) || Number(options.strokes) < 0 || Number(options.strokes) > 5000)) throw new Error('strokes must be 0..5000');
const cycleCount = Number(options.cycles || 0);
if (!Number.isInteger(cycleCount) || cycleCount < 0 || cycleCount > 8 || (cycleCount && options.scenario !== 'tabs')) throw new Error('cycles must be 0..8 and requires scenario=tabs');
if (options.tabSet !== undefined && !['standard', 'heavy'].includes(options.tabSet)) throw new Error('Unknown synthetic tab set');
const pdfTabSlugs = options.tabSet === 'heavy' ? ['range-probe', 'long-probe', 'mixed-probe', 'scanned-probe'] : ['vitamin-2', 'vitamin-3', 'range-probe', 'long-probe'];
if (options.scenario === 'tabs' && options.pdf && options.pdf !== 'vitamin-1') throw new Error('Tab sequences start with the stable vitamin-1 fixture');
const networkProfile = options.network || 'local';
if (!['local', 'mobile'].includes(networkProfile)) throw new Error('network must be local or mobile');
if (networkProfile === 'mobile' && options.engine === 'webkit') throw new Error('Mobile network shaping requires Chromium CDP');
const pdfDeadline = Number(options.pdfDeadline || 45000);
if (!Number.isInteger(pdfDeadline) || pdfDeadline < 45000 || pdfDeadline > 180000) throw new Error('pdfDeadline must be 45000..180000');
if (options.scratch !== undefined && !['0', '1'].includes(options.scratch)) throw new Error('scratch must be 0 or 1');
const engine = options.engine === 'webkit' ? webkit : chromium;
if (options.heapSample === '1' && (engine !== chromium || cycleCount < 2)) throw new Error('heapSample requires Chromium and at least two close cycles');
if (options.processMemory !== undefined && !['0', '1'].includes(options.processMemory)) throw new Error('processMemory must be 0 or 1');
const processMemoryRequested = options.processMemory === '1';
if (processMemoryRequested && (process.platform !== 'win32' || engine !== chromium || cycleCount < 2)) throw new Error('processMemory requires Windows Chromium and at least two close cycles');
// Playwright enables DevTools Network payload retention on its own sessions.
// Cap those diagnostic copies for native memory sampling; actual HTTP bytes,
// request interception, application caches, PDF quality and assertions stay intact.
function configureNativeMemoryNetworkCapture() {
  const taskRequire = createRequire(import.meta.url);
  const testRequire = createRequire(taskRequire.resolve('@playwright/test/package.json'));
  const driverRequire = createRequire(testRequire.resolve('playwright/package.json'));
  const corePackage = driverRequire.resolve('playwright-core/package.json');
  const coreRequire = createRequire(corePackage);
  const sdkVersion = coreRequire('./package.json').version;
  if (sdkVersion !== '1.58.2') throw new Error('Native memory sampling requires the inspected Playwright1.58.2 Network adapter');
  const { CRNetworkManager } = coreRequire('./lib/server/chromium/crNetworkManager.js');
  const addSession = CRNetworkManager.prototype.addSession;
  if (typeof addSession !== 'function') throw new Error('Unsupported native Network session adapter');
  const configured = new WeakSet();
  const capture = { sdkVersion, responseBodyBufferBytes: 1, configuredAgents: 0 };
  // In-process diagnostic only. No installed SDK files are edited.
  CRNetworkManager.prototype.addSession = async function (session, ...args) {
    if (!configured.has(session)) {
      configured.add(session);
      const nativeSend = session.send.bind(session);
      session.send = (method, params) => {
        if (method === 'Network.enable') {
          capture.configuredAgents++;
          params = { ...params, maxTotalBufferSize: 1, maxResourceBufferSize: 1 };
        }
        return nativeSend(method, params);
      };
    }
    return addSession.call(this, session, ...args);
  };
  return capture;
}
const nativeMemoryNetworkCapture = processMemoryRequested ? configureNativeMemoryNetworkCapture() : null;
const output = resolve(options.output || 'output/performance/current.json');
const fixtureDefinition = E2E_CATALOG_MATERIALS['biochemistry-1'].find((sheet) => sheet.slug === (options.pdf || 'vitamin-1'));
if (!fixtureDefinition) throw new Error('Unknown synthetic PDF slug');
const routeFor = (slug) => `/#/materials/catalog/biochemistry-1/sheets/${slug}/workspace`;
const measuredBuildSHA256 = await verifyPerformanceBuild(baseURL, options.artifactRoot || "dist");
let browser = await engine.launch({ headless: true });
const results = [];
const recordedLayers = new WeakMap();
if (options.layers !== undefined && !["0", "1"].includes(options.layers)) throw new Error("layers must be 0 or 1");
if (options.layers === "1" && engine !== chromium) throw new Error("Layer inspection requires Chromium CDP");
const openTimings = new WeakMap();
let graphics = null;
if (engine === chromium) {
  const browserSession = await browser.newBrowserCDPSession();
  const info = await browserSession.send('SystemInfo.getInfo');
  graphics = { features: info.gpu.featureStatus, renderer: info.gpu.auxAttributes.glRenderer };
  await browserSession.detach();
}

async function penSnapshot(page) {
  return page.locator('.workspace-pane.is-active [data-pdf-page="1"] [data-annotation-type="pen"]').evaluateAll((marks) => JSON.stringify(marks.map((mark) => ({ id: mark.dataset.annotationId, path: mark.getAttribute('d') }))));
}

async function prepare(strokes = 0) {
  const context = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  let cdp = null;
  if (engine === chromium) {
    cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await cdp.send('Performance.enable');
    if (options.layers === "1") {
      const state = { layers: new Map(), evicted: 0 };
      recordedLayers.set(cdp, state);
      cdp.on("LayerTree.layerTreeDidChange", ({ layers = [] }) => {
        for (const layer of layers) {
          state.layers.set(layer.layerId, layer);
          if (state.layers.size > 128) { state.layers.delete(state.layers.keys().next().value); state.evicted += 1; }
        }
      });
      await cdp.send("LayerTree.enable");
    }
    if (networkProfile === 'mobile') {
      await cdp.send('Network.enable', processMemoryRequested ? { maxTotalBufferSize: 1, maxResourceBufferSize: 1 } : undefined);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 75000, connectionType: 'cellular4g' });
    }
    if (options.cpuProfile === '1') await cdp.send('Profiler.enable');
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (await fulfillAccessContract(route, pathname)) return;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/v1/auth/session') return json({ user: { id: 'perf-student', email: 'perf@example.test', full_name: 'Synthetic Student', preferred_language: 'en', status: 'active', is_email_verified: true, roles: ['student'], date_joined: '2026-01-01T00:00:00Z' } });
    if (pathname === '/api/v1/operations/session') return json({ error: { code: 'permission_denied', message: 'Student account' } }, 403);
    if (pathname === '/api/v1/focus/lock-in') return json({ active_session: null });
    if (pathname === '/api/v1/catalog/materials') return json({ count: PERFORMANCE_CATALOG_MATERIALS.length, results: PERFORMANCE_CATALOG_MATERIALS });
    return json({ count: 0, next: null, previous: null, results: [] });
  });
  await page.addInitScript(({ strokes, variant, scratchInspection }) => {
    if (variant === "page-visibility") document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".workspace-v2-a4-page { content-visibility: auto; }";
      document.head.append(style);
    }, { once: true });
    localStorage.setItem('lock-in.pwa-launch.dismissed-at', String(Date.now()));
    localStorage.setItem('lock-in.theme.settings', JSON.stringify({ theme: 'night', autoTheme: false, character: 'none', appIcon: 'light' }));
    // The stress-suite setting keeps optional stroke refinement from changing the fixture.
    localStorage.setItem('lock-in.catalog-workspace.settings.v1', JSON.stringify({ drawAndHold: false }));
    window.__perfLab = { frames: [], longTasks: [], recordFrames: false, lcp: 0, cls: 0 };
    if (scratchInspection) {
      if (typeof WeakRef !== 'function') throw new Error('Scratch diagnostics require WeakRef');
      Object.assign(window.__perfLab, { gestureCanvases: [], scratchPeakPixels: 0, scratchDropped: 0 });
      const nativeCreateElement = document.createElement;
      document.createElement = function (name, ...args) {
        const element = nativeCreateElement.call(this, name, ...args);
        if (String(name).toLowerCase() === 'canvas' && window.__perfLab.recordFrames) {
          if (window.__perfLab.gestureCanvases.length < 16) window.__perfLab.gestureCanvases.push(new WeakRef(element));
          else window.__perfLab.scratchDropped++;
        }
        return element;
      };
    }
    // Observe native page reads without delaying callbacks or transactions.
    // Frozen predecessors have no aria-busy contract, so seeded cold samples
    // also wait for their saved-page read and exact visible stroke count.
    window.__perfLab.restoredDocuments = new Set();
    const nativeGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      const request = nativeGet.apply(this, args);
      if (this.name === "documents" && this.transaction.db.name === "lock-in-workspace") {
        request.addEventListener("success", () => {
          // A new empty document has no page read. Its successful absence is
          // still restoration; no fake record or delay is added to the store.
          if (!request.result) requestAnimationFrame(() => requestAnimationFrame(() => {
            window.__perfLab.restoredDocuments.add(String(args[0]));
          }));
        });
      }
      return request;
    };
    const nativeGetAll = IDBIndex.prototype.getAll;
    IDBIndex.prototype.getAll = function (...args) {
      const request = nativeGetAll.apply(this, args);
      if (this.name === "documentId" && this.objectStore.name === "pages"
        && this.objectStore.transaction.db.name === "lock-in-workspace") {
        request.addEventListener("success", () => requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__perfLab.restoredDocuments.add(String(args[0]));
        })));
      }
      return request;
    };

    let last;
    function frame(time) {
      if (last !== undefined && window.__perfLab.recordFrames) window.__perfLab.frames.push({ start: last, duration: time - last });
      if (window.__perfLab.recordFrames && window.__perfLab.gestureCanvases) {
        const pixels = window.__perfLab.gestureCanvases.reduce((total, ref) => {
          const canvas = ref.deref();
          return total + (canvas && !canvas.isConnected ? canvas.width * canvas.height : 0);
        }, 0);
        window.__perfLab.scratchPeakPixels = Math.max(window.__perfLab.scratchPeakPixels, pixels);
      }
      last = time;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    for (const [type, save] of [
      ['longtask', (entry) => { if (window.__perfLab.recordFrames) window.__perfLab.longTasks.push({ start: entry.startTime, duration: entry.duration }); }],
      ['largest-contentful-paint', (entry) => { window.__perfLab.lcp = entry.startTime; }],
      ['layout-shift', (entry) => { if (!entry.hadRecentInput) window.__perfLab.cls += entry.value; }]
    ]) {
      try { new PerformanceObserver((list) => list.getEntries().forEach(save)).observe({ type, buffered: true }); } catch { /* engine lacks this observer */ }
    }
    if (!strokes || sessionStorage.getItem('perf-seeded')) return;
    sessionStorage.setItem('perf-seeded', '1');
    window.__perfSeed = new Promise((done, fail) => {
      const request = indexedDB.open('lock-in-workspace', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' }).createIndex('documentId', 'documentId', { unique: false });
      };
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const documentId = 'user:perf-student::biochemistry-1::vitamin-1';
        const tx = db.transaction(['documents', 'pages'], 'readwrite');
        tx.objectStore('documents').put({ id: documentId, owner: 'user:perf-student', materialSlug: 'biochemistry-1', sheetSlug: 'vitamin-1', version: 1, savedAt: new Date().toISOString(), view: { page: 1, zoom: 1, scrollLeft: 0, scrollTop: 0, pageOffset: 0 }, notes: [] });
        const annotations = Array.from({ length: strokes }, (_, index) => ({ id: `seed-1-${index}`, page: 1, type: 'pen', color: '#8b5cf6', width: 4, opacity: 1, profile: 'ball', createdAt: '2026-01-01T00:00:00.000Z', points: Array.from({ length: 40 }, (_, step) => ({ x: (index * 13 + step * 4) % 980, y: (index * 29 + step * 7) % 980, t: step * 8, p: 0.5, pointer: 'pen' })) }));
        tx.objectStore('pages').put({ id: `${documentId}::1`, documentId, page: 1, annotations });
        tx.oncomplete = () => { db.close(); done(); };
        tx.onerror = () => fail(tx.error);
      };
    });
  }, { strokes, variant: options.variant, scratchInspection: options.scratch === '1' });
  return { context, page, errors, cdp };
}

async function open(page, slug, cold = false, expectedStrokes = null) {
  const start = Date.now();
  if (cold) await page.goto(baseURL + routeFor(slug), { waitUntil: 'domcontentloaded' });
  else await page.evaluate((route) => { location.hash = route.slice(1); }, routeFor(slug));
  const titles = { 'vitamin-1': 'Vitamin -1', 'vitamin-2': 'Vitamin -2', 'vitamin-3': 'Vitamin -3', 'range-probe': 'Range probe', 'long-probe': 'Long probe', 'mixed-probe': 'Mixed probe', 'scanned-probe': 'Scanned probe' };
  await page.locator('.workspace-pane.is-active main').filter({ has: page.locator('.workspace-v3-document-context strong', { hasText: titles[slug] }) }).waitFor({ state: 'visible', timeout: pdfDeadline });
  const choice = page.getByRole('button', { name: /Normal Study/ });
  await Promise.race([
    choice.waitFor({ state: 'visible', timeout: pdfDeadline }),
    page.locator('.workspace-pane.is-active .workspace-v2-a4-canvas.is-visible').first().waitFor({ state: 'visible', timeout: pdfDeadline })
  ]);
  if (await choice.isVisible()) await choice.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.workspace-pane.is-active .workspace-v2-a4-canvas.is-visible')].some((canvas) => canvas.width > 0 && canvas.height > 0), null, { timeout: pdfDeadline });
  const paintedMs = Date.now() - start;
  // A painted PDF is not yet editable while its saved document is restoring.
  // The missing attribute keeps frozen older builds comparable; the explicit
  // busy state must have cleared on current builds before recording usability.
  await page.waitForFunction(() => { const workspace = document.querySelector('.workspace-pane.is-active main.workspace-v2'); return workspace && workspace.getAttribute('aria-busy') !== 'true'; }, null, { timeout: pdfDeadline });
  if (cold && expectedStrokes !== null) {
    await page.waitForFunction(({ slug, expectedStrokes }) =>
      window.__perfLab.restoredDocuments.has(`user:perf-student::biochemistry-1::${slug}`)
      && document.querySelectorAll('.workspace-pane.is-active [data-pdf-page="1"] [data-annotation-type="pen"]').length === expectedStrokes,
    { slug, expectedStrokes }, { timeout: pdfDeadline });
  }
  const usableMs = Date.now() - start;
  openTimings.set(page, { paintedMs, editableMs: usableMs });
  await page.waitForTimeout(600);
  return usableMs;
}

async function memory(page) {
  return page.evaluate(() => {
    const panes = [...document.querySelectorAll('.workspace-pane')];
    const describe = (pane) => {
      const canvases = [...pane.querySelectorAll('canvas')];
      const pixels = canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0);
      return { active: pane.classList.contains('is-active'), canvases: canvases.length, allocated: canvases.filter((canvas) => canvas.width * canvas.height > 0).length, pixels, approximateBytes: pixels * 4 };
    };
    return { panes: panes.map(describe), heapBytes: performance.memory?.usedJSHeapSize ?? null };
  });
}

async function ink(page, strokes, cdp) {
  if (options.variant === 'ink-layer') await page.addStyleTag({ content: '.workspace-pane.is-active .workspace-v2-live-annotation-canvas { will-change: transform; }' });
  const selector = '.workspace-pane.is-active [data-pdf-page="1"] [data-annotation-type="pen"]';
  await page.waitForFunction(({ selector, strokes }) => document.querySelectorAll(selector).length === strokes, { selector, strokes });
  // Wait for the two reading positions measured a frame apart to agree.
  await page.waitForFunction(() => {
    const first = document.querySelector('.workspace-pane.is-active .workspace-v2-a4-page');
    const top = Math.round(first?.getBoundingClientRect().top ?? NaN);
    const stable = window.__perfTop === top;
    window.__perfTop = top;
    return stable && Number.isFinite(top);
  });
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const bounds = await page.locator('.workspace-pane.is-active .workspace-v2-a4-page').first().boundingBox();
  const metricsBefore = cdp ? (await cdp.send('Performance.getMetrics')).metrics : [];
  if (cdp && options.cpuProfile === '1') await cdp.send('Profiler.start');
  if (cdp && options.trace === '1') await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
  const started = await page.evaluate(() => {
    // Retention diagnostics must not retain a growing history of idle frames.
    // The gesture sample is still collected against the actual browser rAF.
    window.__perfLab.frames.length = 0;
    window.__perfLab.longTasks.length = 0;
    window.__perfLab.recordFrames = true;
    return performance.now();
  });
  await page.evaluate(async (bounds) => {
    const stage = document.querySelector('.workspace-pane.is-active .workspace-v2-document-stage');
    function send(type, step) {
      stage.dispatchEvent(new PointerEvent(type, { pointerId: 501, pointerType: 'pen', isPrimary: true, clientX: bounds.x + bounds.width * (0.2 + step * 0.01), clientY: bounds.y + bounds.height * (0.4 + Math.sin(step / 4) * 0.04), button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, bubbles: true, cancelable: true }));
    }
    send('pointerdown', 0);
    for (let step = 1; step <= 40; step++) { await new Promise(requestAnimationFrame); send('pointermove', step); }
    window.__perfLab.pointerUp = performance.now();
    send('pointerup', 40);
  }, bounds);
  await page.waitForFunction(({ selector, strokes }) => document.querySelectorAll(selector).length === strokes + 1, { selector, strokes });
  const end = await page.evaluate(() => performance.now());
  const result = await page.evaluate(({ started, end }) => {
    window.__perfLab.recordFrames = false;
    return ({
    gestureMs: end - started,
    commitObservationMs: end - window.__perfLab.pointerUp,
    frameDurationsMs: window.__perfLab.frames.filter((frame) => frame.start >= started && frame.start <= end).map((frame) => frame.duration),
    longTasks: window.__perfLab.longTasks.filter((task) => task.start >= started && task.start <= end)
    });
  }, { started, end });
  if (cdp) {
    if (options.cpuProfile === '1') result.cpuProfile = await saveCpuProfile(cdp, 'ink-' + strokes);
    const metricsAfter = (await cdp.send('Performance.getMetrics')).metrics;
    result.mainThread = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map((name) => [name, (metricsAfter.find((metric) => metric.name === name)?.value || 0) - (metricsBefore.find((metric) => metric.name === name)?.value || 0)]));
    if (options.trace === '1') {
      const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end');
      const { stream } = await complete;
      let trace = '';
      while (true) {
        const part = await cdp.send('IO.read', { handle: stream });
        trace += part.data;
        if (part.eof) break;
      }
      await cdp.send('IO.close', { handle: stream });
      await mkdir(resolve(output, '..'), { recursive: true });
      const traceFile = output.replace(/\.json$/, '') + '-trace-' + strokes + '-' + Date.now() + '.json';
      await writeFile(traceFile, trace);
      result.trace = traceFile;
    }
  }
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await page.waitForFunction(({ selector, strokes }) => document.querySelectorAll(selector).length === strokes, { selector, strokes });
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
  await page.waitForFunction(({ selector, strokes }) => document.querySelectorAll(selector).length === strokes + 1, { selector, strokes });
  return result;
}

async function erase(page, strokes, cdp) {
  await page.waitForFunction(() => {
    const top = Math.round(document.querySelector('.workspace-pane.is-active .workspace-v2-a4-page')?.getBoundingClientRect().top ?? NaN);
    const stable = window.__perfEraseTop === top;
    window.__perfEraseTop = top;
    return stable && Number.isFinite(top);
  });
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  const bounds = await page.locator('.workspace-pane.is-active .workspace-v2-a4-page').first().boundingBox();
  await page.evaluate(() => {
    window.__perfEraseSnapshot = () => {
      const layer = document.querySelector('.workspace-pane.is-active [data-pdf-page="1"] .workspace-v2-annotation-layer');
      return JSON.stringify({ marks: [...layer.querySelectorAll('[data-annotation-type="pen"]')].map((mark) => ({ id: mark.dataset.annotationId, path: mark.getAttribute('d'), mask: mark.getAttribute('mask') })), masks: [...layer.querySelectorAll('mask[id^="workspace-erase-"]')].map((mask) => ({ id: mask.id, paths: [...mask.querySelectorAll('path')].map((path) => path.getAttribute('d')) })) });
    };
  });
  const before = await page.evaluate(() => window.__perfEraseSnapshot());
  const metricsBefore = cdp ? (await cdp.send('Performance.getMetrics')).metrics : [];
  if (cdp && options.cpuProfile === '1') await cdp.send('Profiler.start');
  if (cdp && options.trace === '1') await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
  const result = await page.evaluate(async (bounds) => {
    const lab = window.__perfLab;
    lab.frames.length = 0; lab.longTasks.length = 0; lab.recordFrames = true;
    const started = performance.now();
    const eventHandlerMs = [];
    const stage = document.querySelector('.workspace-pane.is-active .workspace-v2-document-stage');
    function send(type, step) {
      const at = performance.now();
      stage.dispatchEvent(new PointerEvent(type, { pointerId: 502, pointerType: 'pen', isPrimary: true, clientX: bounds.x + bounds.width * (0.2 + step * 0.01), clientY: bounds.y + bounds.height * (0.3 + step * 0.006), button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, bubbles: true, cancelable: true }));
      eventHandlerMs.push(performance.now() - at);
    }
    send('pointerdown', 0);
    for (let step = 1; step <= 40; step++) { await new Promise(requestAnimationFrame); send('pointermove', step); }
    const pointerUp = performance.now(); send('pointerup', 40);
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const end = performance.now(); lab.recordFrames = false;
    return { mode: 'precision eraser', commitDefinition: 'two native rAF after pointer-up; mask correctness is checked separately; not first pixel paint', input: 'synthetic pen pointer dispatched once per native rAF; event-handler timings are not pointer-to-paint or INP', gestureMs: end - started, commitObservationMs: end - pointerUp, eventHandlerMs, frameDurationsMs: lab.frames.filter((frame) => frame.start >= started && frame.start <= end).map((frame) => frame.duration), longTasks: lab.longTasks.filter((task) => task.start >= started && task.start <= end) };
  }, bounds);
  if (strokes) await page.waitForFunction(() => document.querySelectorAll('.workspace-pane.is-active [data-pdf-page="1"] mask[id^="workspace-erase-"]').length > 0);
  const after = await page.evaluate(() => window.__perfEraseSnapshot());
  const saved = JSON.parse(after);
  if (saved.marks.length !== strokes || (strokes && !saved.masks.length) || (!strokes && after !== before)) throw new Error('Precision eraser failed its preserved-mark/mask contract');
  result.maskCount = saved.masks.length;
  result.canvasSampling = await page.evaluate(() => {
    const canvas = document.querySelector('.workspace-pane.is-active .workspace-v2-live-annotation-canvas');
    const bounds = canvas?.getBoundingClientRect();
    const lab = window.__perfLab;
    return {
      backingWidth: canvas?.width, backingHeight: canvas?.height,
      paintedCssWidth: bounds?.width, paintedCssHeight: bounds?.height,
      dpr: window.devicePixelRatio,
      scratch: lab.gestureCanvases ? {
        definition: 'new gesture-created unattached canvas pixel proxy, sampled per native rAF; not GPU/process memory',
        tracked: lab.gestureCanvases.length, dropped: lab.scratchDropped,
        peakBytes: lab.scratchPeakPixels * 4,
        remainingBytes: lab.gestureCanvases.reduce((total, ref) => {
          const surface = ref.deref(); return total + (surface && !surface.isConnected ? surface.width * surface.height * 4 : 0);
        }, 0)
      } : null
    };
  });
  // Non-shipping raster experiments mark usage; ordinary builds return false.
  // This read happens after the measured gesture and records no student data.
  result.rasterProofUsed = await page.evaluate(() => Boolean(document.querySelector('.workspace-pane.is-active canvas[data-eraser-raster-proof="used"]')));
  result.diagnosticPhases = await page.evaluate(() => window.__perfEraserPhases || null);
  if (cdp) {
    if (options.cpuProfile === '1') result.cpuProfile = await saveCpuProfile(cdp, 'eraser-' + strokes);
    if (options.trace === '1') result.trace = await saveTrace(cdp, 'eraser-' + strokes);
    if (options.layers === "1") result.layers = await inspectRecordedLayers(cdp);
    const metricsAfter = (await cdp.send('Performance.getMetrics')).metrics;
    result.mainThread = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((name) => [name, (metricsAfter.find((metric) => metric.name === name)?.value || 0) - (metricsBefore.find((metric) => metric.name === name)?.value || 0)]));
  }
  result.undoRedoChecked = Boolean(strokes);
  if (strokes) {
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
    await page.waitForFunction((snapshot) => window.__perfEraseSnapshot() === snapshot, before);
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click();
    await page.waitForFunction((snapshot) => window.__perfEraseSnapshot() === snapshot, after);
  }
  return result;
}

async function inspectRecordedLayers(cdp) {
  const state = recordedLayers.get(cdp);
  const layers = [];
  for (const layer of state.layers.values()) {
    if (!layer.drawsContent) continue;
    const row = { layerId: layer.layerId, backendNodeId: layer.backendNodeId ?? null, width: layer.width, height: layer.height };
    if (layer.backendNodeId) {
      try {
        const { node } = await cdp.send("DOM.describeNode", { backendNodeId: layer.backendNodeId, depth: 0 });
        const attributes = Object.fromEntries(Array.from({ length: (node.attributes || []).length / 2 }, (_, i) => [node.attributes[i * 2], node.attributes[i * 2 + 1]]));
        row.nodeName = node.nodeName; row.className = attributes.class || null; row.id = attributes.id || null;
      } catch (error) { row.nodeError = error.message; }
    }
    try { row.reasons = (await cdp.send("LayerTree.compositingReasons", { layerId: layer.layerId })).compositingReasons; }
    catch (error) { row.reasonError = error.message; }
    layers.push(row);
  }
  return { definition: "bounded layer ID snapshots; metadata queried after gesture; removed layers may lack current reasons", evicted: state.evicted, layers };
}

async function processMemorySnapshot() {
  if (!processMemoryRequested) return null;
  if (!nativeMemoryNetworkCapture?.configuredAgents) throw new Error('Native Network capture control was not applied');
  const session = await browser.newBrowserCDPSession();
  let processInfo;
  try { ({ processInfo } = await session.send('SystemInfo.getProcessInfo')); }
  finally { await session.detach(); }
  const processIds = [...new Set(processInfo.map(process => process.id))];
  if (!processIds.length || processIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid owned browser process IDs');
  // Only CDP-provided numeric IDs enter this fixed read-only command. Never
  // enumerate unrelated processes or collect command lines, profiles or data.
  const command = `$ErrorActionPreference='Stop'; Get-Process -Id ${processIds.join(',')} -ErrorAction Stop | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
  const raw = execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  const rows = [JSON.parse(raw)].flat();
  if (rows.length !== processIds.length || rows.some(row => !processIds.includes(row.Id) || !Number.isSafeInteger(row.WorkingSet64) || !Number.isSafeInteger(row.PrivateMemorySize64))) throw new Error('Incomplete owned browser process memory snapshot');
  return {
    definition: 'Windows Get-Process; only this browser CDP process IDs; summed working set may count shared pages more than once; private bytes are committed memory, not GPU VRAM',
    summedWorkingSetBytes: rows.reduce((sum, row) => sum + row.WorkingSet64, 0),
    summedPrivateBytes: rows.reduce((sum, row) => sum + row.PrivateMemorySize64, 0),
    processes: rows.map(row => ({ id: row.Id, type: processInfo.find(process => process.id === row.Id).type, workingSetBytes: row.WorkingSet64, privateBytes: row.PrivateMemorySize64 }))
  };
}
try {
  for (const strokes of (options.strokes !== undefined ? [Number(options.strokes)] : ['tabs', 'pdf'].includes(options.scenario) ? [0] : [0, 100, 500, 1000])) {
    for (let run = 0; run < runs; run++) {
      // Keep the complete scenario inside one browser, including warm tabs,
      // but isolate cold samples from prior browser-process/raster state.
      if (isolateBrowsers && results.length > 0) {
        await browser.close();
        browser = await engine.launch({ headless: true });
      }
      const { context, page, errors, cdp } = await prepare(strokes);
      try {
        // Prepare IndexedDB on a blank same-origin document: never warm app assets.
        await page.route('**/__lockin_perf_seed', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic seed</title>' }));
        await page.goto(baseURL + '/__lockin_perf_seed');
        await page.evaluate(() => window.__perfSeed);
        await page.unroute('**/__lockin_perf_seed');
        if (cdp && options.scenario === 'pdf' && options.trace === '1') await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
        if (cdp && options.cpuProfile === '1') await cdp.send('Profiler.start');
        const coldUsableMs = await open(page, options.pdf || 'vitamin-1', true, !options.pdf || options.pdf === 'vitamin-1' ? strokes : null);
        const coldPaintedMs = openTimings.get(page).paintedMs;
        const coldResources = await page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /\/assets\/|\/e2e-fixtures\/pdf\//.test(entry.name)).map((entry) => ({ path: new URL(entry.name).pathname, initiatorType: entry.initiatorType, startTime: entry.startTime, duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize })));
        const coldCpuProfile = cdp && options.cpuProfile === '1' ? await saveCpuProfile(cdp, 'cold-' + strokes + '-' + run) : null;
        const coldTrace = cdp && options.scenario === 'pdf' && options.trace === '1' ? await saveTrace(cdp, 'cold-' + run) : null;
        const single = await memory(page);
        const singleProcessMemory = await processMemorySnapshot();
        const drawing = options.scenario === 'eraser' ? await erase(page, strokes, cdp) : ['tabs', 'pdf'].includes(options.scenario) && options.drawTabs !== '1' ? null : await ink(page, strokes, cdp);
        const tabs = [];
        const expectedInk = new Map();
        let preservationChecks = 0;
        if (cycleCount && options.drawTabs === '1') expectedInk.set('vitamin-1', await penSnapshot(page));
        async function checkStoredInk(slug) {
          if (!cycleCount || options.drawTabs !== '1') return;
          if (await penSnapshot(page) !== expectedInk.get(slug)) throw new Error('Saved stroke ID/geometry changed after reopening ' + slug);
          preservationChecks++;
        }
        if (strokes === 0 && !['ink', 'pdf', 'eraser'].includes(options.scenario)) {
          for (const slug of [...pdfTabSlugs, 'vitamin-1']) {
            const usableMs = await open(page, slug);
            const drawing = options.drawTabs === '1' && slug !== 'vitamin-1' ? await ink(page, 0, cdp) : null;
            if (cycleCount && drawing) expectedInk.set(slug, await penSnapshot(page));
            tabs.push({ slug, usableMs, drawing, memory: await memory(page), processMemory: await processMemorySnapshot() });
          }
          await page.waitForTimeout(4500);
        }
        const closedCycles = [];
        for (let cycle = 0; cycle < cycleCount; cycle++) {
          for (const title of [...pdfTabSlugs].reverse().map((slug) => E2E_CATALOG_MATERIALS['biochemistry-1'].find((sheet) => sheet.slug === slug).title)) {
            await page.locator('.workspace-pane.is-active [role="tab"]').filter({ hasText: title }).click();
            await page.locator('.workspace-pane.is-active [role="tab"][aria-selected="true"]').filter({ hasText: title }).waitFor();
            // Compact tablet chrome hides this decorative title; attachment still
            // verifies the active reader, rather than requiring desktop styling.
            await page.locator('.workspace-pane.is-active .workspace-v3-document-context strong', { hasText: title }).waitFor({ state: 'attached' });
            await page.getByRole('button', { name: 'Close ' + title, exact: true }).click();
          }
          await open(page, 'vitamin-1');
          await page.waitForTimeout(4500);
          await checkStoredInk('vitamin-1');
          let retainedMainHeap = null;
          if (cdp) {
            // Forced collection diagnoses retention; it is never a latency sample
            // or a measurement of the PDF workers/native GPU/process heap.
            await cdp.send('HeapProfiler.collectGarbage');
            retainedMainHeap = { heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters'), dedicatedWorkerTargets: (await cdp.send('Target.getTargets')).targetInfos.filter((target) => target.type === 'worker').length };
            retainedMainHeap.fontFaces = await page.evaluate(() => document.fonts.size);
            if (options.heapSample === '1' && cycle === 0) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false });
            if (options.heapSample === '1' && cycle === cycleCount - 1) {
              const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
              await cdp.send('HeapProfiler.stopSampling');
              await mkdir(resolve(output, '..'), { recursive: true });
              const sampleFile = output.replace(/\.json$/, '') + '-heap-' + run + '.json';
              // Call frames and live allocation sizes only: never an object/content heap dump.
              await writeFile(sampleFile, JSON.stringify({ samplingInterval: 16384, transitions: cycleCount - 1, head: profile.head }, null, 2));
              retainedMainHeap.liveAllocationSample = sampleFile;
            }
          }
          closedCycles.push({ cycle, memory: await memory(page), retainedMainHeap, processMemory: await processMemorySnapshot(), diagnosticCounts: await page.evaluate(() => ({ frames: window.__perfLab.frames.length, longTasks: window.__perfLab.longTasks.length, pdfTimings: (window.__lockInPdfLoadTimings || []).length })) });
          if (cycle + 1 < cycleCount) {
            for (const slug of pdfTabSlugs) {
              await open(page, slug);
              if (options.drawTabs === '1') await page.waitForFunction(() => document.querySelectorAll('.workspace-pane.is-active [data-pdf-page="1"] [data-annotation-type="pen"]').length === 1);
              await checkStoredInk(slug);
            }
            await open(page, 'vitamin-1');
          }
        }
        const pdfLoadTimings = await page.evaluate(() => window.__lockInPdfLoadTimings || []);
        results.push({ strokes, run, coldUsableMs, coldPaintedMs, coldResources, coldTrace, coldCpuProfile, pdfLoadTimings, single, singleProcessMemory, drawing, tabs, closedCycles, preservationChecks, settled: await memory(page), settledProcessMemory: await processMemorySnapshot(), errors });
        console.log(JSON.stringify({ strokes, run, coldUsableMs, frameP95: drawing ? percentile(drawing.frameDurationsMs, .95) : null, panes: results.at(-1).settled.panes }));
      } finally { await context.close(); }
    }
  }
} finally {
  const fixture = await stat(new URL('../e2e/fixtures/pdf/' + fixtureDefinition.file, import.meta.url));
  const report = { schema: 5, buildIndexSha256: measuredBuildSHA256, date: new Date().toISOString(), sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyFiles: execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean), environment: { graphics, independentBrowserPerSample: isolateBrowsers, diagnosticRecording: 'last gesture only; no growing idle frame/task history; exact stroke ID/path reopen checks', scenario: options.scenario || 'baseline', scratchInspection: options.scratch === '1', layerInspection: options.layers === '1', variant: options.variant || 'baseline', cpuProfile: options.cpuProfile === '1', heapSample: options.heapSample === '1', processMemorySampling: processMemoryRequested, nativeMemoryNetworkCapture, drawnTabs: options.drawTabs === '1', closeCycles: cycleCount, pdfObservationDeadlineMs: pdfDeadline, tabSet: options.tabSet || 'standard', tabSlugs: ['vitamin-1', ...pdfTabSlugs], engine: engine === chromium ? 'chromium' : 'webkit', browser: browser.version(), viewport: { width: 834, height: 1194, dpr: 2, touch: true }, cpuRate: engine === chromium ? cpu : null, network: networkProfile === 'mobile' ? 'loopback HTTP; CDP 1.6 Mbps down / 0.6 Mbps up / 150 ms latency; API synthetic; actual PDF HTTP; SW blocked' : 'localhost, no throttle; API synthetic; SW blocked; install prompt previously dismissed', cache: 'blank same-origin seeding; no app assets loaded before measured route; warm imported modules in tab sequence; API routing disables HTTP cache', build: options.build || 'production Vite with explicit E2E catalog', readiness: 'coldPaintedMs observes first nonzero visible canvas; coldUsableMs also waits for current workspace aria-busy to clear; vitamin-1 cold samples in both variants additionally wait for native missing-document or saved-page read + two rAF observations and exact stroke count (older builds have no explicit gate); ink begins only after exact stored-stroke count and stable page position', fixture: { name: fixtureDefinition.file, bytes: fixture.size, pages: fixtureDefinition.pageCount, pointsPerStroke: 40 }, runs }, results };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  await browser.close();
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? null;
}


async function saveTrace(cdp, label) {
  const complete = new Promise((done) => cdp.once('Tracing.tracingComplete', done));
  await cdp.send('Tracing.end');
  const { stream } = await complete;
  let trace = '';
  while (true) {
    const part = await cdp.send('IO.read', { handle: stream });
    trace += part.data;
    if (part.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  await mkdir(resolve(output, '..'), { recursive: true });
  const traceFile = output.replace(/\.json$/, '') + '-trace-' + label + '-' + Date.now() + '.json';
  await writeFile(traceFile, trace);
  return traceFile;
}

async function saveCpuProfile(cdp, label) {
  const { profile } = await cdp.send('Profiler.stop');
  await mkdir(resolve(output, '..'), { recursive: true });
  const file = output.replace(/\.json$/, '') + '-cpu-' + label + '-' + Date.now() + '.json';
  await writeFile(file, JSON.stringify(profile));
  return file;
}
