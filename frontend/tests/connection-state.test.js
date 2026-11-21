import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { translate } from "../src/lib/i18n.js";

import {
  __testing,
  configureConnectionProbe,
  getConnectionSnapshot,
  isDefinitelyOffline,
  reportBrowserOffline,
  reportConnectionFailure,
  reportConnectionSuccess,
  retryConnectionNow,
  subscribeConnection
} from "../src/lib/connectionState.js";

test("a brief transport interruption is reconnecting, not offline", () => {
  __testing.reset();
  reportConnectionFailure();
  assert.equal(getConnectionSnapshot().status, "reconnecting");
  reportConnectionSuccess();
  assert.equal(getConnectionSnapshot().status, "connected");
});

test("connection recovery only updates state and never reloads the application", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const status = await readFile(new URL("../src/components/shared/ConnectionStatus.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /location\.reload|window\.location\s*=/);
  assert.match(status, /errors\.connection/);
  assert.equal(translate("en", "errors.connection.restored"), "Connection restored");
  assert.match(translate("ar", "errors.connection.offline"), /المنزّل/);
  assert.doesNotMatch(translate("en", "errors.connection.offline"), /changes will sync/);
});

test("prolonged browser-offline state is visible and recovery is published without a refresh", () => {
  __testing.reset();
  const seen = [];
  const unsubscribe = subscribeConnection((state) => seen.push(state.status));
  reportBrowserOffline();
  reportConnectionSuccess();
  unsubscribe();
  assert.deepEqual(seen, ["offline", "connected"]);
  assert.equal(getConnectionSnapshot().status, "connected");
});

test("a probe from the previous network cannot undo a successful response", async (t) => {
  __testing.reset();
  t.after(() => __testing.reset());
  let rejectProbe;
  let probeSignal;
  configureConnectionProbe((signal) => new Promise((_resolve, reject) => {
    rejectProbe = reject;
    probeSignal = signal;
  }));

  reportConnectionFailure();
  const pending = retryConnectionNow();
  reportConnectionSuccess();
  assert.equal(probeSignal.aborted, true);
  rejectProbe(new TypeError("previous network disconnected"));
  await pending;
  assert.equal(getConnectionSnapshot().status, "connected");
});

test("foreground recovery checks the network promptly and shares one probe", async (t) => {
  __testing.reset();
  t.after(() => __testing.reset());
  let finishProbe;
  let probes = 0;
  configureConnectionProbe(() => new Promise((resolve) => {
    probes += 1;
    finishProbe = resolve;
  }));

  reportBrowserOffline();
  const pending = retryConnectionNow();
  await retryConnectionNow();
  reportConnectionFailure();
  assert.equal(getConnectionSnapshot().status, "offline");
  assert.equal(probes, 1);
  finishProbe();
  await pending;
  assert.equal(getConnectionSnapshot().status, "connected");
});

test("the actual API probe requires a fresh Lock-in health response", async (t) => {
  __testing.reset();
  t.after(() => __testing.reset());
  await import("../src/api/client.js");
  const fetch = t.mock.method(globalThis, "fetch", async () => (
    new Response("<html>Network sign-in</html>", { headers: { "Content-Type": "text/html" } })
  ));

  reportBrowserOffline();
  await retryConnectionNow();
  assert.equal(getConnectionSnapshot().status, "offline");
  assert.equal(fetch.mock.calls[0].arguments[0], "/api/v1/health/live");
  assert.equal(fetch.mock.calls[0].arguments[1].cache, "no-store");

  fetch.mock.mockImplementation(async () => (
    Response.json({ status: "ok", service: "lockin-api" })
  ));
  await retryConnectionNow();
  assert.equal(getConnectionSnapshot().status, "connected");
});

test("a stale browser hint cannot keep a reachable PWA offline", async (t) => {
  __testing.reset();
  const online = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: false });
  t.after(() => {
    if (online) Object.defineProperty(globalThis.navigator, "onLine", online);
    else delete globalThis.navigator.onLine;
    __testing.reset();
  });
  configureConnectionProbe(async () => {});
  assert.equal(isDefinitelyOffline(), true);
  await retryConnectionNow();
  assert.equal(isDefinitelyOffline(), false);
  reportBrowserOffline();
  assert.equal(isDefinitelyOffline(), true);
});
