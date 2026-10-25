import assert from "node:assert/strict";
import test from "node:test";
import { notificationFromPush } from "../src/pwa/pushMessage.js";
import { installOfflineEnvironment } from "./helpers/offlineEnvironment.js";
const env = installOfflineEnvironment();
const { readPushBinding, writePushBinding, clearPushBinding } = await import("../src/pwa/pushStorage.js");
const { pushSupport, enableDevicePush, disableDevicePush } = await import("../src/pwa/devicePush.js");
const binding = { userId: "alice", binding: "installation-alice" };
const payload = { id: "11111111-1111-4111-8111-111111111111", binding: binding.binding,
  title: "New sheet", body: "Ready", expires_at: new Date(Date.now() + 60_000).toISOString() };

test("push messages require the current account marker and a live session", () => {
  assert.equal(notificationFromPush(payload, binding).title, "New sheet");
  assert.equal(notificationFromPush(payload, { ...binding, binding: "another-account" }), null);
  assert.equal(notificationFromPush(payload, null), null);
  assert.equal(notificationFromPush({ ...payload, expires_at: "2020-01-01" }, binding), null);
  assert.equal(notificationFromPush({ ...payload, title: {} }, binding), null);
  assert.equal(notificationFromPush({ ...payload, id: "https://evil.test" }, binding), null);
  const notice = notificationFromPush({ ...payload, url: "https://evil.test" }, binding);
  assert.equal(notice.options.data.url, undefined);
  assert.equal(notice.options.tag, `lock-in:${payload.id}`);
});

test("account-scoped clearing cannot erase another tab's newly enabled account", async () => {
  await writePushBinding(binding);
  await clearPushBinding("bob");
  assert.deepEqual(await readPushBinding(), binding);
  await clearPushBinding("alice");
  assert.equal(await readPushBinding(), null);
});

test("iPhone browser tabs receive installation instructions before permission prompts", () => {
  navigator.userAgent = "iPhone";
  navigator.standalone = false;
  assert.equal(pushSupport(), "install");
  navigator.userAgent = "desktop";
});

test("enrollment is a user action and writes only a non-secret binding", async () => {
  let asks = 0;
  globalThis.Notification = { permission: "default", requestPermission: async () => { asks++; return "granted"; } };
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test", toJSON: () => ({ endpoint: "test", keys: {} }) };
  navigator.serviceWorker = { getRegistration: async () => ({ active: true, pushManager: {
    getSubscription: async () => null, subscribe: async (options) => {
      assert.equal(options.userVisibleOnly, true); return subscription;
    }
  } }) };
  env.route("POST /notifications/push", ({ body }) => {
    assert.equal(body.user_id, "alice"); return { binding: "server-binding" };
  });
  await enableDevicePush("alice", "AQID");
  assert.equal(asks, 1);
  assert.deepEqual(await readPushBinding(), { userId: "alice", binding: "server-binding" });
});

test("denied permission or an obsolete account never registers a subscription", async () => {
  const before = env.calls.length;
  Notification.requestPermission = async () => "denied";
  await assert.rejects(enableDevicePush("alice", "AQID"), /push.denied/);
  assert.equal(env.calls.length, before);
  Notification.requestPermission = async () => "granted";
  await assert.rejects(enableDevicePush("alice", "AQID", () => { throw new Error("changed"); }), /changed/);
  assert.equal(env.calls.length, before);
});

test("disabling stops local display even when the server cannot be reached", async () => {
  await writePushBinding(binding);
  let unsubscribed = false;
  navigator.serviceWorker = { getRegistration: async () => ({ pushManager: {
    getSubscription: async () => ({ endpoint: "test", unsubscribe: async () => { unsubscribed = true; } })
  } }) };
  env.goOffline();
  await assert.rejects(disableDevicePush("alice"));
  assert.equal(await readPushBinding(), null);
  assert.equal(unsubscribed, true);
  env.goOnline();
});

test("logout closes only the current account's visible notices", async () => {
  const { forgetPushAccount } = await import("../src/pwa/devicePush.js");
  await writePushBinding(binding);
  const closed = [];
  navigator.serviceWorker = { getRegistration: async () => ({ getNotifications: async () => [
    { data: { binding: binding.binding }, close: () => closed.push("alice") },
    { data: { binding: "someone-else" }, close: () => closed.push("other") }
  ] }) };
  await forgetPushAccount("bob");
  assert.deepEqual(closed, []);
  await forgetPushAccount("alice");
  assert.deepEqual(closed, ["alice"]);
  assert.equal(await readPushBinding(), null);
});

test("an enrollment finishing after account cleanup cannot restore its binding", async () => {
  await clearPushBinding("alice");
  await assert.rejects(writePushBinding(binding, "", () => { throw new Error("account changed"); }), /account changed/);
  assert.equal(await readPushBinding(), null);
});
