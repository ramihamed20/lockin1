import { generateKeyPairSync } from "node:crypto";
import { expect, test } from "@playwright/test";
import { studentSession, fulfillAccessContract } from "./fixtures/productionApi.js";
const OWNER = "11111111-1111-4111-8111-111111111111";
const BINDING = "22222222-2222-4222-8222-222222222222";
const NOTICE = "33333333-3333-4333-8333-333333333333";
const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
const PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");

async function server(page) {
  const changes = [];
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/v1/auth/session") return json({ user: studentSession({ id: OWNER }) });
    if (pathname === "/api/v1/auth/csrf") return json({ csrf_token: "test-csrf" });
    if (pathname === "/api/v1/operations/session") return json({ error: { code: "permission_denied", message: "Student" } }, 403);
    if (await fulfillAccessContract(route, pathname)) return;
    if (pathname === "/api/v1/notifications/push") {
      if (route.request().method() === "GET") return json({ enabled: true, public_key: PUBLIC_KEY, binding: BINDING, registered: changes.includes("POST") && !changes.includes("DELETE") });
      changes.push(route.request().method());
      return json({ binding: BINDING }, route.request().method() === "DELETE" ? 200 : 201);
    }
    if (pathname === "/api/v1/notifications/push/test") return json({ queued: true }, 202);
    return json({ count: 0, results: [] });
  });
  await page.addInitScript(() => {
    localStorage.setItem("lock-in.locale", "en");
    localStorage.setItem("lock-in.pwa-launch.dismissed-at", String(Date.now()));
    window.__pushAsks = 0;
    // The headless shell has no OS notification UI. Stub that permission
    // surface while exercising the actual production service worker below.
    let permission = localStorage.getItem("push-test-installed") ? "granted" : "default";
    Object.defineProperty(Notification, "permission", { get: () => permission });
    Notification.requestPermission = async () => { window.__pushAsks++; permission = "granted"; return permission; };
    const makeSubscription = (options) => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/mock-installation", options,
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/mock-installation", keys: { p256dh: "test", auth: "test" } }),
      unsubscribe: async () => { localStorage.removeItem("push-test-installed"); return true; }
    });
    PushManager.prototype.getSubscription = async () => localStorage.getItem("push-test-installed") ? makeSubscription({}) : null;
    PushManager.prototype.subscribe = async (options) => {
      localStorage.setItem("push-test-installed", "1");
      return makeSubscription(options);
    };
  });
  return changes;
}

async function visibleNotices(worker) {
  return worker.evaluate(() => globalThis.__pushNotices.map((notice) => notice.title));
}

async function enrollDevice(page, context) {
  await context.grantPermissions(["notifications"]);
  const changes = await server(page);
  const cdp = await context.newCDPSession(page);
  let registrations = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (event) => { registrations = [...registrations, ...event.registrations]; });
  await cdp.send("ServiceWorker.enable");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings?section=notifications");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const worker = context.serviceWorkers().find((item) => item.url().includes("service-worker.js"));
  await worker.evaluate(() => {
    globalThis.__pushNotices = [];
    globalThis.registration.showNotification = async (title, options) => {
      globalThis.__pushNotices.push({ title, options });
    };
  });
  const panel = page.locator("#settings-device-push");
  await expect(panel.getByRole("button", { name: "Enable notifications" })).toBeEnabled();
  expect(await page.evaluate(() => window.__pushAsks)).toBe(0);
  await panel.getByRole("button", { name: "Enable notifications" }).click();
  await expect(panel.getByText("Enabled on this device", { exact: true })).toBeVisible();
  expect(changes).toEqual(["POST"]);
  await panel.getByRole("button", { name: "Send a test notification" }).click();
  await expect(panel.getByRole("status")).toContainText("requested");
  return { changes, cdp, registrations: () => registrations, worker, panel };
}

test("device opt-in receives a push while outside Lock-in and disable blocks stale pushes", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  const { changes, cdp, registrations, worker, panel } = await enrollDevice(page, context);
  const origin = new URL(baseURL).origin;
  await expect.poll(() => registrations().some((item) => item.scopeURL === origin + "/" && !item.isDeleted)).toBe(true);
  const registrationId = registrations().findLast((item) => item.scopeURL === origin + "/" && !item.isDeleted).registrationId;
  const data = JSON.stringify({ id: NOTICE, binding: BINDING, title: "New Lock-in sheet", body: "Ready", expires_at: new Date(Date.now() + 60_000).toISOString() });
  // A real cross-origin document is active, with no Lock-in window left open.
  await context.route("https://outside.example.test/**", (route) => route.fulfill({
    contentType: "text/html", body: "<title>Outside Lock-in</title><h1>Another website</h1>"
  }));
  await page.goto("https://outside.example.test/");
  await expect(page.getByRole("heading", { name: "Another website" })).toBeVisible();
  expect(await worker.evaluate(() => clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => windows.length))).toBe(0);
  await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data });
  await expect.poll(() => visibleNotices(worker)).toEqual(["New Lock-in sheet"]);
  await expect(page).toHaveURL("https://outside.example.test/");
  expect(await worker.evaluate(() => globalThis.__pushNotices[0].options)).toMatchObject({
    body: "Ready", tag: `lock-in:${NOTICE}`, icon: "/icons/lockin-gold-192-v3.png", data: { binding: BINDING, id: NOTICE }
  });
  await page.goto("/#/settings?section=notifications");
  await expect(panel.getByText("Enabled on this device", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__pushAsks)).toBe(0);
  await panel.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(panel.getByText("Off on this device", { exact: true })).toBeVisible();
  // Clear the fake OS surface; the next delivery must be suppressed by the worker.
  await worker.evaluate(() => { globalThis.__pushNotices = []; });
  await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data });
  await page.waitForTimeout(400);
  expect(await visibleNotices(worker)).toEqual([]);
  expect(changes).toEqual(["POST", "DELETE"]);
});

test("iPhone browser view explains installation and never asks for permission", async ({ page }) => {
  await server(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { get: () => "iPhone" });
    Object.defineProperty(navigator, "standalone", { get: () => false });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/settings?section=notifications");
  const panel = page.locator("#settings-device-push");
  await expect(panel).toContainText("Home Screen");
  await expect(panel.getByRole("button", { name: "Enable notifications" })).toBeDisabled();
  expect(await page.evaluate(() => window.__pushAsks)).toBe(0);
});


test("a closed Lock-in tab still receives push and its click requests the inbox", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  const { registrations, worker } = await enrollDevice(page, context);
  const origin = new URL(baseURL).origin;
  await expect.poll(() => registrations().some((item) => item.scopeURL === origin + "/" && !item.isDeleted)).toBe(true);
  const registrationId = registrations().findLast((item) => item.scopeURL === origin + "/" && !item.isDeleted).registrationId;
  await context.route("https://outside.example.test/**", (route) => route.fulfill({
    contentType: "text/html", body: "<title>Outside Lock-in</title><h1>Another website</h1>"
  }));
  const outside = await context.newPage();
  await outside.goto("https://outside.example.test/");
  const cdp = await context.newCDPSession(outside);
  await cdp.send("ServiceWorker.enable");
  await page.close();
  expect(context.pages()).toEqual([outside]);
  expect(await worker.evaluate(() => clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => windows.length))).toBe(0);
  await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: JSON.stringify({
    id: NOTICE, binding: BINDING, title: "إشعار من Lock-in", body: "وصلك الإشعار وأنت خارج الموقع",
    url: "https://untrusted.example.test/", expires_at: new Date(Date.now() + 60_000).toISOString()
  }) });
  await expect.poll(() => visibleNotices(worker)).toEqual(["إشعار من Lock-in"]);
  // Headless Chromium has no clickable OS notification surface. Invoke the
  // real click listener but capture openWindow's requested URL, without
  // pretending this is a physical notification click or an OS display test.
  const click = await worker.evaluate(async () => {
    const opened = [];
    let closed = false;
    let pending;
    const original = clients.openWindow;
    clients.openWindow = async (url) => { opened.push(url); return null; };
    try {
      const notice = globalThis.__pushNotices[0];
      const event = new Event("notificationclick");
      Object.defineProperties(event, {
        notification: { value: { data: notice.options.data, close: () => { closed = true; } } },
        waitUntil: { value: (promise) => { pending = promise; } }
      });
      self.dispatchEvent(event);
      await pending;
      return { opened, closed };
    } finally { clients.openWindow = original; }
  });
  expect(click).toEqual({ opened: [origin + "/#/notifications"], closed: true });
  await expect(outside).toHaveURL("https://outside.example.test/");
});
