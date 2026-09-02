import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveViewportState } from "../src/lib/viewport.js";

const IPHONE_EVIDENCE = {
  layoutClientHeight: 768,
  transientVisualHeight: 778,
  stableVisualHeight: 812,
  safeBottom: 34
};

function sample(visualViewportHeight, focusedTextField = false, visualViewportOffsetTop = 0) {
  return {
    // The CSS large-viewport ruler is already stable while Safari's dynamic
    // and visual viewport answers move through the measured sequence.
    stableViewportHeight: IPHONE_EVIDENCE.stableVisualHeight,
    visualViewportHeight,
    visualViewportOffsetTop,
    visualViewportScale: 1,
    focusedTextField
  };
}

test("the physical iPhone 778px intermediate viewport never becomes shell authority", () => {
  assert.equal(
    IPHONE_EVIDENCE.stableVisualHeight - IPHONE_EVIDENCE.transientVisualHeight,
    IPHONE_EVIDENCE.safeBottom
  );
  assert.equal(IPHONE_EVIDENCE.layoutClientHeight, 768);

  const initial = resolveViewportState(undefined, sample(IPHONE_EVIDENCE.transientVisualHeight));
  assert.deepEqual(initial, {
    keyboardOpen: false,
    keyboardInset: 0,
    applicationHeight: IPHONE_EVIDENCE.stableVisualHeight
  });

  const rubberBand = resolveViewportState(initial, sample(IPHONE_EVIDENCE.transientVisualHeight, false, -10));
  assert.equal(rubberBand.applicationHeight, IPHONE_EVIDENCE.stableVisualHeight);
  assert.equal(rubberBand.keyboardOpen, false);

  const settled = resolveViewportState(rubberBand, sample(IPHONE_EVIDENCE.stableVisualHeight));
  assert.equal(settled.applicationHeight, IPHONE_EVIDENCE.stableVisualHeight);
});

test("repeated keyboard open and delayed close cannot strand the shell at 778px", () => {
  let state = resolveViewportState(undefined, sample(IPHONE_EVIDENCE.transientVisualHeight));

  for (let pass = 0; pass < 5; pass += 1) {
    state = resolveViewportState(state, sample(466, true));
    assert.equal(state.keyboardOpen, true);
    assert.equal(state.keyboardInset, 346);
    assert.equal(state.applicationHeight, IPHONE_EVIDENCE.stableVisualHeight);

    // Safari has removed the keyboard but is still reporting the intermediate
    // dynamic viewport. The closing edge retains the stable application frame.
    state = resolveViewportState(state, sample(IPHONE_EVIDENCE.transientVisualHeight));
    assert.equal(state.keyboardOpen, false);
    assert.equal(state.keyboardInset, 0);
    assert.equal(state.applicationHeight, IPHONE_EVIDENCE.stableVisualHeight);

    state = resolveViewportState(state, sample(IPHONE_EVIDENCE.stableVisualHeight));
    assert.equal(state.applicationHeight, IPHONE_EVIDENCE.stableVisualHeight);
  }
});

test("viewport synchronization uses no inset magic number or global scroll correction", async () => {
  const source = await readFile(new URL("../src/lib/viewport.js", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b34\b/);
  assert.doesNotMatch(code, /--safe-bottom|safe-area-inset-bottom|safeBottom/);
  assert.doesNotMatch(code, /scrollTo|scrollBy/);
  assert.doesNotMatch(code, /setTimeout/);
});
