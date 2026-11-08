import { WORKSPACE_GESTURE } from "../config.js";

export const INTERACTION_STATE = Object.freeze({
  IDLE: "IDLE",
  NATIVE_SCROLL: "NATIVE_SCROLL",
  PENDING_DIRECTION: "pendingDirection",
  VERTICAL_SCROLL: "verticalScroll",
  HORIZONTAL_PAN: "horizontalPan",
  FREE_PAN: "freePan",
  DRAWING: "DRAWING",
  PANNING: "PANNING",
  MOMENTUM: "MOMENTUM",
  PINCHING: "PINCHING",
  SETTLING: "SETTLING",
  SPRING_BACK: "SPRING_BACK",
  SELECTING: "SELECTING",
  ERASING: "ERASING",
  TEXT_EDITING: "TEXT_EDITING",
  OBJECT_TRANSFORMING: "OBJECT_TRANSFORMING"
});

export const GESTURE_DIRECTION = Object.freeze({
  PENDING: "pending",
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
  FREE: "free"
});

export const DRAWING_INPUT = Object.freeze({
  STYLUS_ONLY: "stylus-only",
  STYLUS_AND_FINGER: "stylus-and-finger"
});

const VALID_TRANSITIONS = {
  [INTERACTION_STATE.IDLE]: new Set([
    INTERACTION_STATE.NATIVE_SCROLL,
    INTERACTION_STATE.PENDING_DIRECTION,
    INTERACTION_STATE.VERTICAL_SCROLL,
    INTERACTION_STATE.HORIZONTAL_PAN,
    INTERACTION_STATE.FREE_PAN,
    INTERACTION_STATE.DRAWING,
    INTERACTION_STATE.PANNING,
    INTERACTION_STATE.MOMENTUM,
    INTERACTION_STATE.PINCHING,
    INTERACTION_STATE.SELECTING,
    INTERACTION_STATE.ERASING,
    INTERACTION_STATE.TEXT_EDITING
  ]),
  [INTERACTION_STATE.NATIVE_SCROLL]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PINCHING, INTERACTION_STATE.PANNING]),
  [INTERACTION_STATE.PENDING_DIRECTION]: new Set([
    INTERACTION_STATE.IDLE,
    INTERACTION_STATE.VERTICAL_SCROLL,
    INTERACTION_STATE.HORIZONTAL_PAN,
    INTERACTION_STATE.FREE_PAN,
    INTERACTION_STATE.PINCHING
  ]),
  [INTERACTION_STATE.VERTICAL_SCROLL]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.MOMENTUM, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.HORIZONTAL_PAN]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.MOMENTUM, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.FREE_PAN]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.MOMENTUM, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.DRAWING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.PANNING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.MOMENTUM, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.MOMENTUM]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PANNING, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.PINCHING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.SETTLING, INTERACTION_STATE.SPRING_BACK]),
  [INTERACTION_STATE.SETTLING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PINCHING, INTERACTION_STATE.SPRING_BACK]),
  [INTERACTION_STATE.SPRING_BACK]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PANNING, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.SELECTING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PINCHING, INTERACTION_STATE.OBJECT_TRANSFORMING]),
  [INTERACTION_STATE.ERASING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PINCHING]),
  [INTERACTION_STATE.TEXT_EDITING]: new Set([INTERACTION_STATE.IDLE]),
  [INTERACTION_STATE.OBJECT_TRANSFORMING]: new Set([INTERACTION_STATE.IDLE, INTERACTION_STATE.PINCHING])
};

export function transitionInteraction(current, next) {
  if (current === next) return current;
  return VALID_TRANSITIONS[current]?.has(next) ? next : current;
}

export function classifyGestureDirection(deltaX, deltaY, {
  threshold = WORKSPACE_GESTURE.intentDistance,
  dominanceRatio = WORKSPACE_GESTURE.axisLockRatio,
  allowFreePan = true,
  verticalOnly = false,
  ambiguousFallback = GESTURE_DIRECTION.VERTICAL
} = {}) {
  const x = Math.abs(Number(deltaX) || 0);
  const y = Math.abs(Number(deltaY) || 0);
  if (Math.hypot(x, y) < threshold) return GESTURE_DIRECTION.PENDING;
  if (verticalOnly) return GESTURE_DIRECTION.VERTICAL;
  // Free-angle navigation preserves the real 2D pointer vector. Explicit
  // axis-locked readers can still request a stable dominant-axis lock.
  if (allowFreePan) return GESTURE_DIRECTION.FREE;
  if (y > x * dominanceRatio) return GESTURE_DIRECTION.VERTICAL;
  if (x > y * dominanceRatio) return GESTURE_DIRECTION.HORIZONTAL;
  return ambiguousFallback;
}

export function interactionStateForDirection(direction) {
  if (direction === GESTURE_DIRECTION.VERTICAL) return INTERACTION_STATE.VERTICAL_SCROLL;
  if (direction === GESTURE_DIRECTION.HORIZONTAL) return INTERACTION_STATE.HORIZONTAL_PAN;
  if (direction === GESTURE_DIRECTION.FREE) return INTERACTION_STATE.FREE_PAN;
  return INTERACTION_STATE.PENDING_DIRECTION;
}

export function lockedGestureDelta(direction, deltaX, deltaY) {
  const x = Number(deltaX) || 0;
  const y = Number(deltaY) || 0;
  if (direction === GESTURE_DIRECTION.VERTICAL) return { x: 0, y };
  if (direction === GESTURE_DIRECTION.HORIZONTAL) return { x, y: 0 };
  if (direction === GESTURE_DIRECTION.FREE) return { x, y };
  return { x: 0, y: 0 };
}

export function lockedGestureVelocity(direction, velocity) {
  const delta = lockedGestureDelta(direction, velocity?.x, velocity?.y);
  return { ...delta, speed: Math.hypot(delta.x, delta.y) };
}

export function pointerSnapshot(event) {
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType || "mouse",
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    width: Number(event.width) || 1,
    height: Number(event.height) || 1,
    pressure: Number(event.pressure) || 0,
    time: Number(event.timeStamp) || Date.now()
  };
}

/**
 * What draws before the student has chosen. A phone is written on with a
 * finger, so the finger draws there; a tablet is usually written on with a
 * stylus, so fingers keep scrolling and zooming. A stored choice always wins.
 * @param {{ stored?: string | null, coarsePointer?: boolean, shortestScreenSide?: number, userAgent?: string, deviceModel?: string }} device
 */
/**
 * Some bundled capacitive tablet pens are indistinguishable from a fingertip
 * to a browser. On OSCAL Elite 1 the stylus can arrive as touch; when
 * Android reports this model, prefer touch-compatible ink until overridden.
 * This is deliberately device-specific to preserve palm-safe finger scrolling
 * on tablets whose active pens report pointerType="pen".
 */
export function usesTouchStylusTablet({ userAgent = "", deviceModel = "" } = {}) {
  const identity = `${deviceModel} ${userAgent}`;
  return /\belite[\s_-]*1\b/i.test(identity) && /\b(?:oscal|android)\b/i.test(identity);
}

export function defaultDrawingInput({ stored = null, coarsePointer = false, shortestScreenSide = 0, userAgent = "", deviceModel = "" } = {}) {
  if (stored === DRAWING_INPUT.STYLUS_ONLY || stored === DRAWING_INPUT.STYLUS_AND_FINGER) return stored;
  if (usesTouchStylusTablet({ userAgent, deviceModel })) return DRAWING_INPUT.STYLUS_AND_FINGER;
  const phone = coarsePointer && Number(shortestScreenSide) > 0 && Number(shortestScreenSide) < 600;
  return phone ? DRAWING_INPUT.STYLUS_AND_FINGER : DRAWING_INPUT.STYLUS_ONLY;
}

/**
 * Trust explicit pen and mouse events. Capacitive pens can be reported as
 * "touch", and a few browsers report an empty/unknown type, so allow those
 * only when the student has selected touch-compatible drawing. No browser can
 * safely infer a passive pen from finger-like touch coordinates.
 */
export function isTouchLikePointer(pointerType) {
  return pointerType === "touch" || pointerType === "" || pointerType == null || pointerType === "unknown";
}

export function pointerCanDraw(pointerType, drawingInput) {
  if (pointerType === "pen" || pointerType === "mouse") return true;
  return isTouchLikePointer(pointerType) && drawingInput === DRAWING_INPUT.STYLUS_AND_FINGER;
}

export function classifyStylusInput(pointerType) {
  if (pointerType === "pen") return "pen";
  if (isTouchLikePointer(pointerType)) return "touch";
  return "other";
}

export function suspiciousPalmContact({ event, activePenCount, lastPenAt, lastPenPosition, now = Date.now(), activeTouchCount = 0 }) {
  if (!isTouchLikePointer(event.pointerType) || activeTouchCount > 0) return false;
  const contactSize = Math.max(Number(event.width) || 1, Number(event.height) || 1);
  const distanceFromPen = lastPenPosition ? Math.hypot(event.clientX - lastPenPosition.x, event.clientY - lastPenPosition.y) : Number.POSITIVE_INFINITY;
  // A broad or nearby contact while the stylus is down is a palm. Two small,
  // deliberate contacts away from the tip remain eligible for navigation.
  if (activePenCount > 0) return contactSize >= 18 || distanceFromPen < 82;
  const elapsed = now - (Number(lastPenAt) || 0);
  // Once the stylus is up, a normal fingertip means navigation immediately.
  // Retain only a brief guard for a broad palm landing during pen lift.
  return elapsed <= 180 && contactSize >= 24;
}

export function isTypingTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
