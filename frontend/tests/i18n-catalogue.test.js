import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

/**
 * The catalogue is the one place a missing key does not fail loudly: translate()
 * falls back to English, and then to the key itself, so a gap ships as English
 * text or as "materials.soon" in the middle of an Arabic page.
 *
 * These checks read the two locale blocks out of the module source, which keeps
 * the module's own surface unchanged.
 */

const CATALOGUE = new URL("../src/lib/i18n.js", import.meta.url);

/** Every "key": "value" pair inside one locale block, in source order. */
function localeEntries(source, locale) {
  const start = source.indexOf(`  ${locale}: {`);
  assert.notEqual(start, -1, `${locale} block not found`);
  let depth = 0;
  let end = start;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const block = source.slice(start, end);
  const entries = new Map();
  for (const match of block.matchAll(/^\s{4}"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/gm)) {
    entries.set(match[1], match[2]);
  }
  return entries;
}

/** The {placeholders} a template interpolates. */
function placeholders(value) {
  return new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));
}

/** "review.needReview.few" -> "review.needReview" when the tail is a category. */
const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

function pluralFamily(key) {
  const lastDot = key.lastIndexOf(".");
  if (lastDot === -1) return null;
  const tail = key.slice(lastDot + 1);
  return PLURAL_CATEGORIES.has(tail) ? key.slice(0, lastDot) : null;
}

test("every English message has an Arabic translation", async () => {
  const source = await readFile(CATALOGUE, "utf8");
  const en = localeEntries(source, "en");
  const ar = localeEntries(source, "ar");

  const arabicFamilies = new Set([...ar.keys()].map(pluralFamily).filter(Boolean));
  const missing = [];
  for (const key of en.keys()) {
    if (ar.has(key)) continue;
    // A counted phrase may be spelled out differently: English needs one and
    // other, Arabic needs up to six, so the family is what has to exist.
    const family = pluralFamily(key);
    if (family && arabicFamilies.has(family)) continue;
    missing.push(key);
  }

  assert.deepEqual(missing, [], `untranslated keys:\n${missing.join("\n")}`);
});

test("a counted phrase carries the categories its language needs", async () => {
  const source = await readFile(CATALOGUE, "utf8");
  const en = localeEntries(source, "en");
  const ar = localeEntries(source, "ar");

  const families = new Set([...en.keys()].map(pluralFamily).filter(Boolean));
  for (const family of families) {
    // English selects between one and other; anything else falls through to
    // other, so both have to be present.
    for (const category of ["one", "other"]) {
      assert.ok(en.has(`${family}.${category}`), `${family} is missing English "${category}"`);
    }
    // Arabic uses all six. "other" is the fallback the lookup lands on, so it
    // is the one that must never be absent.
    assert.ok(ar.has(`${family}.other`), `${family} is missing Arabic "other"`);
    for (const category of ["zero", "one", "two", "few", "many"]) {
      assert.ok(ar.has(`${family}.${category}`), `${family} is missing Arabic "${category}"`);
    }
  }
});

test("a translation interpolates exactly the values its English original does", async () => {
  const source = await readFile(CATALOGUE, "utf8");
  const en = localeEntries(source, "en");
  const ar = localeEntries(source, "ar");

  const mismatched = [];
  for (const [key, arabic] of ar) {
    // Compare against the English entry, or against the family's "other" when
    // Arabic splits a count into categories English does not have.
    const family = pluralFamily(key);
    const english = en.get(key) ?? (family ? en.get(`${family}.other`) : undefined);
    if (english === undefined) continue;
    const expected = placeholders(english);
    const actual = placeholders(arabic);
    // A category that spells the number out - "one question" - legitimately
    // drops {count}; inventing a placeholder is what breaks.
    for (const name of actual) {
      if (!expected.has(name)) mismatched.push(`${key}: unknown {${name}}`);
    }
    if (!family && expected.size !== actual.size) {
      mismatched.push(`${key}: expected {${[...expected].join("}, {")}}`);
    }
  }

  assert.deepEqual(mismatched, [], `placeholder mismatches:\n${mismatched.join("\n")}`);
});
