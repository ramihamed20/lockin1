import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ACTIVATION_TIMEOUT_MS,
  LATER_COOLDOWN_MS,
  STARTUP_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  UPDATE_STATUS,
  createUpdateManager,
  shouldCheckForUpdate
} from "../src/pwa/updateManager.js";
import { describeBuild } from "../src/pwa/buildInfo.js";

function emitter() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    emit(type) { [...(handlers.get(type) || [])].forEach((handler) => handler()); },
    count(type) { return handlers.get(type)?.size || 0; }
  };
}

function fakeWorker(state) {
  const events = emitter();
  const worker = {
    state,
    messages: [],
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    postMessage(message) { worker.messages.push(message); },
    setState(next) { worker.state = next; events.emit("statechange"); }
  };
  return worker;
}

function fakeRegistration() {
  const events = emitter();
  const registration = {
    installing: null,
    waiting: null,
    active: fakeWorker("activated"),
    updateCalls: 0,
    updateImpl: async () => {},
    update() { registration.updateCalls += 1; return registration.updateImpl(); },
    addEventListener: events.addEventListener,
    removeEventListener: events.removeEventListener,
    emit: events.emit
  };
  return registration;
}

/** A newer worker that downloads, then waits beside the active one. */
function publishUpdate(registration) {
  const worker = fakeWorker("installing");
  registration.installing = worker;
  registration.emit("updatefound");
  return {
    worker,
    finishInstall() {
      registration.installing = null;
      registration.waiting = worker;
      worker.setState("installed");
    }
  };
}

function fakeEnvironment({ online = true, controlled = true } = {}) {
  let clock = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  const win = emitter();
  const doc = emitter();
  const container = emitter();
  const env = {
    reloads: 0,
    navigator: {
      onLine: online,
      serviceWorker: {
        controller: controlled ? {} : null,
        ready: Promise.resolve(),
        addEventListener: container.addEventListener,
        removeEventListener: container.removeEventListener
      }
    },
    document: { visibilityState: "visible", addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener },
    window: {
      addEventListener: win.addEventListener,
      removeEventListener: win.removeEventListener,
      setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: clock + ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      setInterval(fn, ms) { const id = nextId++; timers.set(id, { fn, at: clock + ms, every: ms }); return id; },
      clearInterval(id) { timers.delete(id); }
    },
    now: () => clock,
    reload: () => { env.reloads += 1; },
    isOffline: () => env.navigator.onLine === false,
    enabled: () => true,
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        clock = timer.at;
        if (timer.every) timer.at += timer.every; else timers.delete(id);
        timer.fn();
      }
      clock = target;
    },
    fire: { window: win.emit, document: doc.emit, controllerchange: () => container.emit("controllerchange") },
    listenerCount: { window: win.count, document: doc.count }
  };
  return env;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(options) {
  const env = fakeEnvironment(options);
  const manager = createUpdateManager(env);
  const registration = fakeRegistration();
  manager.attach(registration);
  return { env, manager, registration };
}

test("automatic checks are throttled", () => {
  assert.equal(shouldCheckForUpdate(null, 1000), true);
  assert.equal(shouldCheckForUpdate(1000, 1000 + UPDATE_CHECK_MIN_GAP_MS - 1), false);
  assert.equal(shouldCheckForUpdate(1000, 1000 + UPDATE_CHECK_MIN_GAP_MS), true);
});

test("no update available reports the latest version and when it was checked", async () => {
  const { env, manager, registration } = setup();
  await manager.check({ manual: true });
  assert.equal(registration.updateCalls, 1);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.UP_TO_DATE);
  assert.equal(manager.getSnapshot().lastCheckedAt, env.now());
  manager.stop();
});

test("a manual check finds, downloads, and offers a new version", async () => {
  const { manager, registration } = setup();
  registration.updateImpl = async () => {
    const update = publishUpdate(registration);
    setTimeout(update.finishInstall, 0);
  };
  const pending = manager.check({ manual: true });
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.CHECKING);
  await pending;
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.AVAILABLE);
  manager.stop();
});

test("a waiting worker found at registration is offered immediately", () => {
  const env = fakeEnvironment();
  const manager = createUpdateManager(env);
  const registration = fakeRegistration();
  registration.waiting = fakeWorker("installed");
  manager.attach(registration);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.AVAILABLE);
  manager.stop();
});

test("an update found by any trigger -- even a second one in a long session -- is noticed", () => {
  const { manager, registration } = setup();
  const update = publishUpdate(registration);
  update.finishInstall();
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.AVAILABLE);
  manager.stop();
});

test("offline: a manual check says so instead of claiming the latest version", async () => {
  const { env, manager, registration } = setup({ online: false });
  await manager.check({ manual: true });
  assert.equal(registration.updateCalls, 0);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.OFFLINE);

  env.navigator.onLine = true;
  env.fire.window("online");
  await flush();
  assert.equal(registration.updateCalls, 1, "reconnecting checks again");
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.UP_TO_DATE);
  manager.stop();
});

test("offline with an update already downloaded still offers it", async () => {
  const { env, manager, registration } = setup();
  registration.waiting = fakeWorker("installed");
  env.navigator.onLine = false;
  await manager.check({ manual: true });
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.AVAILABLE);
  manager.stop();
});

test("Later hides the prompt for a while, keeps the worker waiting, and Settings can still apply it", async () => {
  const { env, manager, registration } = setup();
  const waiting = fakeWorker("installed");
  registration.waiting = waiting;
  await manager.check();
  manager.dismiss();
  assert.equal(manager.getSnapshot().dismissed, true);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.AVAILABLE);
  assert.equal(registration.waiting, waiting);
  assert.deepEqual(waiting.messages, []);

  env.advance(UPDATE_CHECK_MIN_GAP_MS);
  env.fire.document("visibilitychange");
  assert.equal(manager.getSnapshot().dismissed, true, "still inside the cooldown");

  env.advance(LATER_COOLDOWN_MS);
  env.fire.document("visibilitychange");
  assert.equal(manager.getSnapshot().dismissed, false, "the prompt returns after the cooldown");

  manager.dismiss();
  await manager.check({ manual: true });
  assert.equal(manager.getSnapshot().dismissed, false, "a manual check reveals it again");
  manager.stop();
});

test("Update now activates the waiting worker and reloads exactly once after it takes control", async () => {
  const { env, manager, registration } = setup();
  const waiting = fakeWorker("installed");
  registration.waiting = waiting;
  await manager.check();

  const first = manager.applyUpdate();
  const second = manager.applyUpdate();
  assert.equal(first, second, "a second press joins the first attempt");
  await flush();
  assert.deepEqual(waiting.messages, [{ type: "SKIP_WAITING" }]);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.UPDATING);
  assert.equal(env.reloads, 0, "no reload before the new worker controls the page");

  env.fire.controllerchange();
  env.fire.controllerchange();
  await first;
  assert.equal(env.reloads, 1);
  manager.applyUpdate();
  assert.equal(env.reloads, 1);
  manager.stop();
});

test("Update now reloads a window that was uncontrolled at registration", async () => {
  // The first launch of a freshly installed app: workbox-window flags these
  // controller changes isUpdate=false and the plugin never reloaded them.
  const { env, manager, registration } = setup({ controlled: false });
  registration.waiting = fakeWorker("installed");
  const applying = manager.applyUpdate();
  await flush();
  env.fire.controllerchange();
  await applying;
  assert.equal(env.reloads, 1);
  manager.stop();
});

test("activation that never takes control fails safely and can be retried", async () => {
  const { env, manager, registration } = setup();
  const waiting = fakeWorker("installed");
  registration.waiting = waiting;
  const applying = manager.applyUpdate();
  await flush();
  env.advance(ACTIVATION_TIMEOUT_MS);
  await applying;
  assert.equal(env.reloads, 0);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.AVAILABLE);
  assert.equal(manager.getSnapshot().error, "activation-failed");

  const retry = manager.applyUpdate();
  assert.notEqual(retry, applying);
  await flush();
  assert.equal(waiting.messages.length, 2);
  manager.stop();
});

test("the plugin's skip-waiting API is used when the plugin registered the worker", async () => {
  const env = fakeEnvironment();
  const manager = createUpdateManager(env);
  const registration = fakeRegistration();
  const waiting = fakeWorker("installed");
  registration.waiting = waiting;
  let options = null;
  let registrations = 0;
  const pluginCalls = [];
  const registerSW = (received) => {
    registrations += 1;
    options = received;
    return async (reload) => { pluginCalls.push(reload); };
  };
  manager.start(registerSW);
  manager.start(registerSW);
  assert.equal(registrations, 1, "one registration, however often start runs");
  assert.equal(typeof options.onNeedReload, "function", "the plugin must not reload every window itself");
  options.onRegisteredSW("/service-worker.js", registration);
  await flush();
  assert.equal(manager.getSnapshot().serviceWorker, "ready");

  const applying = manager.applyUpdate();
  await flush();
  assert.deepEqual(pluginCalls, [true]);
  assert.deepEqual(waiting.messages, []);
  options.onNeedReload();
  env.fire.controllerchange();
  await applying;
  assert.equal(env.reloads, 1);
  manager.stop();
});

test("unsupported browsers never register and say so", () => {
  const env = fakeEnvironment();
  env.enabled = () => false;
  const manager = createUpdateManager(env);
  let registered = false;
  manager.start(() => { registered = true; return async () => {}; });
  assert.equal(registered, false);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.UNSUPPORTED);
  assert.equal(manager.getSnapshot().serviceWorker, "unsupported");
});

test("checks never overlap, however many triggers fire", async () => {
  const { env, manager, registration } = setup();
  let release;
  registration.updateImpl = () => new Promise((resolve) => { release = resolve; });

  env.advance(STARTUP_CHECK_DELAY_MS);
  assert.equal(registration.updateCalls, 1, "startup check");
  env.fire.document("visibilitychange");
  env.fire.window("focus");
  env.fire.window("online");
  const manual = manager.check({ manual: true });
  assert.equal(registration.updateCalls, 1);

  release();
  await manual;
  env.fire.window("focus");
  assert.equal(registration.updateCalls, 1, "a focus right after a check is throttled");
  manager.stop();
});

test("returning to the app, regaining focus, and the interval each check for updates", async () => {
  const { env, manager, registration } = setup();
  env.advance(STARTUP_CHECK_DELAY_MS);
  await flush();
  assert.equal(registration.updateCalls, 1);

  env.advance(UPDATE_CHECK_MIN_GAP_MS);
  env.document.visibilityState = "hidden";
  env.fire.document("visibilitychange");
  assert.equal(registration.updateCalls, 1, "hiding does not check");
  env.document.visibilityState = "visible";
  env.fire.document("visibilitychange");
  await flush();
  assert.equal(registration.updateCalls, 2);

  env.advance(UPDATE_CHECK_MIN_GAP_MS);
  env.fire.window("focus");
  await flush();
  assert.equal(registration.updateCalls, 3);

  env.advance(UPDATE_CHECK_INTERVAL_MS);
  await flush();
  assert.equal(registration.updateCalls, 4);

  env.document.visibilityState = "hidden";
  env.advance(UPDATE_CHECK_INTERVAL_MS);
  assert.equal(registration.updateCalls, 4, "a hidden app waits until it is visible");

  manager.stop();
  assert.equal(env.listenerCount.document("visibilitychange"), 0);
  assert.equal(env.listenerCount.window("focus"), 0);
});

test("a failed automatic check is silent; a failed manual check is reported", async () => {
  const { manager, registration } = setup();
  registration.updateImpl = async () => { throw new Error("502"); };
  await manager.check();
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.IDLE);
  await manager.check({ manual: true });
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.ERROR);
  manager.stop();
});

test("another window activating the update never reloads this one", async () => {
  const { env, manager, registration } = setup();
  registration.waiting = fakeWorker("installed");
  await manager.check();
  env.fire.controllerchange();
  assert.equal(env.reloads, 0);
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.RELOAD_REQUIRED);
  await manager.check({ manual: true });
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.RELOAD_REQUIRED, "checks do not hide the pending reload");
  await manager.applyUpdate();
  assert.equal(env.reloads, 1, "the reader's own tap reloads");
  manager.stop();
});

test("the first worker claiming a fresh page is not mistaken for an update", () => {
  const { env, manager } = setup({ controlled: false });
  env.fire.controllerchange();
  assert.equal(manager.getSnapshot().status, UPDATE_STATUS.IDLE);
  assert.equal(env.reloads, 0);
  manager.stop();
});

test("build identity combines package version, build date, and short commit", () => {
  const sha = "2b2975e0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6";
  assert.deepEqual(describeBuild({ semver: "0.1.0", release: sha, builtAt: "2026-10-01T09:30:00.000Z" }), {
    version: "0.1.0",
    release: sha,
    builtAt: "2026-10-01T09:30:00.000Z",
    build: "2026.10.01-2b2975e"
  });
  assert.equal(describeBuild({ release: "v2.4.18", builtAt: "2026-10-01T00:00:00Z" }).build, "2026.10.01-v2.4.18");
  assert.equal(describeBuild({}).build, "development");
});

test("version and build are injected at build time and shown in Settings", async () => {
  const [config, settings, section] = await Promise.all([
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Settings.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pwa/AppUpdateSettings.jsx", import.meta.url), "utf8")
  ]);
  assert.match(config, /__APP_SEMVER__: JSON\.stringify\(appSemver\)/);
  assert.match(config, /__APP_BUILD_TIME__: JSON\.stringify\(buildTime\)/);
  assert.match(config, /registerType: "prompt"/, "updates stay user-controlled");
  assert.match(settings, /\{ id: "updates"/);
  assert.match(settings, /<AppUpdateSettings \/>/);
  assert.match(section, /BUILD_INFO\.version/);
  assert.match(section, /BUILD_INFO\.build/);
  assert.match(section, /checkForUpdates/);
});

test("an update never clears offline study data", async () => {
  const [manager, worker, prompt, provider] = await Promise.all([
    readFile(new URL("../src/pwa/updateManager.js", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shared/PwaUpdatePrompt.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pwa/PwaLifecycleProvider.jsx", import.meta.url), "utf8")
  ]);
  for (const source of [manager, prompt, provider]) {
    assert.doesNotMatch(source, /caches\.|indexedDB|localStorage\.clear|sessionStorage\.clear|\.unregister\(/);
  }
  // The worker's activate step deletes only caches it owns: the legacy API
  // cache and older builds of its versioned optional-asset cache. Per-account
  // offline downloads (lock-in-private-offline-v1-<user>) are never matched.
  assert.doesNotMatch(worker, /lock-in-private-offline/);
  assert.match(worker, /cacheName\.startsWith\(runtimeCachePrefix\) && cacheName !== optionalAssetCache/);
  assert.equal("lock-in-private-offline-v1-42".startsWith("lock-in-optional-assets-"), false);
});

test("critical update files are revalidated while hashed assets stay immutable", async () => {
  for (const path of ["../nginx/default.conf", "../../deploy/container-host/nginx.conf.template"]) {
    const nginx = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(nginx, /location = \/service-worker\.js \{\s*expires epoch;/);
    assert.match(nginx, /location = \/manifest\.webmanifest \{[^}]*expires -1;/);
    assert.match(nginx, /location \/ \{\s*try_files \$uri \$uri\/ \/index\.html;\s*expires -1;/);
    assert.match(nginx, /location \/assets\/ \{[^}]*expires max;/);
  }
});
