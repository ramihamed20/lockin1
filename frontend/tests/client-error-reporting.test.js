import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";

import {
  __testing,
  buildClientErrorEnvelope,
  installClientErrorReporting
} from "../src/lib/clientErrorReporting.js";

test("client error envelopes contain operational metadata but no message or URL query", () => {
  const envelope = buildClientErrorEnvelope(
    "error",
    { name: "Type Error!", message: "private student content" },
    { pathname: "/materials/private-id", search: "?token=secret" }
  );

  assert.deepEqual(envelope, {
    event_type: "error",
    error_type: "Type_Error_",
    route: "/materials/private-id",
    release: "development"
  });
  assert.doesNotMatch(JSON.stringify(envelope), /private student content|token=secret/);
});

test("global handlers report errors and rejections without leaking their messages", async () => {
  __testing.reset();
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const calls = [];
  const handlers = new Map();
  globalThis.document = { cookie: "csrftoken=test-token" };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ status: "accepted" }), {
      status: 202,
      headers: { "Content-Type": "application/json" }
    });
  };
  const target = {
    location: { pathname: "/questions" },
    addEventListener(type, handler) {
      handlers.set(type, handler);
    }
  };

  try {
    installClientErrorReporting(target);
    handlers.get("error")({ error: new TypeError("private answer") });
    handlers.get("unhandledrejection")({ reason: new Error("private note") });
    await wait(0);
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/v1\/telemetry\/client-errors$/);
  const serialized = calls.map((call) => String(call.options.body)).join(" ");
  assert.doesNotMatch(serialized, /private answer|private note/);
  assert.match(serialized, /TypeError/);
  assert.match(serialized, /unhandledrejection/);
});
