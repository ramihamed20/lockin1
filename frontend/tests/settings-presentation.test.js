import assert from "node:assert/strict";
import test from "node:test";
import { sessionDeviceType } from "../src/lib/devicePresentation.js";
import { paymentDisplayStatus, formatPaymentAmount } from "../src/lib/paymentPresentation.js";
import { SETTINGS_SECTIONS, resolveSettingsSection, searchSettingsSections } from "../src/lib/settingsNavigation.js";
import { settingsMessages } from "../src/lib/settingsMessages.js";
import { billingApi } from "../src/api/billing.js";

test("device silhouettes distinguish phones, tablets and computers without inventing a device", () => {
  for (const [label, expected] of [["Safari on iPhone", "phone"], ["Chrome on Mobile device", "phone"], ["Safari on iPad", "tablet"], ["Chrome on Android tablet", "tablet"], ["Safari on Tablet", "tablet"], ["Chrome on Windows computer", "computer"], ["Safari on Mac", "computer"], ["Another browser", "unknown"]]) {
    assert.equal(sessionDeviceType({ device_label: label }), expected, label);
  }
});

test("desktop-mode iPad recognition is limited to the current session", () => {
  const navigator = { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 };
  assert.equal(sessionDeviceType({ is_current: true, device_label: "Safari on Computer" }, navigator), "tablet");
  assert.equal(sessionDeviceType({ is_current: false, device_label: "Chrome on Computer" }, navigator), "computer");
  assert.equal(sessionDeviceType({ is_current: true, device_label: "Safari on Mac" }, { ...navigator, maxTouchPoints: 0 }), "computer");
});

test("legacy links retain their destination and deletion links always open privacy", () => {
  assert.deepEqual(resolveSettingsSection("account", "", "password"), { section: "security", anchor: "settings-password" });
  assert.deepEqual(resolveSettingsSection("themes"), { section: "appearance", anchor: "settings-themes" });
  assert.deepEqual(resolveSettingsSection("account", "single-use-link"), { section: "privacy", anchor: "settings-deletion" });
  assert.equal(resolveSettingsSection("reminder").section, "notifications");
  assert.equal(resolveSettingsSection("invalid").section, "");
});

test("search accepts Arabic hamza variants, inner preferences and the other language", () => {
  const translate = key => settingsMessages.ar[key] || key;
  for (const [query, expected] of [["اشعارات", "notifications"], ["كلمة مرور", "security"], ["حذف حساب", "privacy"], ["payment history", "billing"], ["لغة", "appearance"], ["ايباد", "devices"]]) {
    assert.deepEqual(searchSettingsSections(SETTINGS_SECTIONS, query, translate).map(item => item.id), [expected], query);
  }
  assert.equal(searchSettingsSections(SETTINGS_SECTIONS, "doesnotexist", translate).length, 0);
});

test("final payment states take precedence over old manual review states", () => {
  assert.equal(paymentDisplayStatus({ status: "refunded", manual_submission: { status: "approved" } }), "refunded");
  assert.equal(paymentDisplayStatus({ status: "partially_refunded", manual_submission: { status: "approved" } }), "partially_refunded");
  assert.equal(paymentDisplayStatus({ status: "pending", manual_submission: { status: "rejected" } }), "rejected");
  assert.equal(paymentDisplayStatus({ status: "succeeded" }), "succeeded");
  assert.equal(paymentDisplayStatus({ status: "new-server-state" }), "unknown");
});

test("amounts respect the server's currency exponent and reject incomplete money data", () => {
  assert.match(formatPaymentAmount(12500, "LYD", 3, "en"), /12\.5/);
  assert.match(formatPaymentAmount(1250, "USD", 2, "en"), /12\.5/);
  assert.equal(formatPaymentAmount(null, "LYD", 3, "en"), "—");
  assert.equal(formatPaymentAmount(12, "LYD", undefined, "en"), "—");
});

test("payment history requests one server page and does not follow returned URLs", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    return new Response(JSON.stringify({ count: 11, results: [{ id: "mine" }], next: "https://untrusted.invalid/payments", previous: null }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const page = await billingApi.paymentHistory(1);
    assert.deepEqual(page, { count: 11, results: [{ id: "mine" }], hasNext: true, hasPrevious: false });
    assert.deepEqual(requests, ["/api/v1/payments?page=1&page_size=10"]);
  } finally { globalThis.fetch = original; }
});
