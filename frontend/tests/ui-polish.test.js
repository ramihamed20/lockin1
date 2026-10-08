import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const ENTRANCE_KEYFRAMES = [
  "settings-v2-push",
  "refine-section-in",
  "refine-popover-in",
  "refine-feedback-in",
  "toast-rise",
  "study-reveal",
  "study-in-forward",
  "study-in-back",
  "ui-dialog-in",
  "motion-sheet-in"
];

test("entrance animations never keep a transform once they finish", async () => {
  // A `both` fill leaves the end frame applied, and an element with an applied
  // transform animation is the containing block for position:fixed: a dialog
  // inside it is placed against the scrolled panel instead of the screen.
  const files = await Promise.all([
    "../src/styles/v2.css",
    "../src/styles/refine.css",
    "../src/styles/study-flow.css",
    "../src/styles/system.css",
    "../src/styles/motion-system.css"
  ].map(source));
  const css = files.join("\n");
  for (const name of ENTRANCE_KEYFRAMES) {
    const uses = css.match(new RegExp(`animation:\\s*${name}\\b[^;]*;`, "g")) || [];
    assert.ok(uses.length, `${name} is still used`);
    for (const use of uses) assert.doesNotMatch(use, /\bboth\b|\bforwards\b/, use);
  }
});

test("reduced motion has a global net that spares progress indicators", async () => {
  const css = await source("../src/styles/motion-system.css");
  const block = css.slice(css.indexOf("Reduced motion: one net"));
  assert.match(block, /transition-duration: 0\.01ms !important/);
  assert.match(block, /animation-iteration-count: 1 !important/);
  for (const spinner of [".startup-progress", ".auth-v2-spinner", ".offline-v2-spinner", '.btn[aria-busy="true"]']) {
    assert.ok(block.includes(spinner), `${spinner} keeps moving`);
  }
});

test("reload keeps the record on screen instead of returning to a skeleton", async () => {
  const hook = await source("../src/hooks/useAsyncData.js");
  assert.match(hook, /const reloadOnly = sameRecord && previous\.reloadVersion !== reloadVersion;/);
  assert.match(hook, /reloadOnly \|\| \(keepPreviousData/);
});

test("compact buttons and section links keep a 44px target on touch", async () => {
  const css = await source("../src/styles/polish.css");
  const coarse = css.slice(css.indexOf("Mobile Safari zooms the viewport"));
  assert.match(coarse, /\.btn,\s*\.btn\.compact \{ min-height: var\(--touch-target\); \}/);
  assert.match(coarse, /\.ui-section-link \{ display: inline-flex; align-items: center; min-block-size: var\(--touch-target\); \}/);
});

test("a select inside a framed control does not draw a second frame", async () => {
  const css = await source("../src/styles/system.css");
  assert.match(css, /:root :is\(\.progress-range-control, \.auth-v2-language\) select \{[^}]*border: 0;[^}]*background-color: transparent;/);
});

test("route chunks fall back to a deferred, route-shaped skeleton", async () => {
  const [app, ui] = await Promise.all([source("../src/App.jsx"), source("../src/components/ui/index.jsx")]);
  assert.match(app, /<Suspense fallback=\{<DeferredLoadingPanel \/>\}>/);
  assert.match(ui, /export function DeferredLoadingPanel\(\{ delay = 300 \}\)/);
});

test("the search placeholder leaves the keyboard hint to its key cap", async () => {
  const i18n = await source("../src/lib/i18n.js");
  assert.match(i18n, /"shell\.searchPlaceholder": "Search Lock-in",/);
  assert.doesNotMatch(i18n, /press \/\)/);
});

test("touch bars are solid where their blur is switched off", async () => {
  const css = await source("../src/styles/v2.css");
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\) \{\s*\.bottom-nav \{\s*background: var\(--surface\);\s*\}\s*\.topbar \{\s*background: var\(--bg\);/);
});
