import { request } from "../api/client.js";
import { isIOS, isStandalone } from "./platform.js";
import { readPushBinding, writePushBinding, clearPushBinding } from "./pushStorage.js";

export function pushSupport() {
  if (isIOS() && !isStandalone()) return "install";
  if (!globalThis.isSecureContext || !globalThis.Notification || !globalThis.PushManager || !navigator.serviceWorker) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

export function pushPublicKey(value) {
  const raw = globalThis.atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function pushState(userId) {
  const binding = await readPushBinding().catch(() => null);
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  const hash = subscription ? Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new globalThis.TextEncoder().encode(subscription.endpoint))), (byte) => byte.toString(16).padStart(2, "0")).join("") : "";
  const config = await request("/notifications/push" + (hash ? `?installation=${hash}` : ""));
  return { config, enabled: Boolean(binding?.userId === String(userId) && subscription && config.registered && binding.binding === config.binding && globalThis.Notification?.permission === "granted") };
}

export async function enableDevicePush(userId, publicKey, assertCurrent = () => {}) {
  // Keep the permission request in the click's activation, before any awaits.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("push.denied");
  assertCurrent();
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) throw new Error("push.workerUnavailable");
  const key = pushPublicKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const previous = new Uint8Array(subscription.options.applicationServerKey || []);
    if (previous.length !== key.length || previous.some((byte, index) => byte !== key[index])) {
      await subscription.unsubscribe();
      await request("/notifications/push", { method: "DELETE", body: { user_id: String(userId), endpoint: subscription.endpoint } });
      subscription = null;
    }
  }
  assertCurrent();
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const payload = await request("/notifications/push", {
    method: "POST", body: { user_id: String(userId), subscription: subscription.toJSON(), locale: document.documentElement.lang }
  });
  assertCurrent();
  await writePushBinding({ userId: String(userId), binding: payload.binding }, "", assertCurrent);
  assertCurrent();
}

export async function disableDevicePush(userId) {
  await forgetPushAccount(String(userId)); // Local delivery stops even offline.
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) return;
  try {
    await request("/notifications/push", { method: "DELETE", body: { user_id: String(userId), endpoint: subscription.endpoint } });
  } finally {
    // Another tab may have enabled this installation for a different account.
    if (!(await readPushBinding().catch(() => null))) await subscription.unsubscribe();
  }
}

export async function testDevicePush(userId) {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) throw new Error("push.workerUnavailable");
  const response = await request("/notifications/push/test", { method: "POST", body: { user_id: String(userId), endpoint: subscription.endpoint } });
  if (!response?.queued) throw new Error("push.saveFailed");
  return response;
}

/** Close this account's visible notices without touching a different tab's binding. */
export async function forgetPushAccount(userId) {
  const previous = await readPushBinding().catch(() => null);
  if (!previous || previous.userId !== String(userId)) return;
  await clearPushBinding(String(userId));
  const registration = await navigator.serviceWorker?.getRegistration();
  const notices = await registration?.getNotifications?.() || [];
  for (const notice of notices) if (notice.data?.binding === previous.binding) notice.close();
}
