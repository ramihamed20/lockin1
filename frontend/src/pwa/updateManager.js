// One owner for "is there a newer Lock-in, and when does it take over".
//
// vite-plugin-pwa registers the worker (prompt mode, injectManifest). This
// module sits on top of that single registration and adds what the plugin
// does not do on its own:
//
// - It asks for a new worker when the app starts, returns to the foreground,
//   regains focus, comes back online, and every 30 minutes while visible. A
//   browser only looks for a new worker when it navigates, and an installed app
//   resumed from the background never navigates.
// - It reads "update available" from the registration itself (a waiting worker
//   beside an active one). workbox-window stops listening for `updatefound`
//   after the first external update, so its callbacks alone miss a second
//   deployment inside one long session.
// - It reloads only the window whose reader chose "Update now", and only once.
//   The plugin's default reloads every window that saw the prompt, and never
//   reloads a window that was uncontrolled when it registered -- the first
//   launch of a freshly installed app -- so "Update now" silently did nothing.
//
// Nothing here reloads on its own. Finding an update only changes state; the
// reader decides when. Activation never touches IndexedDB, localStorage, or the
// per-account offline caches: the new worker's own `activate` handler only
// replaces Workbox's precache entries and the build-versioned optional asset
// cache, both of which are regenerated from the network.

export const UPDATE_STATUS = Object.freeze({
  IDLE: "idle",
  CHECKING: "checking",
  UP_TO_DATE: "upToDate",
  AVAILABLE: "updateAvailable",
  UPDATING: "updating",
  /** Another window activated the update; this one still runs the old build. */
  RELOAD_REQUIRED: "reloadRequired",
  OFFLINE: "offline",
  ERROR: "error",
  UNSUPPORTED: "unsupported"
});

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Automatic triggers (focus, visibility, interval) never fire closer than this. */
export const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;
export const STARTUP_CHECK_DELAY_MS = 3000;
export const UPDATE_REQUEST_TIMEOUT_MS = 20 * 1000;
/** The new worker precaches the whole app shell before it can wait. */
export const INSTALL_WAIT_TIMEOUT_MS = 90 * 1000;
export const ACTIVATION_TIMEOUT_MS = 15 * 1000;
/** "Later" hides the global prompt for this long. Settings still offers it. */
export const LATER_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** @type {Set<string>} */
const STABLE_AFTER_FAILED_AUTOMATIC_CHECK = new Set([
  UPDATE_STATUS.IDLE,
  UPDATE_STATUS.UP_TO_DATE,
  UPDATE_STATUS.OFFLINE,
  UPDATE_STATUS.ERROR
]);

/**
 * Whether enough time has passed since the last automatic check to ask again.
 * @param {number | null} lastAttemptAt
 * @param {number} now
 */
export function shouldCheckForUpdate(lastAttemptAt, now, minGap = UPDATE_CHECK_MIN_GAP_MS) {
  return lastAttemptAt == null || now - lastAttemptAt >= minGap;
}

function defaultEnvironment() {
  const win = /** @type {any} */ (globalThis.window);
  return {
    navigator: globalThis.navigator,
    document: globalThis.document,
    window: win,
    now: () => Date.now(),
    reload: () => win.location.reload(),
    isOffline: () => globalThis.navigator?.onLine === false,
    enabled: () => Boolean(import.meta.env?.PROD) && Boolean(globalThis.navigator && "serviceWorker" in globalThis.navigator)
  };
}

/**
 * @typedef {{
 *   status: string,
 *   lastCheckedAt: number | null,
 *   dismissed: boolean,
 *   error: string,
 *   serviceWorker: "checking" | "ready" | "error" | "unsupported",
 *   offlineReady: boolean
 * }} UpdateSnapshot
 */

/**
 * @param {Partial<ReturnType<typeof defaultEnvironment>>} [overrides]
 */
export function createUpdateManager(overrides = {}) {
  /** @type {ReturnType<typeof defaultEnvironment>} */
  let env = null;
  const environment = () => {
    if (!env) env = { ...defaultEnvironment(), ...overrides };
    return env;
  };

  const listeners = new Set();
  /** @type {UpdateSnapshot} */
  let snapshot = {
    status: UPDATE_STATUS.IDLE,
    lastCheckedAt: null,
    dismissed: false,
    error: "",
    serviceWorker: environment().enabled() ? "checking" : "unsupported",
    offlineReady: false
  };

  /** @type {ServiceWorkerRegistration | null} */
  let registration = null;
  /** @type {null | ((reloadPage?: boolean) => Promise<void>)} */
  let pluginUpdate = null;
  let started = false;
  let triggersInstalled = false;
  /** @type {Promise<void> | null} */
  let inFlight = null;
  let inFlightManual = false;
  /** @type {Promise<void> | null} */
  let queuedManual = null;
  /** @type {Promise<void> | null} */
  let applying = null;
  let reloading = false;
  let lastAttemptAt = null;
  let dismissedUntil = 0;
  let hadController = false;
  let controllerChanged = false;
  /** @type {Array<() => void>} */
  const teardown = [];

  function set(patch) {
    const next = { ...snapshot, ...patch };
    if (Object.keys(next).every((key) => next[key] === snapshot[key])) return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  }

  function hasUpdate() {
    // A waiting worker beside an active one is a newer build ready to take
    // over. (A waiting worker with no active one cannot happen: the very first
    // worker activates straight away.)
    return Boolean(registration?.waiting && registration.active);
  }

  function refreshDismissal() {
    if (snapshot.dismissed && environment().now() >= dismissedUntil) set({ dismissed: false });
  }

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    environment().reload();
  }

  function syncFromRegistration() {
    if (!registration) return;
    if (snapshot.status === UPDATE_STATUS.UPDATING || snapshot.status === UPDATE_STATUS.RELOAD_REQUIRED) return;
    if (hasUpdate()) set({ status: UPDATE_STATUS.AVAILABLE, error: "" });
  }

  function watchInstallingWorker(worker) {
    if (!worker || typeof worker.addEventListener !== "function") return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed") {
        syncFromRegistration();
      } else if (worker.state === "redundant" && snapshot.status === UPDATE_STATUS.CHECKING && !inFlight) {
        // The download failed part-way. The running build is untouched.
        set({ status: hasUpdate() ? UPDATE_STATUS.AVAILABLE : UPDATE_STATUS.ERROR, error: hasUpdate() ? "" : "download-failed" });
      }
    });
  }

  function waitForInstall(worker) {
    if (!worker || worker.state !== "installing") return Promise.resolve();
    const { window: win } = environment();
    return new Promise((resolve) => {
      const timer = win.setTimeout(done, INSTALL_WAIT_TIMEOUT_MS);
      function done() {
        win.clearTimeout(timer);
        worker.removeEventListener?.("statechange", onChange);
        resolve();
      }
      function onChange() {
        if (worker.state !== "installing") done();
      }
      worker.addEventListener("statechange", onChange);
    });
  }

  function withTimeout(promise, ms) {
    const { window: win } = environment();
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => win.clearTimeout(timer)),
      new Promise((_, reject) => { timer = win.setTimeout(() => reject(new Error("update-timeout")), ms); })
    ]);
  }

  /**
   * Ask the server whether a newer worker exists.
   * @param {{ manual?: boolean, force?: boolean }} [options]
   *   `manual` comes from the Settings button: it bypasses throttling, reveals a
   *   dismissed update again, and reports failures. `force` bypasses throttling
   *   only (reconnecting after being offline).
   * @returns {Promise<void>}
   */
  function check({ manual = false, force = false } = {}) {
    if (inFlight) {
      if (!manual || inFlightManual) return inFlight;
      // A deployment may have changed after the automatic request started.
      // Coalesce manual presses, then check again once that request settles.
      if (!queuedManual) queuedManual = inFlight.then(() => {
        queuedManual = null;
        return check({ manual: true });
      });
      return queuedManual;
    }
    const { status } = snapshot;
    if (status === UPDATE_STATUS.UPDATING || status === UPDATE_STATUS.RELOAD_REQUIRED) return Promise.resolve();
    if (manual) {
      dismissedUntil = 0;
      set({ dismissed: false });
    }
    if (!registration) {
      if (manual && status !== UPDATE_STATUS.UNSUPPORTED) set({ status: UPDATE_STATUS.ERROR, error: "not-registered" });
      return Promise.resolve();
    }
    // Already downloaded: it applies offline too, because the new worker has
    // finished precaching everything it serves.
    if (hasUpdate()) {
      set({ status: UPDATE_STATUS.AVAILABLE, error: "" });
      return Promise.resolve();
    }
    if (environment().isOffline()) {
      set({ status: UPDATE_STATUS.OFFLINE, error: "" });
      return Promise.resolve();
    }
    const current = environment().now();
    if (!manual && !force && !shouldCheckForUpdate(lastAttemptAt, current)) return Promise.resolve();
    lastAttemptAt = current;

    const previous = status === UPDATE_STATUS.CHECKING ? UPDATE_STATUS.IDLE : status;
    set({ status: UPDATE_STATUS.CHECKING, error: "" });
    const target = registration;
    inFlightManual = manual;
    inFlight = (async () => {
      try {
        await withTimeout(target.update(), UPDATE_REQUEST_TIMEOUT_MS);
        await waitForInstall(target.installing);
        if (hasUpdate()) {
          set({ status: UPDATE_STATUS.AVAILABLE, lastCheckedAt: environment().now() });
        } else if (target.installing) {
          // Still downloading after the wait. The statechange watcher moves to
          // "available" when it finishes; do not claim "latest" meanwhile.
          set({ lastCheckedAt: environment().now() });
        } else {
          set({ status: UPDATE_STATUS.UP_TO_DATE, lastCheckedAt: environment().now() });
        }
      } catch {
        if (environment().isOffline()) {
          set({ status: UPDATE_STATUS.OFFLINE });
        } else if (manual) {
          set({ status: UPDATE_STATUS.ERROR, error: "check-failed" });
        } else {
          // An automatic check is invisible: a transient failure keeps the
          // last known answer and the next trigger tries again.
          set({ status: STABLE_AFTER_FAILED_AUTOMATIC_CHECK.has(previous) ? previous : UPDATE_STATUS.IDLE });
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  /**
   * Activate the waiting worker and reload this window exactly once, after the
   * new worker controls it. Repeated presses share one attempt.
   * @returns {Promise<void>}
   */
  function applyUpdate() {
    if (applying) return applying;
    if (snapshot.status === UPDATE_STATUS.RELOAD_REQUIRED) {
      reloadOnce();
      return Promise.resolve();
    }
    const waiting = registration?.waiting;
    if (!waiting) {
      // Another window may have activated it between the prompt and the tap.
      if (controllerChanged) {
        reloadOnce();
        return Promise.resolve();
      }
      return check({ manual: true });
    }

    const { window: win, navigator: nav } = environment();
    set({ status: UPDATE_STATUS.UPDATING, dismissed: false, error: "" });
    applying = new Promise((resolve) => {
      let settled = false;
      const finish = (reload) => {
        if (settled) return;
        settled = true;
        win.clearTimeout(timer);
        nav.serviceWorker?.removeEventListener?.("controllerchange", onControllerChange);
        if (reload) {
          reloadOnce();
        } else {
          applying = null;
          set({ status: hasUpdate() ? UPDATE_STATUS.AVAILABLE : UPDATE_STATUS.ERROR, error: "activation-failed" });
        }
        resolve();
      };
      const onControllerChange = () => finish(true);
      const timer = win.setTimeout(() => {
        // `controllerchange` can be missed if the worker was claimed before the
        // listener existed. If it is active, the reload is still correct.
        finish(waiting.state === "activated" || waiting.state === "activating");
      }, ACTIVATION_TIMEOUT_MS);
      nav.serviceWorker?.addEventListener?.("controllerchange", onControllerChange);
      Promise.resolve()
        .then(() => (pluginUpdate ? pluginUpdate(true) : waiting.postMessage({ type: "SKIP_WAITING" })))
        .catch(() => finish(false));
    });
    return applying;
  }

  /** "Later": hide the global prompt for a while. The worker keeps waiting. */
  function dismiss() {
    dismissedUntil = environment().now() + LATER_COOLDOWN_MS;
    set({ dismissed: true });
  }

  function onControllerChange() {
    const previous = hadController;
    hadController = true;
    controllerChanged = previous || controllerChanged;
    if (applying) return; // applyUpdate's own listener reloads this window.
    // The first claim after a fresh install is not an update. Any later change
    // means another window activated a new build: say so, but never reload a
    // window that someone may be studying in.
    if (previous) set({ status: UPDATE_STATUS.RELOAD_REQUIRED, dismissed: false, error: "" });
  }

  function installTriggers() {
    if (triggersInstalled) return;
    triggersInstalled = true;
    const { window: win, document: doc, navigator: nav } = environment();
    const automatic = () => {
      refreshDismissal();
      void check();
    };
    const onVisibility = () => { if (doc.visibilityState === "visible") automatic(); };
    const onOnline = () => {
      if (snapshot.status === UPDATE_STATUS.OFFLINE) set({ status: UPDATE_STATUS.IDLE });
      refreshDismissal();
      void check({ force: true });
    };
    const onOffline = () => {
      if (snapshot.status === UPDATE_STATUS.IDLE || snapshot.status === UPDATE_STATUS.UP_TO_DATE || snapshot.status === UPDATE_STATUS.ERROR) {
        set({ status: UPDATE_STATUS.OFFLINE, error: "" });
      }
    };
    const onInterval = () => { if (doc.visibilityState === "visible") automatic(); };

    doc.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("focus", automatic);
    win.addEventListener("online", onOnline);
    win.addEventListener("offline", onOffline);
    nav.serviceWorker?.addEventListener?.("controllerchange", onControllerChange);
    const interval = win.setInterval(onInterval, UPDATE_CHECK_INTERVAL_MS);
    const startup = win.setTimeout(() => { void check({ force: true }); }, STARTUP_CHECK_DELAY_MS);
    teardown.push(() => {
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("focus", automatic);
      win.removeEventListener("online", onOnline);
      win.removeEventListener("offline", onOffline);
      nav.serviceWorker?.removeEventListener?.("controllerchange", onControllerChange);
      win.clearInterval(interval);
      win.clearTimeout(startup);
    });
  }

  /**
   * Called with the plugin's registration once it exists.
   * @param {ServiceWorkerRegistration} nextRegistration
   */
  function attach(nextRegistration) {
    if (!nextRegistration || registration === nextRegistration) return;
    registration = nextRegistration;
    hadController = Boolean(environment().navigator.serviceWorker?.controller);
    registration.addEventListener?.("updatefound", () => watchInstallingWorker(registration.installing));
    watchInstallingWorker(registration.installing);
    syncFromRegistration();
    installTriggers();
  }

  /**
   * Register through vite-plugin-pwa's `registerSW`. Safe to call repeatedly;
   * only the first call registers.
   * @param {typeof import("virtual:pwa-register").registerSW} registerSW
   */
  function start(registerSW) {
    if (started) return;
    started = true;
    if (!environment().enabled()) {
      set({ status: UPDATE_STATUS.UNSUPPORTED, serviceWorker: "unsupported" });
      return;
    }
    pluginUpdate = registerSW({
      immediate: true,
      onNeedRefresh: syncFromRegistration,
      // Passing this replaces the plugin's own unconditional reload of every
      // window. The `controllerchange` listener above decides instead: this
      // window reloads from applyUpdate, other windows are only told.
      onNeedReload: () => {},
      onOfflineReady: () => set({ serviceWorker: "ready", offlineReady: true }),
      onRegisteredSW: (_url, nextRegistration) => {
        if (!nextRegistration) return;
        attach(nextRegistration);
        environment().navigator.serviceWorker.ready
          .then(() => set({ serviceWorker: "ready" }))
          .catch(() => set({ serviceWorker: "error" }));
      },
      onRegisterError: () => set({ serviceWorker: "error", status: UPDATE_STATUS.UNSUPPORTED })
    });
  }

  return {
    start,
    attach,
    check,
    applyUpdate,
    dismiss,
    hasUpdate,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Test seam: stop listeners and timers. */
    stop() {
      teardown.splice(0).forEach((undo) => undo());
      triggersInstalled = false;
    }
  };
}

export const pwaUpdates = createUpdateManager();
