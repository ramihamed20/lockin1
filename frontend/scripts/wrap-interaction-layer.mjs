/**
 * One-time codemod that moves the historical stylesheets into the `app`
 * cascade layer and makes their pointer states honest.
 *
 * Two transforms, both purely local to a selector token so no selector
 * structure or specificity changes:
 *
 *   `:hover`  -> `:hover:where(html.ix-hover *)`
 *       Hover visuals now require a hover-capable pointer that has not just
 *       been used as a touchscreen. This is the fix for a tapped control
 *       staying lit until the user taps somewhere else.
 *
 *   `:active` -> `:active:where([data-ix-pressed])`
 *       Press visuals now require the interaction runtime to agree that a
 *       press is in progress, so a cancelled gesture, a scroll or a lifted
 *       finger clears them immediately instead of leaving them stuck.
 *
 * `:where()` contributes zero specificity, so every existing rule keeps
 * exactly the weight it had.
 *
 * Run with: node scripts/wrap-interaction-layer.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const FILES = [
  "src/styles.css",
  "src/responsive.css",
  "src/launch-readiness.css",
  "src/components/auth/auth.css",
  "src/pages/catalog-focus-workspace.css",
  "src/pages/creator-studio.css",
  "src/pages/lock-in-reference.css",
  "src/pages/study-plan.css"
];

const HOVER_GUARD = ":hover:where(html.ix-hover *)";
const ACTIVE_GUARD = ":active:where([data-ix-pressed])";
const LAYER_OPEN = "@layer app {\n";
const LAYER_CLOSE = "\n}\n";

/**
 * Replaces occurrences outside comments and quoted strings.
 * @param {string} source
 * @param {(chunk: string) => string} transform
 */
function outsideCommentsAndStrings(source, transform) {
  let out = "";
  let index = 0;
  let plain = "";
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += transform(plain) + source.slice(index, stop);
      plain = "";
      index = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      let stop = index + 1;
      while (stop < source.length && source[stop] !== char) stop += source[stop] === "\\" ? 2 : 1;
      stop = Math.min(stop + 1, source.length);
      out += transform(plain) + source.slice(index, stop);
      plain = "";
      index = stop;
      continue;
    }
    plain += char;
    index += 1;
  }
  return out + transform(plain);
}

/** @param {string} source */
function guardPointerStates(source) {
  return outsideCommentsAndStrings(source, (chunk) => chunk
    // `(hover: hover)` media features are written with a space and are not touched.
    .replace(/:hover(?!:where\()/g, HOVER_GUARD)
    .replace(/:active(?!:where\()/g, ACTIVE_GUARD));
}

/**
 * `@tailwind`, `@charset` and `@import` must stay at the top level of the
 * file, so they are hoisted out of the layer block.
 * @param {string} source
 */
function splitPreamble(source) {
  const lines = source.split("\n");
  const preamble = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (line === "" || line.startsWith("/*") || line.startsWith("*") || line.startsWith("@tailwind") || line.startsWith("@charset") || line.startsWith("@import")) {
      preamble.push(lines[cursor]);
      cursor += 1;
      continue;
    }
    break;
  }
  return { preamble: preamble.join("\n"), body: lines.slice(cursor).join("\n") };
}

let changed = 0;
for (const relative of FILES) {
  const file = path.join(root, relative);
  const original = await readFile(file, "utf8");
  if (original.includes(LAYER_OPEN)) {
    process.stdout.write(`skip (already layered): ${relative}\n`);
    continue;
  }
  const guarded = guardPointerStates(original);
  const { preamble, body } = splitPreamble(guarded);
  const next = `${preamble ? `${preamble}\n` : ""}${LAYER_OPEN}${body}${LAYER_CLOSE}`;
  await writeFile(file, next, "utf8");
  changed += 1;
  process.stdout.write(`layered: ${relative}\n`);
}
process.stdout.write(`done (${changed} file${changed === 1 ? "" : "s"})\n`);
