import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WHATS_NEW, fetchPendingRelease, normalizeRelease, readSeenRelease, whatsNewDecision, whatsNewText, writeSeenRelease } from "../src/lib/whatsNew.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

test("every release note has an icon and both languages", () => {
  assert.ok(WHATS_NEW.items.length > 0);
  for (const item of WHATS_NEW.items) {
    assert.ok(item.icon);
    for (const field of [item.title, item.body]) {
      assert.ok(field.en.trim() && field.ar.trim(), item.title.en);
    }
  }
  assert.equal(whatsNewText(WHATS_NEW.items[0].title, "ar"), WHATS_NEW.items[0].title.ar);
  assert.equal(whatsNewText(WHATS_NEW.items[0].title, "fr"), WHATS_NEW.items[0].title.en);
});

test("an existing account sees the panel once, a new account never does", () => {
  const release = { id: "r1", date: "2026-10-08" };
  assert.equal(whatsNewDecision({ seenId: "", dateJoined: "2026-09-01T10:00:00Z", release }), "show");
  assert.equal(whatsNewDecision({ seenId: "older", dateJoined: "", release }), "show");
  assert.equal(whatsNewDecision({ seenId: "r1", dateJoined: "2026-09-01T10:00:00Z", release }), "none");
  assert.equal(whatsNewDecision({ seenId: "", dateJoined: "2026-10-08T09:00:00Z", release }), "skip");
  assert.equal(whatsNewDecision({ seenId: "", dateJoined: "2026-11-01T09:00:00Z", release }), "skip");
});

test("the seen version is remembered per account", () => {
  const storage = memoryStorage();
  writeSeenRelease("a", "r1", storage);
  assert.equal(readSeenRelease("a", storage), "r1");
  assert.equal(readSeenRelease("b", storage), "");
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readSeenRelease("a", broken), "");
  assert.doesNotThrow(() => writeSeenRelease("a", "r1", broken));
});

test("the panel is mounted in the app and reachable from Settings", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const settings = await readFile(new URL("../src/pwa/AppUpdateSettings.jsx", import.meta.url), "utf8");
  assert.match(app, /<WhatsNew user=\{user\} suppressed=\{inFocusWorkspace\}/);
  assert.match(settings, /OPEN_WHATS_NEW_EVENT/);
});

test("the dialog links to the official Telegram channel safely", async () => {
  const source = await readFile(new URL("../src/components/WhatsNew.jsx", import.meta.url), "utf8");
  assert.match(source, /https:\/\/t\.me\/lock_in_official/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /whatsNew\.follow/);
});

test("the release notes carry the package version", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(WHATS_NEW.version, pkg.version);
  assert.equal(WHATS_NEW.id, WHATS_NEW.version);
  assert.ok(WHATS_NEW.summary.en && WHATS_NEW.summary.ar);
});

test("notes fetched from the server are validated and trimmed", () => {
  assert.equal(normalizeRelease(null), null);
  assert.equal(normalizeRelease({ id: "x", version: "1", summary: { en: "s" }, items: [] }), null);
  const release = normalizeRelease({
    id: "9.9.9", version: "9.9.9", summary: { en: "Faster" },
    items: [{ icon: 5, title: { en: "A" }, body: { en: "B", ar: "ب" } }, { title: { en: "" }, body: { en: "x" } }]
  });
  assert.equal(release.items.length, 1);
  assert.equal(release.items[0].icon, "sparkles");
  assert.equal(release.items[0].title.ar, "A");
  assert.equal(release.summary.ar, "Faster");
});

test("a pending release is only reported when it differs from the running one", async () => {
  const reply = (body, ok = true) => async () => ({ ok, json: async () => body });
  const newer = { id: "9.9.9", version: "9.9.9", summary: { en: "s" }, items: [{ title: { en: "t" }, body: { en: "b" } }] };
  assert.equal((await fetchPendingRelease("/release-notes.json", reply(newer))).version, "9.9.9");
  assert.equal(await fetchPendingRelease("/release-notes.json", reply(WHATS_NEW)), null);
  assert.equal(await fetchPendingRelease("/release-notes.json", reply(newer, false)), null);
  assert.equal(await fetchPendingRelease("/release-notes.json", async () => { throw new Error("offline"); }), null);
  assert.equal(await fetchPendingRelease("/release-notes.json", async () => ({ ok: true, json: async () => { throw new Error("html"); } })), null);
});

test("both update paths explain the release and the notes follow the update", async () => {
  const settings = await readFile(new URL("../src/pwa/AppUpdateSettings.jsx", import.meta.url), "utf8");
  const prompt = await readFile(new URL("../src/components/shared/PwaUpdatePrompt.jsx", import.meta.url), "utf8");
  assert.match(settings, /mode="before"/);
  assert.match(settings, /if \(announced\) setExplaining\(true\); else void applyUpdate\(\)/);
  assert.match(prompt, /usePendingRelease/);
  assert.match(prompt, /pwa\.update\.titleVersion/);
});

test("an item with an audience is shown only to that audience", async () => {
  const { releaseItemsFor } = await import("../src/lib/whatsNew.js");
  const release = { items: [{ title: { en: "all" } }, { audience: "dentistry", title: { en: "dent" } }] };
  const dentist = { cohort: { program: { code: "dentistry-tripoli" } } };
  const other = { cohort: { program: { code: "human-medicine" } } };
  assert.deepEqual(releaseItemsFor(release, dentist).map((item) => item.title.en), ["all", "dent"]);
  assert.deepEqual(releaseItemsFor(release, other).map((item) => item.title.en), ["all"]);
  assert.deepEqual(releaseItemsFor(release, null).map((item) => item.title.en), ["all"]);
});
