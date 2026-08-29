import assert from "node:assert/strict";
import test from "node:test";
import { resolvePwaLaunchState } from "../src/pwa/launchState.js";
import {
  PWA_DISMISSAL_COOLDOWN_MS,
  hasActivePwaDismissal,
  isAndroid,
  isIOS,
  isStandalone,
  isTouchDevice,
  rememberPwaDismissal
} from "../src/pwa/platform.js";

function baseState(overrides = {}) {
  return {
    standalone: false,
    installedMemory: false,
    dismissed: false,
    serviceWorkerStatus: "ready",
    documentReady: true,
    promptAvailable: false,
    ios: false,
    android: false,
    touch: false,
    ...overrides
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

test("PWA launch state prioritizes installed and real prompt signals", () => {
  assert.equal(resolvePwaLaunchState(baseState({ standalone: true, dismissed: true })), "installed");
  assert.equal(resolvePwaLaunchState(baseState({ serviceWorkerStatus: "checking", promptAvailable: true })), "checking");
  assert.equal(resolvePwaLaunchState(baseState({ promptAvailable: true, android: true, touch: true })), "installable");
  assert.equal(resolvePwaLaunchState(baseState({ ios: true, touch: true })), "ios-instructions");
  assert.equal(resolvePwaLaunchState(baseState({ android: true, touch: true })), "manual-install");
  assert.equal(resolvePwaLaunchState(baseState({ touch: true })), "unsupported");
  assert.equal(resolvePwaLaunchState(baseState()), "ready");
});

test("platform helpers cover Android tablets and iPadOS standalone mode", () => {
  const standaloneWindow = { matchMedia: () => ({ matches: true }) };
  assert.equal(isStandalone(standaloneWindow, {}), true);
  assert.equal(isAndroid({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel Tablet)" }), true);
  assert.equal(isIOS({ userAgent: "Mozilla/5.0", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isTouchDevice({ matchMedia: () => ({ matches: true }) }, { maxTouchPoints: 0 }), true);
});

test("continue-in-browser dismissal expires instead of hiding forever", () => {
  const storage = memoryStorage();
  const now = 1_900_000_000_000;
  rememberPwaDismissal(now, storage);
  assert.equal(hasActivePwaDismissal(now + PWA_DISMISSAL_COOLDOWN_MS - 1, storage), true);
  assert.equal(hasActivePwaDismissal(now + PWA_DISMISSAL_COOLDOWN_MS, storage), false);
});
