import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/lib/lockinIcons.jsx", import.meta.url), "utf8");
const registry = source.split("const LOCKIN_ICONS = {")[1].split("\n};")[0];

/** Split the registry into one entry per icon, name plus its JSX body. */
function icons() {
  return [...registry.matchAll(/\n {2}"?([a-z-]+)"?:\s*\(\s*<>([\s\S]*?)<\/>\s*\),?/g)]
    .map(([, name, body]) => ({ name, body }));
}

test("the registry parses and holds the icons the product uses", () => {
  const names = icons().map((icon) => icon.name);

  assert.ok(names.length >= 8, `expected the full set, parsed ${names.length}`);
  for (const required of ["focus", "study", "progress", "achievement", "rank", "community", "locked", "coming-soon"]) {
    assert.ok(names.includes(required), `${required} is missing from the set`);
  }
  // A streak icon was tried twice and removed: it read as a droplet, and
  // Lucide's flame is better. The reason is recorded in the file itself.
  assert.ok(!names.includes("streak"));
  assert.match(source, /WHAT IS DELIBERATELY NOT HERE/);
});

// The single filled mark is what makes the family read as Lock-in's rather
// than as more Lucide. One per icon: none and it dissolves into the library,
// two and the icon has no centre.
test("every icon carries exactly one core, and nothing else is filled", () => {
  for (const { name, body } of icons()) {
    const cores = body.match(/<Core /g) || [];
    assert.equal(cores.length, 1, `${name} must have exactly one core`);
    // Fill belongs to Core alone, so a stray fill cannot creep into a path.
    assert.doesNotMatch(body, /<(path|rect|circle)[^>]*fill=/, `${name} fills outside its core`);
  }
  assert.match(source, /function Core\(\{ cx, cy, r \}\)/);
  assert.match(source, /<circle cx=\{cx\} cy=\{cy\} r=\{r\} fill="currentColor" stroke="none" \/>/);
});

test("icons stay inside the grid the system defines", () => {
  for (const { name, body } of icons()) {
    // Every absolute coordinate lives in the 24-unit box with room to spare.
    for (const [, value] of body.matchAll(/(?:cx|cy|x|y)="?\{?(-?[\d.]+)\}?"?/g)) {
      const coordinate = Number(value);
      assert.ok(coordinate >= 0 && coordinate <= 24, `${name} has ${coordinate} outside the grid`);
    }
  }
});

test("the component matches the Icon component's drawing defaults", () => {
  // A concept icon beside a Lucide control must not look like another set.
  assert.match(source, /strokeWidth = 1\.9/);
  assert.match(source, /viewBox="0 0 24 24"/);
  assert.match(source, /strokeLinecap="round"/);
  assert.match(source, /strokeLinejoin="round"/);
  assert.match(source, /stroke="currentColor"/);
  // Colour is never hard-coded, so one glyph serves gold, muted and disabled.
  assert.doesNotMatch(registry, /#[0-9a-fA-F]{3,8}|rgb\(|var\(--/);
});

test("icons are decorative unless they are given a name", () => {
  // Text sits beside these almost everywhere, so silence is the default and a
  // caller opts into the accessibility tree by passing a title.
  assert.match(source, /aria-hidden=\{labelled \? undefined : "true"\}/);
  assert.match(source, /role=\{labelled \? "img" : undefined\}/);
  assert.match(source, /aria-label=\{labelled \? title : undefined\}/);
  assert.match(source, /focusable="false"/);
});

test("EmptyState keeps its old behaviour and only adds an opt-in concept icon", () => {
  const ui = readFileSync(new URL("../src/components/ui/index.jsx", import.meta.url), "utf8");
  const emptyState = ui.split("export function EmptyState")[1].split("\n}")[0];

  // Callers that pass nothing render exactly what they rendered before.
  assert.match(emptyState, /icon = ""/);
  assert.match(emptyState, /icon \? <LockinIcon name=\{icon\} size=\{30\} \/> : <Icon name="sparkles" \/>/);
  // 30px: the system reserves concept icons for 20 and up, and an empty state
  // is the one place with room for the larger end of that.
});

test("every concept icon a page asks for actually exists", () => {
  // LockinIcon renders nothing for an unknown name, so a typo would silently
  // leave a hole in an empty state rather than fail loudly.
  const names = new Set(icons().map((icon) => icon.name));
  const pages = ["Achievements", "Bookmarks", "Community", "CommunitySpace", "Materials"];
  let used = 0;
  for (const page of pages) {
    const text = readFileSync(new URL(`../src/pages/${page}.jsx`, import.meta.url), "utf8");
    for (const [, requested] of text.matchAll(/<EmptyState icon="([a-z-]+)"/g)) {
      assert.ok(names.has(requested), `${page} asks for a missing icon: ${requested}`);
      used += 1;
    }
  }
  assert.ok(used >= 5, `expected the concept icons to be in use, found ${used}`);
});

test("Lucide is still the vocabulary for functional controls", () => {
  const iconLib = readFileSync(new URL("../src/lib/icons.jsx", import.meta.url), "utf8");

  // The custom set is an addition, not a replacement: the controls that make
  // the interface usable still come from Lucide.
  for (const control of ["search:", "menu:", "bell:", "check:", "trash:", "pencil:"]) {
    assert.ok(iconLib.includes(control), `Lucide mapping for ${control} disappeared`);
  }
  assert.match(iconLib, /from "lucide-react"/);
  // Flame stays mapped: it is what a streak uses.
  assert.match(iconLib, /flame: Flame/);
});
