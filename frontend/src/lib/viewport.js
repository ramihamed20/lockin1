/**
 * The application's single viewport authority.
 *
 * Safari exposes two different kinds of vertical measurement:
 *
 *   - the large viewport is the stable, edge-to-edge application frame with
 *     retractable browser chrome out of the way;
 *   - VisualViewport is the portion currently visible through browser chrome,
 *     the keyboard, pinch zoom, and rubber-band movement.
 *
 * The application shell and the PDF coordinate frame need the first. Keyboard
 * avoidance needs the second. Feeding `100dvh` directly into the shell mixed
 * those responsibilities: on a physical iPhone Safari temporarily reported a
 * 778px dynamic/visual viewport even though the stable application frame was
 * 812px. Because `100dvh` accepted 778px, the root stayed one bottom safe-area
 * inset short until a rubber-band gesture made Safari publish 812px.
 *
 * This module now measures the stable large viewport, publishes it in pixels as
 * `--app-viewport-height`, and compares VisualViewport against that stable
 * frame only to detect keyboard occlusion. Browser-chrome and rubber-band
 * events can therefore update diagnostics and keyboard state without resizing
 * every application surface. No document scroll position is written here.
 */

/** Browser chrome is smaller than this; a keyboard occlusion is not. */
const KEYBOARD_MIN_INSET = 120;

const KEYBOARD_FIELD_SELECTOR = [
  "textarea",
  "input:not([type])",
  "input[type='text']",
  "input[type='search']",
  "input[type='email']",
  "input[type='password']",
  "input[type='tel']",
  "input[type='url']",
  "input[type='number']"
].join(", ");

/**
 * @typedef {object} ViewportState
 * @property {boolean} keyboardOpen
 * @property {number} keyboardInset
 * @property {number} applicationHeight
 * @property {number} structuralWidth Width the structural height was measured
 *   at. A latched height is only re-established when this changes.
 */

/** @type {ViewportState} */
const INITIAL_STATE = { keyboardOpen: false, keyboardInset: 0, applicationHeight: 0, structuralWidth: 0 };

/** @type {ViewportState} */
let state = { ...INITIAL_STATE };

/** @type {Set<(state: ViewportState) => void>} */
const listeners = new Set();

let teardown = null;

function finiteNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Whether focusing this element is what raises an on-screen keyboard. */
function opensVirtualKeyboard(element) {
  return Boolean(element) && (
    element.isContentEditable === true ||
    (typeof element.matches === "function" && element.matches(KEYBOARD_FIELD_SELECTOR))
  );
}

/**
 * Resolve one browser measurement into the state consumed by the application.
 * Exported so the physical-iPhone lifecycle can be regression-tested without
 * pretending Chromium has Safari's browser chrome.
 *
 * The stable height is held for the entire keyboard session, including the
 * closing edge. Some browsers restore VisualViewport before blur; others blur
 * first and resize later. Treating the previous open state as evidence until
 * the occlusion is gone handles both without a timer.
 */
export function resolveViewportState(previous, measurement) {
  const prior = previous || INITIAL_STATE;
  const candidateHeight = Math.max(0, Math.round(finiteNumber(measurement.stableViewportHeight)));
  const baselineHeight = prior.applicationHeight > 0 ? prior.applicationHeight : candidateHeight;
  const visualHeight = Math.max(0, finiteNumber(measurement.visualViewportHeight, candidateHeight));
  // Negative values are Safari rubber-band overscroll, not keyboard coverage.
  const visualOffsetTop = Math.max(0, finiteNumber(measurement.visualViewportOffsetTop));
  const scale = finiteNumber(measurement.visualViewportScale, 1);
  const zoomed = Math.abs(scale - 1) > 0.01;
  const occludedHeight = Math.max(0, Math.round(baselineHeight - visualHeight - visualOffsetTop));
  const keyboardOpen = !zoomed
    && occludedHeight >= KEYBOARD_MIN_INSET
    && (measurement.focusedTextField === true || prior.keyboardOpen);
  const keyboardClosing = prior.keyboardOpen && !keyboardOpen;

  // Once a structural height is established it is latched for as long as the
  // layout it describes lasts.
  //
  // The running maximum in readStableViewportHeight has no ceiling, and on iPad
  // the reading it maximises over grows the moment Safari retracts its chrome --
  // which is the moment a downward scroll begins. Accepting that growth
  // republished --app-viewport-height mid-gesture, and because the document
  // chain, the shell, .content-frame and the sticky sidebar all size from that
  // one token, the whole Dashboard resized under the reader's finger. A
  // measured +84px on the token moved every one of those boxes by +84px.
  //
  // Retracting chrome is not a new layout, so it must not establish a new
  // structural height. A width change is: rotating the device, entering Split
  // View, or resizing a desktop window all change how wide the layout is, and
  // all legitimately need re-measuring. Width is the discriminator because
  // chrome retraction is the one viewport change that cannot alter it.
  const established = prior.applicationHeight > 0;
  const structuralWidth = Math.max(0, Math.round(finiteNumber(measurement.viewportWidth)));
  const sameLayout = established && structuralWidth === prior.structuralWidth;
  // The CSS large-viewport ruler stays fixed while Safari retracts its chrome,
  // but changes for a real height-only window resize.
  const structuralHeight = Math.max(0, Math.round(finiteNumber(measurement.structuralViewportHeight, candidateHeight)));
  // Only growth is refused, and only within one layout. Retracting chrome can
  // only ever hand back *more* height, so refusing growth is enough to stop it
  // resizing the shell mid-scroll -- and the frame settles on the viewport with
  // the chrome expanded, which is the one height that does not move while
  // scrolling.
  //
  // A shrink is always taken. A window resized shorter, a pane opened, a device
  // rotated into a shorter frame: these are real, and holding the old height
  // through them leaves the shell taller than the screen with its lower part
  // unreachable -- measured at 1366x600, where a stale 700px sidebar hung 100px
  // below the fold with nothing able to scroll it. Under-reporting is already
  // filtered inside one measurement by readStableViewportHeight, which maxes
  // the large-viewport ruler against the others, so it does not need a second
  // guard across time here.
  const wouldGrow = candidateHeight > baselineHeight;
  const structuralGrowth = structuralHeight > baselineHeight;
  const applicationHeight = keyboardOpen || keyboardClosing || (sameLayout && wouldGrow && !structuralGrowth)
    ? baselineHeight
    : candidateHeight || baselineHeight;

  return {
    keyboardOpen,
    // Live, and deliberately independent of the latch: the keyboard is measured
    // against the structural frame, not treated as a change to it.
    keyboardInset: keyboardOpen ? occludedHeight : 0,
    applicationHeight,
    // Held across a keyboard session so closing the keyboard does not read as a
    // new layout; refreshed whenever a new structural height is established.
    structuralWidth: sameLayout || keyboardOpen || keyboardClosing
      ? (prior.structuralWidth || structuralWidth)
      : structuralWidth
  };
}

/**
 * Observe the viewport. The listener is called immediately and then whenever
 * the stable application frame or keyboard reading changes.
 */
export function subscribeViewport(listener) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next) {
  if (
    next.keyboardOpen === state.keyboardOpen
    && next.keyboardInset === state.keyboardInset
    && next.applicationHeight === state.applicationHeight
    && next.structuralWidth === state.structuralWidth
  ) return;
  state = next;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      // One subscriber must not prevent the shell and workspace from receiving
      // the same authoritative measurement.
    }
  });
}

/**
 * Create an out-of-flow ruler for the large viewport. `100lvh` is stable while
 * Safari animates its chrome; `100vh` is the compatible large-viewport fallback
 * on browsers that predate the explicit unit.
 */
function createLargeViewportProbe(win, doc) {
  const probe = doc.createElement("div");
  const supportsLargeViewport = win.CSS?.supports?.("height", "100lvh") === true;
  probe.dataset.appViewportProbe = "";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:fixed",
    "inset:0 auto auto 0",
    "width:0",
    `height:${supportsLargeViewport ? "100lvh" : "100vh"}`,
    "visibility:hidden",
    "pointer-events:none",
    "contain:strict"
  ].join(";");
  (doc.body || doc.documentElement).append(probe);
  return probe;
}

/**
 * The large-viewport ruler is primary. The other scale-1 readings are included
 * as a one-way safety envelope for WebKit embeddings that have historically
 * reported `lvh` as the small viewport. Keyboard-resized readings cannot shrink
 * an existing session because resolveViewportState holds its baseline.
 */
function readStableViewportHeight(win, root, viewport, probe) {
  const scale = finiteNumber(viewport?.scale, 1);
  const visualBottom = Math.abs(scale - 1) <= 0.01
    ? finiteNumber(viewport?.height) + Math.max(0, finiteNumber(viewport?.offsetTop))
    : 0;
  return Math.max(
    0,
    finiteNumber(probe?.getBoundingClientRect().height),
    finiteNumber(win.innerHeight),
    finiteNumber(root.clientHeight),
    visualBottom
  );
}

/**
 * Install the viewport sync layer before React renders. Updates are event-driven
 * and coalesced into animation frames; there are no polling timers and no
 * document-scroll corrections.
 */
export function installViewportSync(win = typeof window === "undefined" ? undefined : window) {
  if (!win) return () => {};
  if (teardown) return teardown;
  const doc = win.document;
  const root = doc?.documentElement;
  if (!root) return () => {};

  const viewport = win.visualViewport;
  const probe = createLargeViewportProbe(win, doc);
  let frame = 0;
  let resetForNewOrientation = false;

  const measure = () => ({
    stableViewportHeight: readStableViewportHeight(win, root, viewport, probe),
    structuralViewportHeight: finiteNumber(probe?.getBoundingClientRect().height),
    visualViewportHeight: finiteNumber(viewport?.height, win.innerHeight),
    visualViewportOffsetTop: finiteNumber(viewport?.offsetTop),
    visualViewportScale: finiteNumber(viewport?.scale, 1),
    viewportWidth: finiteNumber(viewport?.width, win.innerWidth),
    focusedTextField: opensVirtualKeyboard(doc.activeElement)
  });

  const apply = () => {
    frame = 0;
    const previous = resetForNewOrientation ? INITIAL_STATE : state;
    resetForNewOrientation = false;
    const next = resolveViewportState(previous, measure());
    if (next.applicationHeight > 0) {
      root.style.setProperty("--app-viewport-height", `${next.applicationHeight}px`);
    }
    root.style.setProperty("--keyboard-inset", `${next.keyboardInset}px`);
    if (next.keyboardOpen) root.dataset.keyboard = "open";
    else delete root.dataset.keyboard;
    publish(next);
  };

  const update = () => {
    if (frame) win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(apply);
  };

  const handleOrientationChange = () => {
    resetForNewOrientation = true;
    update();
  };

  const handleVisibilityChange = () => {
    if (doc.visibilityState === "visible") update();
  };

  // Synchronous publication keeps React's first frame on the stable authority.
  apply();

  viewport?.addEventListener("resize", update, { passive: true });
  viewport?.addEventListener("scroll", update, { passive: true });
  win.addEventListener("resize", update, { passive: true });
  win.addEventListener("pageshow", update, { passive: true });
  win.addEventListener("orientationchange", handleOrientationChange, { passive: true });
  doc.addEventListener("focusin", update, { passive: true });
  doc.addEventListener("focusout", update, { passive: true });
  doc.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });

  teardown = () => {
    if (frame) win.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    win.removeEventListener("resize", update);
    win.removeEventListener("pageshow", update);
    win.removeEventListener("orientationchange", handleOrientationChange);
    doc.removeEventListener("focusin", update);
    doc.removeEventListener("focusout", update);
    doc.removeEventListener("visibilitychange", handleVisibilityChange);
    probe.remove();
    root.style.removeProperty("--app-viewport-height");
    root.style.removeProperty("--keyboard-inset");
    delete root.dataset.keyboard;
    state = { ...INITIAL_STATE };
    teardown = null;
  };
  return teardown;
}
