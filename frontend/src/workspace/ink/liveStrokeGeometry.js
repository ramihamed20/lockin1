import {
  strokeCenterlinePathRange,
  strokeCumulativeLengths,
  strokeOpacity,
  strokeOutlinePathRange,
  strokeProfileConfig,
  strokeRadiiForPoints,
  strokeTaperLengths,
  strokeWidthAtPoint
} from "./strokeModel.js";

const MINIMUM_UNIQUE_DISTANCE = .025;
/** Control points of the centerline curve reach two samples back. */
const CENTERLINE_DIRTY_SAMPLES = 3;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function smoothingAmountFor(previous, point, next, smoothing) {
  const duration = Math.max(1, finite(next.t, 1) - finite(previous.t, -1));
  const velocity = (pointDistance(previous, point) + pointDistance(point, next)) / duration;
  const strength = clamp(finite(smoothing, .5), 0, 1);
  return (.04 + strength * .1) + clamp(velocity / 2.4, 0, 1) * (.1 + strength * .2);
}

/** Reproduces one interior sample of `smoothStrokePoints` without rebuilding the array. */
function smoothInterior(previous, point, next, smoothing) {
  const amount = smoothingAmountFor(previous, point, next, smoothing);
  const centerX = (previous.x + point.x * 2 + next.x) / 4;
  const centerY = (previous.y + point.y * 2 + next.y) / 4;
  return { ...point, x: point.x + (centerX - point.x) * amount, y: point.y + (centerY - point.y) * amount };
}

function strokeIdentity(annotation) {
  return [
    annotation?.id,
    annotation?.type,
    annotation?.profile,
    annotation?.color,
    finite(annotation?.width, 4),
    finite(annotation?.opacity, 1),
    finite(annotation?.pressureSensitivity, .55),
    finite(annotation?.smoothing, .5)
  ].join(":");
}

/**
 * Incremental geometry for the stroke that is currently being drawn.
 *
 * Rebuilding an entire outline every pointer frame is O(samples) in string
 * building and Path2D parsing, which is what makes a long stroke feel heavy
 * near the end. This keeps the smoothed samples, arc lengths, and radii in
 * reusable arrays and reports only the range whose geometry actually changed.
 *
 * Appending is safe because a sample's width never shrinks as the stroke grows:
 * the start taper is a fixed arc-length span from the first sample and the end
 * taper span is a fixed distance from the moving tip, so a point can only leave
 * the taper. Repainting a wider outline over a narrower one is therefore exact,
 * and the caller never has to clear pixels it cannot reconstruct.
 */
export function createLiveStrokeGeometry() {
  let identity = null;
  let consumed = 0;
  let smoothing = .5;
  let unique = [];
  let smoothed = [];
  let cumulative = [];
  let radii = [];
  let paintedCount = 0;
  let paintedVolatile = false;

  function reset() {
    identity = null;
    consumed = 0;
    unique = [];
    smoothed = [];
    cumulative = [];
    radii = [];
    paintedCount = 0;
    paintedVolatile = false;
  }

  /** Forces the next frame to repaint from the first sample. */
  function invalidate() {
    paintedCount = 0;
    paintedVolatile = false;
  }

  function appendSource(points) {
    const previousUniqueCount = unique.length;
    for (let index = consumed; index < points.length; index += 1) {
      const point = points[index];
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
      const last = unique[unique.length - 1];
      if (!last || pointDistance(last, point) > MINIMUM_UNIQUE_DISTANCE) unique.push(point);
      else unique[unique.length - 1] = point;
    }
    consumed = points.length;
    // The final sample is always exact and the one before it is filtered from
    // its neighbours, so both are re-derived whenever the tail moves.
    return Math.max(0, previousUniqueCount - 2);
  }

  function resmooth(fromIndex) {
    const count = unique.length;
    smoothed.length = count;
    if (count < 3) {
      for (let index = 0; index < count; index += 1) smoothed[index] = unique[index];
      return 0;
    }
    const start = Math.max(0, Math.min(fromIndex, count - 1));
    for (let index = start; index < count; index += 1) {
      smoothed[index] = index === 0 || index === count - 1
        ? unique[index]
        : smoothInterior(unique[index - 1], unique[index], unique[index + 1], smoothing);
    }
    return start;
  }

  /** Indices whose end-taper factor still moves with the tip. */
  function endTaperDirtyIndex(annotation) {
    const config = strokeProfileConfig(annotation);
    const spans = strokeTaperLengths(config, Math.max(.35, finite(annotation?.width, 4)));
    if (spans.end <= 0) return smoothed.length;
    const total = cumulative[smoothed.length - 1] || 0;
    let index = smoothed.length - 1;
    while (index > 0 && total - cumulative[index - 1] < spans.end) index -= 1;
    return index;
  }

  /**
   * @param {any} annotation
   * @param {any[]} [predicted] display-only samples that must never be appended
   * @param {{ forceFull?: boolean }} [options]
   */
  function frame(annotation, predicted = [], { forceFull = false } = {}) {
    const points = annotation?.points || [];
    const nextIdentity = strokeIdentity(annotation);
    const volatileTail = Boolean(predicted?.length);
    if (identity !== nextIdentity || points.length < consumed) {
      reset();
      identity = nextIdentity;
      smoothing = finite(annotation?.smoothing, strokeProfileConfig(annotation).smoothing);
    }
    let dirtyFrom = Math.max(0, smoothed.length - 1);
    if (points.length > consumed || !smoothed.length) {
      const uniqueDirty = appendSource(points);
      const smoothedDirty = resmooth(uniqueDirty);
      strokeCumulativeLengths(smoothed, cumulative, Math.max(0, smoothedDirty - 1));
      dirtyFrom = Math.max(0, Math.min(smoothedDirty - 1, endTaperDirtyIndex(annotation) - 1));
      strokeRadiiForPoints(annotation, smoothed, cumulative, radii, dirtyFrom);
    }

    const opacity = strokeOpacity(annotation);
    const isHighlighter = annotation?.type === "highlighter";
    const composite = isHighlighter ? "multiply" : "source-over";
    if (!smoothed.length) {
      paintedCount = 0;
      paintedVolatile = false;
      return { mode: "full", kind: "empty", path: "", opacity, composite, color: annotation?.color };
    }
    if (smoothed.length === 1) {
      paintedCount = 0;
      paintedVolatile = false;
      return {
        mode: "full",
        kind: "dot",
        x: smoothed[0].x,
        y: smoothed[0].y,
        radius: strokeWidthAtPoint(annotation, smoothed[0]) / 2,
        opacity,
        composite,
        color: annotation?.color
      };
    }

    const full = forceFull || volatileTail || paintedVolatile || paintedCount === 0 || paintedCount > smoothed.length;
    const displaySamples = volatileTail ? [...smoothed, ...predicted] : smoothed;
    if (isHighlighter) {
      const from = full ? 0 : Math.max(0, Math.min(dirtyFrom, paintedCount - CENTERLINE_DIRTY_SAMPLES));
      paintedCount = smoothed.length;
      paintedVolatile = volatileTail;
      return {
        mode: full ? "full" : "append",
        kind: "centerline",
        path: strokeCenterlinePathRange(displaySamples, full ? 0 : from),
        width: Math.max(.5, finite(annotation?.width, 4)),
        opacity,
        composite,
        color: annotation?.color
      };
    }
    let path;
    if (full) {
      path = volatileTail
        ? strokeOutlinePathRange(displaySamples, displayRadii(annotation, displaySamples), 0)
        : strokeOutlinePathRange(smoothed, radii, 0);
    } else {
      path = strokeOutlinePathRange(smoothed, radii, Math.max(0, Math.min(dirtyFrom, paintedCount - 1)));
    }
    paintedCount = smoothed.length;
    paintedVolatile = volatileTail;
    return { mode: full ? "full" : "append", kind: "outline", path, opacity, composite, color: annotation?.color };
  }

  /** Predicted samples are rare and short, so their radii are computed off the reusable arrays. */
  function displayRadii(annotation, samples) {
    const lengths = strokeCumulativeLengths(samples, []);
    return strokeRadiiForPoints(annotation, samples, lengths, []);
  }

  return { frame, invalidate, reset };
}
