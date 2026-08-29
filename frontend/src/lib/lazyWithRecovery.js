/* global __APP_VERSION__ */
import { lazy } from "react";

const RECOVERY_MARKER = "lock-in.chunk-recovery";
const RECOVERY_WINDOW_MS = 60_000;
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "development";
const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk .+ failed|chunkloaderror/i;

function readRecoveryMarker() {
  try {
    return JSON.parse(window.sessionStorage.getItem(RECOVERY_MARKER) || "null");
  } catch {
    return null;
  }
}

function writeRecoveryMarker() {
  try {
    window.sessionStorage.setItem(RECOVERY_MARKER, JSON.stringify({
      at: Date.now(),
      href: window.location.href,
      version: APP_VERSION
    }));
  } catch {
    // A reload still works when storage is unavailable; the recovery screen
    // remains the final guard against repeated automatic reloads.
  }
}

function clearRecoveryMarker() {
  try {
    window.sessionStorage.removeItem(RECOVERY_MARKER);
  } catch {
    // Storage access is optional.
  }
}

async function refreshServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    await Promise.race([
      registration?.update?.(),
      new Promise((resolve) => window.setTimeout(resolve, 800))
    ]);
  } catch {
    // The network reload remains useful even when no service worker is active.
  }
}

export function isChunkLoadError(error) {
  return Boolean(error && CHUNK_ERROR_PATTERN.test(String(error.message || error)));
}

export function isStaleClientError(error) {
  return error?.code === "STALE_CLIENT_BUILD" || isChunkLoadError(error);
}

export async function reloadForUpdate() {
  if (typeof window === "undefined") return;
  writeRecoveryMarker();
  await refreshServiceWorker();
  window.location.reload();
}

export function lazyWithRecovery(loader) {
  return lazy(async () => {
    try {
      const loadedModule = await loader();
      clearRecoveryMarker();
      return loadedModule;
    } catch (error) {
      if (!isChunkLoadError(error) || typeof window === "undefined") throw error;

      const marker = readRecoveryMarker();
      const automaticRecoveryIsRecent = marker && Date.now() - Number(marker.at || 0) < RECOVERY_WINDOW_MS;

      if (!automaticRecoveryIsRecent && navigator.onLine !== false) {
        await reloadForUpdate();
        return new Promise(() => {});
      }

      const staleError = new Error("A newer version of Lock-in is ready. Update and reload to continue.");
      staleError.name = "StaleClientError";
      // @ts-expect-error Application errors carry a stable machine-readable code.
      staleError.code = "STALE_CLIENT_BUILD";
      staleError.cause = error;
      throw staleError;
    }
  });
}
