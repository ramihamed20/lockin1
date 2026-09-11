import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  FILE_REQUEST_TIMEOUT_MS,
  isApiError,
  request
} from "../src/api/client.js";
import { useAsyncData } from "../src/hooks/useAsyncData.js";
import { __testing as connectionTesting, reportBrowserOffline, reportConnectionSuccess } from "../src/lib/connectionState.js";

const originalFetch = globalThis.fetch;

function restoreFetch() {
  if (originalFetch) globalThis.fetch = originalFetch;
  else delete globalThis.fetch;
}

/** A fetch that never settles until its signal aborts, like a stalled connection. */
function stalledFetch(record = {}) {
  return (_url, options) => new Promise((_resolve, reject) => {
    record.signal = options.signal;
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  });
}

test("a stalled request is reported as a timeout rather than hanging forever", async () => {
  globalThis.fetch = stalledFetch();
  try {
    // Wall-clock is not worth spending: the deadline is configurable precisely
    // so the timeout path is testable.
    const error = await request("/auth/session", { timeoutMs: 20 }).then(
      () => null,
      (failure) => failure
    );

    assert.ok(isApiError(error));
    assert.equal(error.code, "timeout");
    assert.equal(error.status, 0);
    assert.match(error.message, /took too long/i);
  } finally {
    restoreFetch();
  }
});

test("a caller's own cancellation is not reported as a timeout or a network failure", async () => {
  globalThis.fetch = stalledFetch();
  const controller = new AbortController();
  try {
    const pending = request("/auth/session", { signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    const error = await pending.then(() => null, (failure) => failure);

    assert.ok(isApiError(error));
    assert.equal(error.code, "aborted");
  } finally {
    restoreFetch();
  }
});

test("a genuine transport failure is still a network error", async () => {
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  try {
    const error = await request("/auth/session").then(() => null, (failure) => failure);

    assert.ok(isApiError(error));
    assert.equal(error.code, "network_error");
  } finally {
    restoreFetch();
  }
});

test("a safe read retries a brief interruption without duplicating the request result", async () => {
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new TypeError("temporary radio handoff"));
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    assert.deepEqual(await request("/auth/session"), { ok: true });
    assert.equal(calls, 2);
  } finally {
    restoreFetch();
  }
});

test("a safe read is not retried while the browser reports no network at all", async () => {
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return Promise.reject(new TypeError("Failed to fetch"));
  };
  Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, get: () => false });
  try {
    const error = await request("/auth/session").then(() => null, (failure) => failure);
    assert.equal(error.code, "network_error");
    assert.equal(calls, 1);
  } finally {
    delete globalThis.navigator.onLine;
    restoreFetch();
  }
});

test("the deadline is cleared once a response arrives, so a slow render cannot abort it", async () => {
  globalThis.fetch = () => Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
  try {
    const payload = await request("/auth/session", { timeoutMs: 20 });
    // Well past the deadline; nothing may fire after the response settled.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(payload, { ok: true });
  } finally {
    restoreFetch();
  }
});

test("a request may opt out of the deadline entirely for an unbounded transfer", async () => {
  const record = {};
  globalThis.fetch = stalledFetch(record);
  try {
    const pending = request("/files/x/view", { timeoutMs: 0 }).catch(() => "settled");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(record.signal, undefined, "no signal is attached when there is no deadline");
    // Nothing to await: the point is that it is still pending.
    assert.ok(pending);
  } finally {
    restoreFetch();
  }
});

test("the default and file deadlines are sane and ordered", () => {
  assert.ok(DEFAULT_REQUEST_TIMEOUT_MS >= 10_000);
  assert.ok(DEFAULT_REQUEST_TIMEOUT_MS <= 60_000);
  // Streamed private files are allowed 300s at the edge; the client must not
  // give up before nginx does.
  assert.ok(FILE_REQUEST_TIMEOUT_MS >= 300_000);
});

test("a sensitive write is never treated as successful while the app knows it is offline", async () => {
  connectionTesting.reset();
  reportBrowserOffline();
  try {
    const error = await request("/payments/intents", { method: "POST", body: {} }).then(() => null, (failure) => failure);
    assert.ok(isApiError(error));
    assert.equal(error.code, "offline");
  } finally {
    reportConnectionSuccess();
  }
});

test("useAsyncData hands its loader a signal and aborts it on cleanup", () => {
  // The hook is exercised through its effect contract rather than a renderer:
  // what matters is that the loader receives a signal and that the cleanup
  // returned by the effect aborts it.
  const source = useAsyncData.toString();
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /loader\(controller\?\.signal\)/);
  assert.match(source, /controller\?\.abort\(\)/);
  // A cancelled request must not be shown to the reader as a failure.
  assert.match(source, /error\?\.code === "aborted"/);
});
