import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_AUTOMATIC_BOOT_RETRIES,
  bootFailureMessage,
  bootRetryDelayMs,
  isTransientBootFailure,
  shouldRetryBootAutomatically
} from "../src/lib/sessionBootstrap.js";

const failure = (status, message = "") => ({ status, message });

test("only transport and server-side faults are retried automatically", () => {
  for (const status of [0, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientBootFailure(failure(status)), true, `status ${status} is transient`);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isTransientBootFailure(failure(status)), false, `status ${status} is a real answer`);
  }
  assert.equal(isTransientBootFailure(null), false);
  assert.equal(isTransientBootFailure(new Error("boom")), false);
});

test("automatic retries are bounded and stop while the device is offline", () => {
  const transient = failure(503);
  for (let attempts = 0; attempts < MAX_AUTOMATIC_BOOT_RETRIES; attempts += 1) {
    assert.equal(shouldRetryBootAutomatically(transient, { attempts }), true);
  }
  // The budget is a hard stop, so a permanently broken server cannot spin.
  assert.equal(shouldRetryBootAutomatically(transient, { attempts: MAX_AUTOMATIC_BOOT_RETRIES }), false);
  assert.equal(shouldRetryBootAutomatically(transient, { attempts: 99 }), false);
  // Retrying while offline would only burn the budget before it can help.
  assert.equal(shouldRetryBootAutomatically(transient, { attempts: 0, online: false }), false);
  assert.equal(shouldRetryBootAutomatically(failure(403), { attempts: 0 }), false);
});

test("backoff grows, stays bounded, and never returns a zero delay", () => {
  const delays = [1, 2, 3].map(bootRetryDelayMs);
  assert.deepEqual(delays, [600, 1500, 3200]);
  assert.ok(delays.every((delay) => delay > 0));
  for (let index = 1; index < delays.length; index += 1) assert.ok(delays[index] > delays[index - 1]);
  // Out-of-range attempts clamp instead of producing NaN or an unbounded wait.
  assert.equal(bootRetryDelayMs(0), 600);
  assert.equal(bootRetryDelayMs(-4), 600);
  assert.equal(bootRetryDelayMs(50), 3200);
  assert.equal(bootRetryDelayMs(Number.NaN), 600);
});

test("the reader is told what happened without any transport or security detail", () => {
  const offline = bootFailureMessage(failure(0), { online: false });
  assert.match(offline, /offline/i);
  assert.match(offline, /this device/i);

  assert.match(bootFailureMessage(failure(503), { retrying: true }), /Reconnecting/i);
  assert.match(bootFailureMessage(failure(0)), /could not reach the server/i);
  assert.match(bootFailureMessage(failure(500)), /trouble right now/i);

  // A server-authored message for an ordinary request failure is still shown.
  assert.equal(bootFailureMessage(failure(400, "Your account is not ready yet.")), "Your account is not ready yet.");

  // Technical and markup payloads are replaced rather than rendered.
  assert.match(bootFailureMessage(failure(400, "<html><body>Proxy Error</body></html>")), /could not open your session/i);
  assert.match(bootFailureMessage(failure(400, "TypeError: Failed to fetch at http://x/api")), /could not open your session/i);
  assert.match(bootFailureMessage(null), /could not open your session/i);
});

test("a 5xx message from the server never reaches the reader verbatim", () => {
  // 5xx bodies routinely carry stack traces, hostnames, and framework detail.
  const leaky = failure(500, "django.db.utils.OperationalError at /api/v1/auth/session on db-prod-3");
  assert.equal(bootFailureMessage(leaky), "The server is having trouble right now. Please try again in a moment.");
  assert.doesNotMatch(bootFailureMessage(leaky), /db-prod-3|django/i);
});
