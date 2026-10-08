import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { mockStudentApi } from "./helpers/mock-student-api.js";

/**
 * A new deployment reaches an open app through the real service worker.
 *
 * The first load installs the built worker. A "deployment" is then simulated
 * by serving a byte-different `/service-worker.js`, which is exactly what the
 * browser compares when it checks for an update.
 */

const SETTINGS = "/#/settings?section=updates";

/** What the server publishes for the deployment that is simulated below. */
const NEXT_RELEASE = {
  id: "9.9.9",
  version: "9.9.9",
  date: "2026-12-01",
  summary: { en: "Faster sheets and a calmer reader.", ar: "شيتات أسرع وقارئ أهدأ." },
  items: [{ icon: "sparkles", title: { en: "Calmer reader", ar: "قارئ أهدأ" }, body: { en: "The reader opens faster.", ar: "يفتح القارئ أسرع." } }]
};

async function prepare(page) {
  await page.addInitScript(() => {
    window.e2eWorkerStates = [];
    navigator.serviceWorker.ready.then((registration) => {
      const record = (event, worker) => window.e2eWorkerStates.push({ event, time: Date.now(), state: worker?.state, active: registration.active?.state, waiting: registration.waiting?.state, installing: registration.installing?.state });
      record("ready", registration.active);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        record("updatefound", worker);
        worker?.addEventListener("statechange", () => record("statechange", worker));
      });
    });
    try {
      window.localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
      const loads = Number(window.sessionStorage.getItem("e2e-loads") || "0") + 1;
      window.sessionStorage.setItem("e2e-loads", String(loads));
    } catch { /* private mode */ }
  });
  await mockStudentApi(page);
}

async function openControlled(page) {
  await page.goto(`${edge.origin}${SETTINGS}`);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 30_000 });
  await expect(page.getByTestId("app-version")).toHaveText(/^\d+\.\d+\.\d+$/);
}

async function discoverDeployment(page) {
  // An automatic check can finish while the test is reaching for Check.
  // This scenario tests worker discovery/activation; the held-key case below
  // separately covers the native press while that control is replaced.
  await expect.poll(() => page.locator(".app-updates-status").getAttribute("data-update-status")).not.toBe("checking");
  await page.locator("#settings-updates .settings-v2-action", { hasText: "Check for updates" }).evaluateAll((buttons) => {
    buttons.forEach((button) => button.click());
  });
  await expect(page.locator(".app-updates-status")).toHaveAttribute("data-update-status", "updateAvailable", { timeout: 30_000 });
}

/**
 * A minimal edge in front of the built app. Playwright cannot route the
 * browser's own fetch of the worker script, so a "deployment" is made here:
 * after `deploy()`, `/service-worker.js` has new bytes. Headers follow
 * nginx/default.conf: the worker and HTML revalidate, hashed assets do not.
 */
async function startEdge(upstreamOrigin) {
  let suffix = "";
  let announce = false;
  const workerRequests = [];
  // Serve each immutable fixture response once from the upstream. Window
  // loading and real worker precaching share it instead of flooding the same
  // local preview with duplicate fetches under parallel workers.
  const assets = new Map();
  function asset(url) {
    if (!assets.has(url)) assets.set(url, (async () => {
      const upstream = await fetch(new URL(url, upstreamOrigin));
      return { body: Buffer.from(await upstream.arrayBuffer()), status: upstream.status, type: upstream.headers.get("content-type") || "application/octet-stream" };
    })());
    return assets.get(url);
  }
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url || "/", "http://edge.local");
    const requestedDeployment = suffix;
    if (pathname === "/service-worker.js") workerRequests.push({ startedAt: Date.now(), deployed: Boolean(requestedDeployment) });
    if (pathname === "/release-notes.json" && requestedDeployment && announce) {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(NEXT_RELEASE));
      return;
    }
    try {
      const upstream = await asset(request.url || "/");
      let body = upstream.body;
      if (pathname === "/service-worker.js" && requestedDeployment) body = Buffer.concat([body, Buffer.from(requestedDeployment)]);
      response.writeHead(upstream.status, {
        "content-type": upstream.type,
        "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
      });
      response.end(body);
    } catch {
      response.writeHead(502);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    workerRequests,
    deploy({ notes = false } = {}) { announce = notes; suffix = `\n// next deployment ${Date.now()}\n`; },
    close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
  };
}

/** @type {Awaited<ReturnType<typeof startEdge>>} */
let edge;

/** Data Offline Mode owns, which an update must leave alone. */
async function seedOfflineData(page) {
  await page.evaluate(async () => {
    const cache = await caches.open("lock-in-private-offline-v1-e2e-update");
    await cache.put("/offline-item", new Response("downloaded pdf"));
    window.localStorage.setItem("e2e-offline-marker", "kept");
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("e2e-update-db", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("items");
      request.onsuccess = () => {
        const tx = request.result.transaction("items", "readwrite");
        tx.objectStore("items").put("annotation", "page-1");
        tx.oncomplete = () => { request.result.close(); resolve(undefined); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function readOfflineData(page) {
  return page.evaluate(async () => {
    const cache = await caches.open("lock-in-private-offline-v1-e2e-update");
    const cached = await cache.match("/offline-item");
    const record = await new Promise((resolve) => {
      const request = indexedDB.open("e2e-update-db", 1);
      request.onsuccess = () => {
        const get = request.result.transaction("items").objectStore("items").get("page-1");
        get.onsuccess = () => { request.result.close(); resolve(get.result); };
        get.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
    return {
      cache: cached ? await cached.text() : null,
      record,
      marker: window.localStorage.getItem("e2e-offline-marker")
    };
  });
}

test.describe("PWA updates", () => {
  // These integration cases install and precache real workers before testing
  // a deployment, sometimes in two windows. Allow both lifecycle phases.
  test.setTimeout(60_000);
  test.skip(({ browserName }) => browserName !== "chromium", "Runs on the Chromium project with its real service worker.");
  test.beforeEach(async ({ baseURL }) => { edge = await startEdge(new URL(baseURL || "http://127.0.0.1:4173").origin); });
  test.afterEach(async ({ context }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const registrations = [];
      for (const page of context.pages()) {
        registrations.push(await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return { controller: navigator.serviceWorker.controller?.state, active: registration?.active?.state, waiting: registration?.waiting?.state, installing: registration?.installing?.state, events: window.e2eWorkerStates };
        }).catch(() => ({ closed: true })));
      }
      await testInfo.attach("worker-lifecycle", { body: JSON.stringify({ requests: edge?.workerRequests, registrations }, null, 2), contentType: "application/json" });
    }
    await edge?.close();
  });

  test("Settings shows the build and reports the latest version", async ({ page }) => {
    await prepare(page);
    await openControlled(page);
    await expect(page.getByTestId("app-build")).not.toHaveText("");
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByText("You're using the latest version")).toBeVisible();
    await expect(page.getByText("Last checked: Just now")).toBeVisible();
  });

  test("offline, a manual check asks for a connection instead of claiming the latest version", async ({ page, context }) => {
    await prepare(page);
    await openControlled(page);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByText("Unable to check while offline")).toBeVisible();
    await expect(page.getByText("Connect to the internet to check for updates.")).toBeVisible();
    await expect(page.getByText("You're using the latest version")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a new deployment is found, Later defers it, and Update now applies it with one reload", async ({ page, context }) => {
    await prepare(page);
    await openControlled(page);
    await seedOfflineData(page);
    edge.deploy();

    await discoverDeployment(page);
    const prompt = page.locator(".pwa-update-prompt");
    await expect(prompt).toContainText("New Lock-in update available");

    await prompt.getByRole("button", { name: "Later" }).click();
    await expect(prompt).toHaveCount(0);
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads"))).toBe("1");

    const reloaded = page.waitForEvent("load");
    await page.locator("#settings-updates").getByRole("button", { name: "Update now" }).click();
    await reloaded;
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads")), "exactly one reload").toBe("2");
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(false);
    await expect(page.locator(".pwa-update-prompt")).toHaveCount(0);

    expect(await readOfflineData(page)).toEqual({ cache: "downloaded pdf", record: "annotation", marker: "kept" });
  });

  test("the update notification explains the release, and Settings explains it before updating", async ({ page }) => {
    await page.addInitScript(() => { try { window.localStorage.setItem("lock-in.whats-new.e2e", "1"); } catch { /* private mode */ } });
    await prepare(page);
    await openControlled(page);
    // The running build's own notes appear on first load; dismiss them.
    await page.getByRole("dialog", { name: "What's new" }).getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    edge.deploy({ notes: true });

    await discoverDeployment(page);
    const prompt = page.locator(".pwa-update-prompt");
    await expect(prompt).toContainText("Lock-in 9.9.9 is available");
    await expect(prompt).toContainText("Faster sheets and a calmer reader.");
    await expect(page.locator(".app-updates-status")).toContainText("Lock-in 9.9.9 is available");

    // Settings: the explanation comes first; Later leaves everything as it was.
    await page.locator("#settings-updates").getByRole("button", { name: "Update now" }).click();
    const explainer = page.getByRole("dialog", { name: "Lock-in 9.9.9 is ready" });
    await expect(explainer).toContainText("Calmer reader");
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads"))).toBe("1");
    await explainer.getByRole("button", { name: "Later" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads"))).toBe("1");

    // Confirming applies the update with one reload, then the notes appear.
    // The simulated new build shares this bundle, so forget that its notes were seen.
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("lock-in.whats-new.seen:")) localStorage.removeItem(key); });
    await page.locator("#settings-updates").getByRole("button", { name: "Update now" }).click();
    const reloaded = page.waitForEvent("load");
    await page.getByRole("dialog", { name: "Lock-in 9.9.9 is ready" }).getByRole("button", { name: "Update now" }).click();
    await reloaded;
    await expect(page.getByRole("dialog", { name: "What's new" })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads")), "exactly one reload").toBe("2");
  });

  test("updating from the notification applies at once and shows the notes after the reload", async ({ page }) => {
    await page.addInitScript(() => { try { window.localStorage.setItem("lock-in.whats-new.e2e", "1"); } catch { /* private mode */ } });
    await prepare(page);
    await openControlled(page);
    await page.getByRole("dialog", { name: "What's new" }).getByRole("button", { name: "Got it" }).click();
    edge.deploy({ notes: true });

    await discoverDeployment(page);
    const prompt = page.locator(".pwa-update-prompt");
    await expect(prompt).toContainText("Lock-in 9.9.9 is available");
    await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("lock-in.whats-new.seen:")) localStorage.removeItem(key); });

    const reloaded = page.waitForEvent("load");
    await prompt.getByRole("button", { name: "Update now" }).click();
    await reloaded;
    await expect(page.getByRole("dialog", { name: "What's new" })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads")), "exactly one reload").toBe("2");
  });

  test("a check button held while an update arrives never applies it", async ({ page }) => {
    await prepare(page);
    await openControlled(page);
    await page.getByRole("button", { name: "Check for updates" }).focus();
    await page.keyboard.down("Space");
    edge.deploy();
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await expect(page.locator(".app-updates-status")).toHaveAttribute("data-update-status", "updateAvailable", { timeout: 30_000 });
    await page.keyboard.up("Space");
    await expect(page.locator(".app-updates-status")).toHaveAttribute("data-update-status", "updateAvailable");
    expect(await page.evaluate(() => sessionStorage.getItem("e2e-loads"))).toBe("1");
  });

  test("updating in one window never reloads another", async ({ page, context }) => {
    await prepare(page);
    await openControlled(page);
    const other = await context.newPage();
    await prepare(other);
    await openControlled(other);
    edge.deploy();

    await discoverDeployment(page);
    const reloaded = page.waitForEvent("load");
    await page.locator("#settings-updates").getByRole("button", { name: "Update now" }).click();
    await reloaded;

    await expect(other.locator(".pwa-update-prompt")).toContainText("Lock-in was updated");
    expect(await other.evaluate(() => sessionStorage.getItem("e2e-loads")), "the other window kept its page").toBe("1");
  });
});
