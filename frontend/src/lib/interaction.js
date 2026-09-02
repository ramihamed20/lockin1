/**
 * Centralised interaction-state runtime.
 *
 * The application used to let the browser decide what "pressed", "hovered" and
 * "focused" looked like, which produced three long-standing defects:
 *
 *   1. Touch devices keep an element in `:hover` after a tap, so an action
 *      button stayed lit until the user tapped somewhere else.
 *   2. Every mouse click left a `:focus` ring behind because several rules
 *      styled `:focus` (or reused hover visuals for `:focus-visible`).
 *   3. Native tap highlights fought with the app's own press feedback.
 *
 * The runtime owns three pieces of global state and nothing else. All visuals
 * live in `styles/interaction.css`; this module only reports the truth:
 *
 *   html.ix-hover                 -> hover visuals are allowed right now
 *   html[data-ix-input=…]         -> mouse | pen | touch | key
 *   [data-ix-pressed]             -> exactly one element is being pressed
 *
 * Press state is deliberately driven from JS rather than `:active`. `:active`
 * is unreliable on iOS (it needs a touch listener, survives cancelled
 * gestures, and lingers after a scroll starts) which is the direct cause of
 * the "needs a second tap to clear" reports.
 */

/** Elements that can own a press state. Keep in sync with interaction.css. */
export const INTERACTIVE_SELECTOR = [
  "button",
  "summary",
  "a[href]",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[role='checkbox']",
  "label[for]",
  "input[type='checkbox']",
  "input[type='radio']",
  "input[type='submit']",
  "input[type='button']",
  "[data-ix]"
].join(",");

const PRESSED_ATTRIBUTE = "data-ix-pressed";
const INPUT_ATTRIBUTE = "data-ix-input";
const HOVER_CLASS = "ix-hover";
/** A drag past this many pixels is a scroll or a swipe, never a press. */
const PRESS_CANCEL_DISTANCE = 12;

/** @type {Element | null} */
let pressedElement = null;
/** @type {{ x: number, y: number, pointerId: number } | null} */
let pressOrigin = null;
let installed = false;

function root() {
  return document.documentElement;
}

/**
 * `matchMedia` is the best guess available before the first real pointer
 * event. A desktop browser reports a fine hover-capable pointer, an iPad
 * without a trackpad does not.
 */
function prefersHoverVisuals() {
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * @param {"mouse" | "pen" | "touch" | "key"} kind
 */
export function setInputKind(kind) {
  const element = root();
  if (element.getAttribute(INPUT_ATTRIBUTE) !== kind) element.setAttribute(INPUT_ATTRIBUTE, kind);
  // Touch is the only input that must not leave hover visuals behind. A pen or
  // a mouse on a hybrid device is allowed to hover again immediately.
  const allowHover = kind === "mouse" || kind === "pen" || (kind === "key" && prefersHoverVisuals());
  element.classList.toggle(HOVER_CLASS, allowHover);
}

/** Removes the press marker from whichever element currently holds it. */
export function clearPress() {
  if (pressedElement) pressedElement.removeAttribute(PRESSED_ATTRIBUTE);
  pressedElement = null;
  pressOrigin = null;
}

/**
 * @param {EventTarget | null} target
 * @returns {Element | null}
 */
function pressTargetFor(target) {
  if (!(target instanceof window.Element)) return null;
  const candidate = target.closest(INTERACTIVE_SELECTOR);
  if (!candidate) return null;
  if (candidate.hasAttribute("disabled") || candidate.getAttribute("aria-disabled") === "true") return null;
  if (candidate.getAttribute("data-ix-press") === "none") return null;
  return candidate;
}

/** @param {PointerEvent} event */
function handlePointerDown(event) {
  setInputKind(event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse");
  clearPress();
  // Secondary buttons open context menus; they never read as a press.
  if (event.button !== 0 && event.pointerType === "mouse") return;
  const candidate = pressTargetFor(event.target);
  if (!candidate) return;
  pressedElement = candidate;
  pressOrigin = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  candidate.setAttribute(PRESSED_ATTRIBUTE, "");
}

/** @param {PointerEvent} event */
function handlePointerMove(event) {
  if (!pressOrigin || event.pointerId !== pressOrigin.pointerId) return;
  const travelled = Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y);
  if (travelled > PRESS_CANCEL_DISTANCE) clearPress();
}

/** @param {MouseEvent} event */
function handleMouseMove(event) {
  // Some hybrid devices emit synthetic mouse moves after a tap. Only a real
  // move with no buttons held re-enables hover visuals.
  if (event.buttons === 0 && root().getAttribute(INPUT_ATTRIBUTE) === "touch" && prefersHoverVisuals()) setInputKind("mouse");
}

/** @param {KeyboardEvent} event */
function handleKeyDown(event) {
  if (event.key === "Tab" || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
    setInputKind("key");
    return;
  }
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
  if (event.repeat) return;
  const candidate = pressTargetFor(document.activeElement);
  if (!candidate || candidate !== event.target) return;
  clearPress();
  pressedElement = candidate;
  candidate.setAttribute(PRESSED_ATTRIBUTE, "");
}

/**
 * Installs the runtime. Safe to call more than once (React StrictMode mounts
 * effects twice in development).
 * @returns {() => void} teardown for tests
 */
export function installInteractionRuntime() {
  if (installed) return () => undefined;
  installed = true;
  setInputKind(prefersHoverVisuals() ? "mouse" : "touch");

  const passive = { passive: true };
  const capture = { capture: true, passive: true };

  document.addEventListener("pointerdown", handlePointerDown, capture);
  document.addEventListener("pointermove", handlePointerMove, capture);
  document.addEventListener("pointerup", clearPress, capture);
  document.addEventListener("pointercancel", clearPress, capture);
  document.addEventListener("dragstart", clearPress, capture);
  document.addEventListener("contextmenu", clearPress, capture);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", clearPress, true);
  document.addEventListener("mousemove", handleMouseMove, passive);
  // A scroll always cancels a press: the gesture became a swipe.
  window.addEventListener("scroll", clearPress, { capture: true, passive: true });
  window.addEventListener("blur", clearPress, passive);
  window.addEventListener("hashchange", clearPress, passive);
  window.addEventListener("popstate", clearPress, passive);
  document.addEventListener("visibilitychange", clearPress, passive);

  return () => {
    installed = false;
    clearPress();
    document.removeEventListener("pointerdown", handlePointerDown, capture);
    document.removeEventListener("pointermove", handlePointerMove, capture);
    document.removeEventListener("pointerup", clearPress, capture);
    document.removeEventListener("pointercancel", clearPress, capture);
    document.removeEventListener("dragstart", clearPress, capture);
    document.removeEventListener("contextmenu", clearPress, capture);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keyup", clearPress, true);
    document.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("scroll", clearPress, true);
    window.removeEventListener("blur", clearPress);
    window.removeEventListener("hashchange", clearPress);
    window.removeEventListener("popstate", clearPress);
    document.removeEventListener("visibilitychange", clearPress);
  };
}
