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
    structuralViewportHeight: IPHONE_EVIDENCE.stableVisualHeight,
    visualViewportHeight,
    visualViewportOffsetTop,
    visualViewportScale: 1,
    // The iPhone the evidence came from. The structural latch keys on width, so
    // holding it steady is what makes this sequence one continuous layout.
    viewportWidth: 390,
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
    applicationHeight: IPHONE_EVIDENCE.stableVisualHeight,
    structuralWidth: 390
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

/* ------------------------------------------------------------------------ *
 * Structural latch
 *
 * On iPad, Safari retracts its chrome as soon as a downward scroll starts, so
 * the reading the running maximum maximises over grows mid-gesture. Every
 * structural box sizes from the one token, so a +84px token measured a +84px
 * Dashboard. These exercise the real resolver, not the CSS variable.
 * ------------------------------------------------------------------------ */

const IPAD = { width: 834, established: 1112, chromeRetracted: 1196 };

/** A reading as installViewportSync assembles it. */
function reading({ stable, ruler = stable, width = IPAD.width, visual = stable, focused = false, offsetTop = 0, scale = 1 }) {
  return {
    stableViewportHeight: stable,
    structuralViewportHeight: ruler,
    visualViewportHeight: visual,
    visualViewportOffsetTop: offsetTop,
    visualViewportScale: scale,
    viewportWidth: width,
    focusedTextField: focused
  };
}

// Test 1 -- the reason Math.max exists must survive the latch.
test("a transient under-report never becomes the structural height", () => {
  const established = resolveViewportState(null, reading({ stable: 812, width: 390 }));
  assert.equal(established.applicationHeight, 812);

  // The measured iPhone bug: VisualViewport answers 778 for a frame whose
  // stable rulers still say 812. readStableViewportHeight maxes the rulers
  // before the resolver sees them, so the under-report never reaches the
  // shell -- which is where the Math.max protection actually lives.
  const underReported = resolveViewportState(established, reading({ stable: 812, visual: 778, width: 390 }));
  assert.equal(underReported.applicationHeight, 812, "an under-report must not shrink the shell");

  // A genuine shrink is a different thing and must be taken. Holding the old
  // height through a real reduction leaves the shell taller than the screen
  // with its lower part unreachable -- reproduced at 1366x600, where a stale
  // 700px sidebar hung 100px below the fold and nothing could scroll it.
  const shorterWindow = resolveViewportState(established, reading({ stable: 600, width: 390 }));
  assert.equal(shorterWindow.applicationHeight, 600, "a real shrink must be accepted");
});

// Test 2 -- the bug itself.
test("browser chrome retraction does not grow the structural height", () => {
  const established = resolveViewportState(null, reading({ stable: IPAD.established }));
  assert.equal(established.applicationHeight, IPAD.established);

  // Chrome retracts: same layout, same width, a taller reading.
  const scrolling = resolveViewportState(established, reading({ stable: IPAD.chromeRetracted, ruler: IPAD.established }));

  assert.equal(scrolling.applicationHeight, IPAD.established,
    "the token grew mid-scroll, which is what resized the Dashboard under the finger");
});

// Test 3 -- and it stays held for the whole gesture, not just the first event.
test("a run of growing chrome readings leaves the structural height latched", () => {
  let state = resolveViewportState(null, reading({ stable: IPAD.established }));
  for (const stable of [1130, 1156, 1180, IPAD.chromeRetracted, 1196]) {
    state = resolveViewportState(state, reading({ stable, ruler: IPAD.established }));
    assert.equal(state.applicationHeight, IPAD.established);
  }
  assert.equal(state.structuralWidth, IPAD.width);
});

// Test 4 -- a real layout change still re-measures, through both routes.
test("orientation and width changes establish a new structural height", () => {
  const portrait = resolveViewportState(null, reading({ stable: 1112, width: 834 }));

  // Route 1: installViewportSync passes INITIAL_STATE after orientationchange.
  const afterOrientationReset = resolveViewportState(null, reading({ stable: 834, width: 1112 }));
  assert.equal(afterOrientationReset.applicationHeight, 834);

  // Route 2: the width moved on its own -- Split View, or a desktop resize.
  // Neither is chrome retraction, and both are a new layout.
  const afterWidthChange = resolveViewportState(portrait, reading({ stable: 834, width: 1112 }));
  assert.equal(afterWidthChange.applicationHeight, 834);
  assert.equal(afterWidthChange.structuralWidth, 1112);

  // The new orientation then latches in its own right.
  const scrollingInLandscape = resolveViewportState(afterWidthChange, reading({ stable: 918, ruler: 834, width: 1112 }));
  assert.equal(scrollingInLandscape.applicationHeight, 834);
});

// Test 5 -- the keyboard is measured against the frame, not treated as one.
test("keyboard occlusion still reports live and leaves the structure alone", () => {
  const established = resolveViewportState(null, reading({ stable: IPAD.established }));

  const opened = resolveViewportState(established, reading({
    stable: IPAD.established, visual: IPAD.established - 380, focused: true
  }));
  assert.equal(opened.keyboardOpen, true);
  assert.equal(opened.keyboardInset, 380, "the inset is the live measurement");
  assert.equal(opened.applicationHeight, IPAD.established, "the structure does not move for a keyboard");

  // A deeper keyboard updates the inset and still not the structure.
  const deeper = resolveViewportState(opened, reading({
    stable: IPAD.established, visual: IPAD.established - 420, focused: true
  }));
  assert.equal(deeper.keyboardInset, 420);
  assert.equal(deeper.applicationHeight, IPAD.established);

  // Closing releases the inset and restores nothing, because nothing changed.
  const closed = resolveViewportState(deeper, reading({ stable: IPAD.established }));
  assert.equal(closed.keyboardOpen, false);
  assert.equal(closed.keyboardInset, 0);
  assert.equal(closed.applicationHeight, IPAD.established);
  // The layout key survives the session, so closing is not read as a new layout.
  assert.equal(closed.structuralWidth, IPAD.width);
});

test("a real height-only window resize can grow the structural viewport", () => {
  const established = resolveViewportState(null, reading({ stable: 700, width: 1280 }));
  const tallerWindow = resolveViewportState(established, reading({ stable: 900, ruler: 900, width: 1280 }));
  assert.equal(tallerWindow.applicationHeight, 900);
  assert.equal(tallerWindow.structuralWidth, 1280);
});

test("the latch is documented where the ceiling is applied", async () => {
  const source = await readFile(new URL("../src/lib/viewport.js", import.meta.url), "utf8");
  assert.match(source, /const sameLayout = established && structuralWidth === prior\.structuralWidth/);
  // No timer, and no scroll writing: the fix is a measurement decision.
  assert.doesNotMatch(source, /setTimeout|setInterval|scrollTo|scrollTop/);
});
