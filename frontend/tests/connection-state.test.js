import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  __testing,
  getConnectionSnapshot,
  reportBrowserOffline,
  reportConnectionFailure,
  reportConnectionSuccess,
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
  assert.match(status, /Connection restored/);
  assert.match(status, /You’re offline/);
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
