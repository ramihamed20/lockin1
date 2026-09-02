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
 */

/** @type {ViewportState} */
const INITIAL_STATE = { keyboardOpen: false, keyboardInset: 0, applicationHeight: 0 };

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
  const applicationHeight = keyboardOpen || keyboardClosing
    ? baselineHeight
    : candidateHeight || baselineHeight;

  return {
    keyboardOpen,
    keyboardInset: keyboardOpen ? occludedHeight : 0,
    applicationHeight
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
    visualViewportHeight: finiteNumber(viewport?.height, win.innerHeight),
    visualViewportOffsetTop: finiteNumber(viewport?.offsetTop),
    visualViewportScale: finiteNumber(viewport?.scale, 1),
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
