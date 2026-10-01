/**
 * Ink that is never saved. Two pens draw it:
 *
 * - Pointer: a laser trail. Every sample fades on its own a moment after it is
 *   drawn, so the line erases itself behind the tip while the pen still moves.
 * - Neon: a glowing line that holds for the whole gesture and fades out once
 *   the finger or stylus lifts.
 *
 * Neither becomes an annotation, an undo step or a sync write. The store is a
 * plain object so the workspace can feed it from pointer events without React
 * renders; TransientInkCanvas subscribes to it and paints.
 */

export const TRANSIENT_INK_KIND = Object.freeze({ POINTER: "pointer", NEON: "neon" });
export const TRANSIENT_PEN_PROFILES = new Set(Object.values(TRANSIENT_INK_KIND));

/** How long one pointer sample stays visible, fading all the way. */
export const POINTER_TRAIL_MS = 700;
/** How long a neon stroke takes to fade after the pen lifts. */
export const NEON_FADE_MS = 450;

/** The colour each pen starts with before the student picks one. */
export const TRANSIENT_DEFAULT_COLOR = Object.freeze({
  [TRANSIENT_INK_KIND.POINTER]: "#ff3b30",
  [TRANSIENT_INK_KIND.NEON]: "#ff2d55"
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Opacity of a pointer sample drawn at `time`. */
export function pointerAlpha(time, now) {
  return clamp01(1 - (now - time) / POINTER_TRAIL_MS);
}

/** Opacity of a whole neon stroke. */
export function neonAlpha(stroke, now) {
  return stroke.endedAt === null ? 1 : clamp01(1 - (now - stroke.endedAt) / NEON_FADE_MS);
}

/** Whether a stroke has nothing left to show and can be dropped. */
export function transientStrokeExpired(stroke, now) {
  if (stroke.endedAt === null) return false;
  if (stroke.kind === TRANSIENT_INK_KIND.NEON) return now - stroke.endedAt >= NEON_FADE_MS;
  const last = stroke.points[stroke.points.length - 1];
  return !last || now - Math.max(last.t, stroke.endedAt) >= POINTER_TRAIL_MS;
}

const now = () => (typeof window !== "undefined" && window.performance ? window.performance.now() : Date.now());

export function createTransientInk({ clock = now } = {}) {
  /** @type {Array<{ kind: string, page: any, color: string, width: number, points: Array<{ x: number, y: number, t: number }>, endedAt: number | null }>} */
  let strokes = [];
  let active = null;
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };

  return {
    begin({ kind, page, color, width, point }) {
      if (active) active.endedAt = clock();
      active = { kind, page, color, width, points: [], endedAt: null };
      strokes.push(active);
      if (point) active.points.push({ x: point.x, y: point.y, t: clock() });
      notify();
    },
    extend(points) {
      if (!active || !points?.length) return;
      const time = clock();
      for (const point of points) active.points.push({ x: point.x, y: point.y, t: time });
      // A pointer sample older than the trail is invisible for good.
      if (active.kind === TRANSIENT_INK_KIND.POINTER) {
        const firstVisible = active.points.findIndex((point) => time - point.t < POINTER_TRAIL_MS);
        // Keep the one sample before the visible run so the first segment still has a start.
        if (firstVisible > 1) active.points.splice(0, firstVisible - 1);
      }
      notify();
    },
    end() {
      if (!active) return;
      active.endedAt = clock();
      active = null;
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
