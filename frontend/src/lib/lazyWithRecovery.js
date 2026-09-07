import { lazy } from "react";

const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|loading chunk .+ failed|chunkloaderror/i;

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
  await refreshServiceWorker();
  // This function is called only from an explicit “Update and reload” action.
  // A backgrounded browser can discard a lazy module, but that must never turn
  // returning to the app into an unsolicited navigation or state reset.
  window.location.reload();
}

export function lazyWithRecovery(loader) {
  return lazy(async () => {
    try {
      return await loader();
    } catch (error) {
      if (!isChunkLoadError(error) || typeof window === "undefined") throw error;

      const staleError = new Error("A newer version of Lock-in is ready. Update and reload to continue.");
      staleError.name = "StaleClientError";
      // @ts-expect-error Application errors carry a stable machine-readable code.
      staleError.code = "STALE_CLIENT_BUILD";
      staleError.cause = error;
      throw staleError;
    }
  });
}
