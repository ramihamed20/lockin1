import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { directionForLocale, formatNumber, normalizeLocale, translate } from "../src/lib/i18n.js";
import { normalizeUserError } from "../src/lib/errors.js";
import { routeMetadata } from "../src/lib/routeMetadata.js";

test("shared localization owns English and Arabic direction, messages, and number formatting", () => {
  assert.equal(normalizeLocale("ar-LY"), "ar");
  assert.equal(directionForLocale("ar"), "rtl");
  assert.equal(directionForLocale("en"), "ltr");
  assert.equal(translate("ar", "nav.materials"), "المواد");
  assert.equal(translate("en", "nav.materials"), "Materials");
  assert.notEqual(formatNumber(1234, {}, "ar"), formatNumber(1234, {}, "en"));
});

test("route metadata is authoritative for shell, document, and accessible page identity", () => {
  const settings = routeMetadata("/settings", (key) => translate("en", key));
  const lockIn = routeMetadata("/lock-in/session-id", (key) => translate("ar", key));
  assert.deepEqual(
    [settings.shellLabel, settings.h1, settings.documentTitle],
    ["Settings", "Settings", "Settings — Lock-in"]
  );
  assert.equal(lockIn.h1, "وضع التركيز");
  assert.equal(lockIn.documentTitle, "وضع التركيز — Lock-in");
});

test("raw server HTML and technical traces never reach user-facing error copy", () => {
  assert.equal(
    normalizeUserError("<!DOCTYPE html><html><body>404</body></html>", "Safe fallback"),
    "Safe fallback"
  );
  assert.equal(normalizeUserError("Traceback: server internals", "Safe fallback"), "Safe fallback");
  assert.equal(normalizeUserError("The material is unavailable.", "Safe fallback"), "The material is unavailable.");
});

test("remediation architecture reserves catalog and protects stale lazy routes", async () => {
  const [app, lazyRecovery, worker, vite] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/lazyWithRecovery.js", import.meta.url), "utf8"),
    readFile(new URL("../src/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.js", import.meta.url), "utf8")
  ]);
  assert.match(app, /path="\/materials\/catalog" element={<NotFoundPage/);
  assert.match(app, /lazyWithRecovery/);
  assert.match(lazyRecovery, /sessionStorage/);
  assert.match(lazyRecovery, /window\.location\.reload/);
  assert.match(worker, /__APP_VERSION__/);
  assert.doesNotMatch(worker, /cache\.put\([^\n]*api/i);
  assert.match(vite, /orientation:\s*"any"/);
});
