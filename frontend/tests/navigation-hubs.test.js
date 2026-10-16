import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { bottomNavPaths, hubForPath, hubMemberPaths, navHubs, navItems } = await import("../src/lib/constants.js");
const { translate } = await import("../src/lib/i18n.js");

test("the rail carries five primary destinations and the bottom bar four of them", () => {
  const primary = navItems.filter((item) => item.primary).map((item) => item.path);
  assert.deepEqual(primary, ["/", "/materials", "/questions", "/review", "/progress"]);
  assert.ok(bottomNavPaths.every((path) => primary.includes(path)));
  assert.equal(bottomNavPaths.length, 4);
});

test("every hub belongs to a primary destination and every hub entry names one", () => {
  const primary = new Set(navItems.filter((item) => item.primary).map((item) => item.path));
  for (const hub of navHubs) {
    assert.ok(primary.has(hub.path), `${hub.path} is not primary`);
    assert.equal(hub.sections[0].path, hub.path, "a hub opens on its own page");
  }
  for (const item of navItems.filter((entry) => entry.hub)) {
    assert.ok(hubMemberPaths(item.hub).includes(item.path), `${item.path} is missing from its hub`);
  }
});

test("scheduled features never sit in the rail", async () => {
  const { isFeatureComingSoon, getFeatureForPath } = await import("../src/lib/featureAvailability.js");
  for (const item of navItems.filter((entry) => entry.primary)) {
    assert.equal(isFeatureComingSoon(getFeatureForPath(item.path)), false, item.path);
  }
});

test("hub tabs appear only on their own section paths", () => {
  assert.equal(hubForPath("/bookmarks")?.path, "/review");
  assert.equal(hubForPath("/analysis")?.path, "/progress");
  assert.equal(hubForPath("/paper-workspace")?.path, "/materials");
  // Deeper pages keep their own back link instead of the strip.
  assert.equal(hubForPath("/materials/catalog/anatomy"), null);
  assert.equal(hubForPath("/review/bank"), null);
  assert.equal(hubForPath("/"), null);
});

test("every hub section is a real route with a label in both languages", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  for (const section of navHubs.flatMap((hub) => hub.sections)) {
    assert.match(app, new RegExp(`<Route path="${section.path}" `), section.path);
    for (const locale of ["en", "ar"]) assert.notEqual(translate(locale, section.labelKey), section.labelKey, `${locale} ${section.labelKey}`);
  }
  for (const locale of ["en", "ar"]) assert.notEqual(translate(locale, "hub.sections"), "hub.sections");
});

test("the shell renders hub tabs as links outside Creator Studio", async () => {
  const layout = await readFile(new URL("../src/components/layout/index.jsx", import.meta.url), "utf8");
  assert.match(layout, /\{!studio && <HubTabs pathname=\{location\.pathname\} \/>\}/);
  assert.match(layout, /aria-current=\{current \? "page" : undefined\}/);
  assert.match(layout, /navItems\.filter\(\(item\) => item\.primary\)/);
});
