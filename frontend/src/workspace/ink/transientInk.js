/**
 * Ink that is never saved. Two pens draw it, Pointer and Neon. A stroke stays
 * fully visible while the pen is down and for TRANSIENT_HOLD_MS after the last
 * lift, then fades out over TRANSIENT_FADE_MS. Writing again inside the hold
 * restarts it for everything still on screen, so a word or a sentence vanishes
 * together once the student stops.
 *
 * Neither becomes an annotation, an undo step or a sync write. The store is a
 * plain object so the workspace can feed it from pointer events without React
 * renders; TransientInkCanvas subscribes to it and paints.
 */

export const TRANSIENT_INK_KIND = Object.freeze({ POINTER: "pointer", NEON: "neon" });
export const TRANSIENT_PEN_PROFILES = new Set(Object.values(TRANSIENT_INK_KIND));

/** How long ink stays fully visible after the pen stops. */
export const TRANSIENT_HOLD_MS = 1500;
/** How long the fade-out takes once the hold is over. */
export const TRANSIENT_FADE_MS = 800;

/** The colour each pen starts with before the student picks one. */
export const TRANSIENT_DEFAULT_COLOR = Object.freeze({
  [TRANSIENT_INK_KIND.POINTER]: "#ff3b30",
  [TRANSIENT_INK_KIND.NEON]: "#ff2d55"
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Opacity of a stroke: full until its `fadeAt`, then fading out. */
export function transientAlpha(stroke, now) {
  return stroke.fadeAt === null ? 1 : clamp01(1 - (now - stroke.fadeAt) / TRANSIENT_FADE_MS);
}

/** Whether a stroke has nothing left to show and can be dropped. */
export function transientStrokeExpired(stroke, now) {
  return stroke.fadeAt !== null && now - stroke.fadeAt >= TRANSIENT_FADE_MS;
}

const now = () => (typeof window !== "undefined" && window.performance ? window.performance.now() : Date.now());

export function createTransientInk({ clock = now } = {}) {
  /** @type {Array<{ kind: string, page: any, color: string, width: number, points: Array<{ x: number, y: number, t: number }>, fadeAt: number | null }>} */
  let strokes = [];
  let active = null;
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };

  // Ink that has not started fading waits for the pen to stop; ink already
  // fading carries on and is never pulled back to full opacity.
  const holdPending = (time) => {
    for (const stroke of strokes) if (stroke.fadeAt === null || stroke.fadeAt > time) stroke.fadeAt = null;
  };
  const scheduleFade = (time) => {
    for (const stroke of strokes) if (stroke.fadeAt === null || stroke.fadeAt > time) stroke.fadeAt = time + TRANSIENT_HOLD_MS;
  };

  return {
    begin({ kind, page, color, width, point }) {
      const time = clock();
      holdPending(time);
      active = { kind, page, color, width, points: [], fadeAt: null };
      strokes.push(active);
      if (point) active.points.push({ x: point.x, y: point.y, t: time });
      notify();
    },
    extend(points) {
      if (!active || !points?.length) return;
      const time = clock();
      for (const point of points) active.points.push({ x: point.x, y: point.y, t: time });
      notify();
    },
    end() {
      if (!active) return;
      active = null;
      scheduleFade(clock());
      notify();
    },
    clear() {
      strokes = [];
      active = null;
      notify();
    },
    /** Drops finished strokes and returns what is still visible on `page`. */
    visible(page, time = clock()) {
      strokes = strokes.filter((stroke) => !transientStrokeExpired(stroke, time));
      return strokes.filter((stroke) => stroke.page === page);
    },
    isDrawing() {
      return active !== null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    now: clock
  };
}
