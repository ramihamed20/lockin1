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

async function prepare(page) {
  await page.addInitScript(() => {
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
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15_000 });
  await expect(page.getByTestId("app-version")).toHaveText(/^\d+\.\d+\.\d+$/);
}

/**
 * A minimal edge in front of the built app. Playwright cannot route the
 * browser's own fetch of the worker script, so a "deployment" is made here:
 * after `deploy()`, `/service-worker.js` has new bytes. Headers follow
 * nginx/default.conf: the worker and HTML revalidate, hashed assets do not.
 */
async function startEdge(upstreamOrigin) {
  let suffix = "";
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url || "/", "http://edge.local");
    try {
      const upstream = await fetch(new URL(request.url || "/", upstreamOrigin));
      let body = Buffer.from(await upstream.arrayBuffer());
      if (pathname === "/service-worker.js" && suffix) body = Buffer.concat([body, Buffer.from(suffix)]);
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/octet-stream",
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
    deploy() { suffix = `\n// next deployment ${Date.now()}\n`; },
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
  test.skip(({ browserName }) => browserName !== "chromium", "Runs on the Chromium project with its real service worker.");
  test.beforeEach(async ({ baseURL }) => { edge = await startEdge(new URL(baseURL || "http://127.0.0.1:4173").origin); });
  test.afterEach(async () => { await edge?.close(); });

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

    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByText("New update available")).toBeVisible({ timeout: 30_000 });
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

  test("updating in one window never reloads another", async ({ page, context }) => {
    await prepare(page);
    await openControlled(page);
    const other = await context.newPage();
    await prepare(other);
    await openControlled(other);
    edge.deploy();

    await page.getByRole("button", { name: "Check for updates" }).click();
    await expect(page.getByText("New update available")).toBeVisible({ timeout: 30_000 });
    const reloaded = page.waitForEvent("load");
    await page.locator("#settings-updates").getByRole("button", { name: "Update now" }).click();
    await reloaded;

    await expect(other.locator(".pwa-update-prompt")).toContainText("Lock-in was updated");
    expect(await other.evaluate(() => sessionStorage.getItem("e2e-loads")), "the other window kept its page").toBe("1");
  });
});
