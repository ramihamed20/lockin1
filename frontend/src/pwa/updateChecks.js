// A browser only looks for a new service worker when it navigates. An
// installed app that is resumed from the background -- an iPad left on the
// Studio all week -- does not navigate, so it could keep running a build the
// server no longer matches. These checks ask for the worker again when the app
// comes back to the foreground and once an hour while it stays open. Finding
// one only raises the existing "update available" prompt; nothing reloads on
// its own, so work in progress is never interrupted.

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
export const UPDATE_CHECK_MIN_GAP_MS = 5 * 60 * 1000;

/**
 * Whether enough time has passed since the last check to ask again.
 * @param {number | null} lastCheckedAt
 * @param {number} now
 */
export function shouldCheckForUpdate(lastCheckedAt, now, minGap = UPDATE_CHECK_MIN_GAP_MS) {
  return lastCheckedAt == null || now - lastCheckedAt >= minGap;
}

/**
 * Starts foreground and periodic update checks for a registration.
 * @param {ServiceWorkerRegistration | undefined} registration
 * @param {{ now?: () => number }} [options]
 * @returns {() => void} stop
 */
export function scheduleUpdateChecks(registration, { now = () => Date.now() } = {}) {
  if (!registration || typeof registration.update !== "function") return () => {};
  let lastCheckedAt = now();
  function check() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (document.visibilityState !== "visible") return;
    // A worker already downloading or waiting has been found; asking again
    // would only repeat the download.
    if (registration.installing || registration.waiting) return;
    const current = now();
    if (!shouldCheckForUpdate(lastCheckedAt, current)) return;
    lastCheckedAt = current;
    registration.update().catch(() => {
      // Offline or a transient server error: the next foreground or interval
      // tries again. The running build keeps working either way.
    });
  }
  const onVisibility = () => { if (document.visibilityState === "visible") check(); };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", check);
  const timer = window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", check);
    window.clearInterval(timer);
  };
}
