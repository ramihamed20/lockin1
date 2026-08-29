function pointerSample(sample, event, toPagePoint) {
  const point = toPagePoint(sample.clientX, sample.clientY);
  const pointer = sample.pointerType || event.pointerType || "mouse";
  const pressure = Number(sample.pressure);
  return {
    ...point,
    t: Number(sample.timeStamp) || Date.now(),
    p: Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0,
    pressureAvailable: pointer === "pen" && Number.isFinite(pressure) && pressure > 0,
    pointer,
    pointerId: Number(sample.pointerId ?? event.pointerId) || 0,
    buttons: Number(sample.buttons ?? event.buttons) || 0,
    contactWidth: Math.max(0, Number(sample.width) || 0),
    contactHeight: Math.max(0, Number(sample.height) || 0),
    tiltX: Number(sample.tiltX) || 0,
    tiltY: Number(sample.tiltY) || 0,
    altitudeAngle: Number.isFinite(sample.altitudeAngle) ? sample.altitudeAngle : null,
    azimuthAngle: Number.isFinite(sample.azimuthAngle) ? sample.azimuthAngle : null,
    twist: Number.isFinite(sample.twist) ? sample.twist : null,
    tangentialPressure: Number.isFinite(sample.tangentialPressure) ? sample.tangentialPressure : null,
    isPrimary: sample.isPrimary !== false,
    w: null
  };
}

export function samplesFromPointerEvent(event, toPagePoint) {
  const source = event.getCoalescedEvents?.();
  const events = source?.length ? [...source] : [event];
  const last = events[events.length - 1];
  if (last !== event && (last.clientX !== event.clientX || last.clientY !== event.clientY || last.timeStamp !== event.timeStamp)) events.push(event);
  return events.map((sample) => pointerSample(sample, event, toPagePoint));
}

/** Predicted samples are display-only and must never enter persisted stroke data. */
export function predictedSamplesFromPointerEvent(event, toPagePoint) {
  const predicted = event.getPredictedEvents?.();
  return predicted?.length ? [...predicted].map((sample) => pointerSample(sample, event, toPagePoint)) : [];
}

export const PEN_PROFILE = Object.freeze({
  BALL: "ball",
  FOUNTAIN: "fountain",
  BRUSH: "brush",
  PENCIL: "pencil",
  HIGHLIGHTER: "highlighter"
});

export const PEN_PROFILE_CONFIG = Object.freeze({
  [PEN_PROFILE.BALL]: Object.freeze({ pressureStrength: .1, velocityStrength: .02, smoothing: .42, taperStart: 0, taperEnd: 0, tiltStrength: 0 }),
  [PEN_PROFILE.FOUNTAIN]: Object.freeze({ pressureStrength: .42, velocityStrength: .16, smoothing: .56, taperStart: .08, taperEnd: .12, tiltStrength: .04 }),
  [PEN_PROFILE.BRUSH]: Object.freeze({ pressureStrength: .82, velocityStrength: .1, smoothing: .62, taperStart: .12, taperEnd: .18, tiltStrength: .14 }),
  [PEN_PROFILE.PENCIL]: Object.freeze({ pressureStrength: .56, velocityStrength: .05, smoothing: .48, taperStart: .04, taperEnd: .06, tiltStrength: .38 }),
  [PEN_PROFILE.HIGHLIGHTER]: Object.freeze({ pressureStrength: 0, velocityStrength: 0, smoothing: .36, taperStart: 0, taperEnd: 0, tiltStrength: 0 })
});

export const ERASER_MODE = Object.freeze({
  PRECISION: "precision",
  SEGMENT: "segment",
  STROKE: "stroke"
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function format(value) {
  return Number(finite(value).toFixed(2));
}

/**
 * @typedef {{x:number,y:number,t?:number,p?:number,pressureAvailable?:boolean,pointer?:string,tiltX?:number,tiltY?:number}} InkPoint
 * @typedef {{id:string,page:number,type:"pen"|"pencil"|"highlighter",color:string,width:number,opacity:number,points:InkPoint[],profile?:string,pressureSensitivity?:number,smoothing?:number}} InkStroke
 * @typedef {{kind:"empty"|"dot"|"centerline"|"outline", opacity:number, composite:string, path?:string, width?:number, radius?:number, x?:number, y?:number}} StrokeGeometry
 */

const TAPER_NIB_SPAN = 40;

const strokeGeometryCache = new WeakMap();

function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function pageRadiusForScreenRadius(screenRadius, renderedPageWidth, pageCoordinateWidth = 1000) {
  return Math.max(0, finite(screenRadius)) * (Math.max(1, finite(pageCoordinateWidth, 1000)) / Math.max(1, finite(renderedPageWidth, 1)));
}

function interpolatePoint(first, second, ratio) {
  const t = clamp(ratio, 0, 1);
  const numericKeys = ["p", "t", "tiltX", "tiltY", "altitudeAngle", "azimuthAngle", "twist", "tangentialPressure", "contactWidth", "contactHeight"];
  const point = {
    ...first,
    x: first.x + (second.x - first.x) * t,
    y: first.y + (second.y - first.y) * t
  };
  for (const key of numericKeys) {
    const start = Number(first[key]);
    const end = Number(second[key]);
    if (Number.isFinite(start) && Number.isFinite(end)) point[key] = start + (end - start) * t;
    else if (Number.isFinite(end)) point[key] = end;
  }
  point.pressureAvailable = Boolean(first.pressureAvailable || second.pressureAvailable);
  return point;
}

/** Returns an opaque value for normal ink and isolated transparency for media that intentionally needs it. */
export function strokeOpacity(annotation) {
  if (annotation?.type === "pen") return 1;
  if (annotation?.type === "highlighter") return clamp(finite(annotation.opacity, .34), .08, .6);
  if (annotation?.type === "pencil") return clamp(finite(annotation.opacity, .78), .18, 1);
  return clamp(finite(annotation?.opacity, 1), .05, 1);
}

export function strokeWidthAtPoint(annotation, point, context = {}) {
  const baseWidth = Math.max(.35, finite(annotation?.width, 4));
  const profile = annotation?.profile || (annotation?.type === "pencil" ? PEN_PROFILE.PENCIL : PEN_PROFILE.BALL);
  const config = PEN_PROFILE_CONFIG[profile] || PEN_PROFILE_CONFIG[PEN_PROFILE.BALL];
  const configuredSensitivity = clamp(finite(annotation?.pressureSensitivity, .55), 0, 1);
  const pressureAvailable = point?.pressureAvailable === true || (point?.pointer === "pen" && finite(point?.p) > 0);
  const pressure = pressureAvailable ? clamp(finite(point?.p, .5), .04, 1) : .5;
  const pressureFactor = 1 + (pressure - .5) * 2 * config.pressureStrength * configuredSensitivity;
  const previous = context.previous;
  const next = context.next;
  const duration = previous && next ? Math.max(1, finite(next.t) - finite(previous.t)) : 1;
  const velocity = previous && next ? (pointDistance(previous, point) + pointDistance(point, next)) / duration : 0;
  const velocityFactor = 1 - clamp(velocity / 2.2, 0, 1) * config.velocityStrength;
  const tilt = Math.min(90, Math.hypot(finite(point?.tiltX), finite(point?.tiltY)));
  const tiltFactor = 1 + (tilt / 90) * config.tiltStrength;
  const taper = strokeTaperFactor(config, baseWidth, context);
  return clamp(baseWidth * pressureFactor * velocityFactor * tiltFactor * taper, baseWidth * .22, baseWidth * 2.25);
}

/**
 * Taper is measured along the stroke in page units and capped relative to the
 * nib width. An index-fraction taper would keep re-scaling the whole stroke as
 * new samples arrive, which makes the already-drawn start visibly breathe while
 * the user is still writing. A capped arc-length taper stays put.
 */
export function strokeTaperLengths(config, baseWidth) {
  const nib = Math.max(.35, finite(baseWidth, 4));
  return {
    start: config.taperStart > 0 ? nib * config.taperStart * TAPER_NIB_SPAN : 0,
    end: config.taperEnd > 0 ? nib * config.taperEnd * TAPER_NIB_SPAN : 0
  };
}

function strokeTaperFactor(config, baseWidth, context) {
  if (config.taperStart <= 0 && config.taperEnd <= 0) return 1;
  const totalLength = Number(context.totalLength);
  if (Number.isFinite(totalLength) && totalLength > 0) {
    const spans = strokeTaperLengths(config, baseWidth);
    const fromStart = Math.max(0, finite(context.distanceFromStart, totalLength));
    const fromEnd = Math.max(0, finite(context.distanceFromEnd, totalLength));
    const startTaper = spans.start > 0 && fromStart < spans.start ? .34 + .66 * (fromStart / spans.start) : 1;
    const endTaper = spans.end > 0 && fromEnd < spans.end ? .3 + .7 * (fromEnd / spans.end) : 1;
    return Math.min(startTaper, endTaper);
  }
  // Legacy index-based context. Callers with no positional context at all get
  // the untapered nib so hit-testing and erasing never under-measure a stroke.
  const count = Number(context.count);
  if (!Number.isFinite(count) || count <= 1) return 1;
  const progress = clamp(finite(context.index) / Math.max(1, count - 1), 0, 1);
  const startTaper = config.taperStart > 0 && progress < config.taperStart
    ? .34 + .66 * (progress / config.taperStart)
    : 1;
  const endTaper = config.taperEnd > 0 && progress > 1 - config.taperEnd
    ? .3 + .7 * ((1 - progress) / config.taperEnd)
    : 1;
  return Math.min(startTaper, endTaper);
}

/**
 * Removes duplicate samples and applies a small velocity-aware centered filter.
 * Every original position remains represented, while the first and last real
 * samples stay exact so ink never catches up after pointer release.
 */
export function smoothStrokePoints(points, smoothing = .5) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? [...points] : [];
  const unique = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = unique[unique.length - 1];
    if (pointDistance(previous, point) > .025) unique.push(point);
  }
  if (unique.length < 3) return unique;
  const smoothed = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = unique[index - 1];
    const point = unique[index];
    const next = unique[index + 1];
    const duration = Math.max(1, finite(next.t, index + 1) - finite(previous.t, index - 1));
    const velocity = (pointDistance(previous, point) + pointDistance(point, next)) / duration;
    const strength = clamp(finite(smoothing, .5), 0, 1);
    const smoothingAmount = (.04 + strength * .1) + clamp(velocity / 2.4, 0, 1) * (.1 + strength * .2);
    const centerX = (previous.x + point.x * 2 + next.x) / 4;
    const centerY = (previous.y + point.y * 2 + next.y) / 4;
    smoothed.push({ ...point, x: point.x + (centerX - point.x) * smoothingAmount, y: point.y + (centerY - point.y) * smoothingAmount });
  }
  smoothed.push(unique[unique.length - 1]);
  return smoothed;
}

export function strokeCenterlinePath(points, smoothing = .5) {
  return strokeCenterlinePathRange(smoothStrokePoints(points, smoothing), 0);
}

/** Emits the smooth centerline for `[fromIndex, points.length)` from pre-smoothed samples. */
export function strokeCenterlinePathRange(source, fromIndex = 0) {
  if (!Array.isArray(source) || !source.length) return "";
  const start = Math.max(0, Math.min(fromIndex, source.length - 1));
  if (source.length === 1) return `M${format(source[0].x)} ${format(source[0].y)}`;
  let path = `M${format(source[start].x)} ${format(source[start].y)}`;
  for (let index = start; index < source.length - 1; index += 1) {
    const previous = source[Math.max(0, index - 1)];
    const from = source[index];
    const to = source[index + 1];
    const next = source[Math.min(source.length - 1, index + 2)];
    const duration = Math.max(1, finite(to.t, index + 1) - finite(from.t, index));
    const velocity = pointDistance(from, to) / duration;
    const tension = .11 + clamp(velocity / 2.4, 0, 1) * .055;
    const controlOne = { x: from.x + (to.x - previous.x) * tension, y: from.y + (to.y - previous.y) * tension };
    const controlTwo = { x: to.x - (next.x - from.x) * tension, y: to.y - (next.y - from.y) * tension };
    path += ` C${format(controlOne.x)} ${format(controlOne.y)} ${format(controlTwo.x)} ${format(controlTwo.y)} ${format(to.x)} ${format(to.y)}`;
  }
  return path;
}

function circlePath(point, radius) {
  const y = format(point.y);
  const r = format(Math.max(.01, radius));
  return `M${format(point.x + radius)} ${y} A${r} ${r} 0 1 0 ${format(point.x - radius)} ${y} A${r} ${r} 0 1 0 ${format(point.x + radius)} ${y} Z`;
}

/**
 * Builds one compound fill from overlapping variable-width quads and round
 * join discs. Each part is painted as a sub-path of the same element, so
 * opacity is applied once and a sharp turn cannot expose the page between
 * neighbouring samples.
 */
export function strokeProfileConfig(annotation) {
  const profile = annotation?.profile || (annotation?.type === "pencil" ? PEN_PROFILE.PENCIL : PEN_PROFILE.BALL);
  return PEN_PROFILE_CONFIG[profile] || PEN_PROFILE_CONFIG[PEN_PROFILE.BALL];
}

/** Cumulative arc length per point, reusing `target` so live frames allocate nothing. */
export function strokeCumulativeLengths(points, target = [], fromIndex = 0) {
  const source = Array.isArray(points) ? points : [];
  target.length = source.length;
  const start = Math.max(0, Math.min(fromIndex, source.length));
  if (!source.length) return target;
  if (start === 0) target[0] = 0;
  for (let index = Math.max(1, start); index < source.length; index += 1) {
    target[index] = target[index - 1] + pointDistance(source[index - 1], source[index]);
  }
  return target;
}

/**
 * Fills `target[index]` for every index in `[fromIndex, points.length)`.
 * Radii outside that range are already correct because the taper span is
 * measured in absolute page units rather than as a fraction of the sample count.
 */
export function strokeRadiiForPoints(annotation, points, cumulative, target = [], fromIndex = 0) {
  const source = Array.isArray(points) ? points : [];
  target.length = source.length;
  const totalLength = source.length ? cumulative[source.length - 1] : 0;
  for (let index = Math.max(0, fromIndex); index < source.length; index += 1) {
    const previous = source[Math.max(0, index - 1)];
    const next = source[Math.min(source.length - 1, index + 1)];
    target[index] = strokeWidthAtPoint(annotation, source[index], {
      previous,
      next,
      index,
      count: source.length,
      distanceFromStart: cumulative[index],
      distanceFromEnd: totalLength - cumulative[index],
      totalLength
    }) / 2;
  }
  return target;
}

/**
 * Emits the compound outline for `[fromIndex, points.length)`. Every part is a
 * sub-path of one fill with a consistent winding direction, so a sharp turn can
 * never expose the page between neighbouring samples.
 */
export function strokeOutlinePathRange(points, radii, fromIndex = 0) {
  const start = Math.max(0, fromIndex);
  if (!Array.isArray(points) || points.length < 2 || start >= points.length) return "";
  let path = "";
  for (let index = Math.max(1, start); index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(.001, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    const startRadius = radii[index - 1];
    const endRadius = radii[index];
    path += `M${format(from.x + normalX * startRadius)} ${format(from.y + normalY * startRadius)}`;
    path += ` L${format(to.x + normalX * endRadius)} ${format(to.y + normalY * endRadius)}`;
    path += ` L${format(to.x - normalX * endRadius)} ${format(to.y - normalY * endRadius)}`;
    path += ` L${format(from.x - normalX * startRadius)} ${format(from.y - normalY * startRadius)} Z`;
  }
  for (let index = start; index < points.length; index += 1) path += circlePath(points[index], radii[index]);
  return path;
}

export function strokeOutlinePath(annotation) {
  const config = strokeProfileConfig(annotation);
  const points = smoothStrokePoints(annotation?.points || [], finite(annotation?.smoothing, config.smoothing));
  if (points.length < 2) return "";
  const cumulative = strokeCumulativeLengths(points);
  const radii = strokeRadiiForPoints(annotation, points, cumulative);
  return strokeOutlinePathRange(points, radii, 0);
}

function geometryCacheKey(annotation) {
  const points = annotation?.points || [];
  const last = points.at(-1) || {};
  return [
    points.length,
    format(last.x),
    format(last.y),
    format(last.p),
    annotation?.type,
    annotation?.profile,
    format(annotation?.width),
    format(annotation?.opacity),
    format(annotation?.pressureSensitivity),
    format(annotation?.smoothing)
  ].join(":");
}

/** @returns {StrokeGeometry} */
export function strokeRenderGeometry(annotation) {
  const cacheKey = geometryCacheKey(annotation);
  const cached = annotation && typeof annotation === "object" ? strokeGeometryCache.get(annotation) : null;
  if (cached?.key === cacheKey) return cached.geometry;
  const points = annotation?.points || [];
  const opacity = strokeOpacity(annotation);
  const profile = annotation?.profile || (annotation?.type === "pencil" ? PEN_PROFILE.PENCIL : PEN_PROFILE.BALL);
  const config = PEN_PROFILE_CONFIG[profile] || PEN_PROFILE_CONFIG[PEN_PROFILE.BALL];
  const smoothing = finite(annotation?.smoothing, config.smoothing);
  if (!points.length) return { kind: "empty", opacity, composite: "source-over" };
  if (points.length === 1) {
    /** @type {StrokeGeometry} */
    const geometry = {
      kind: "dot",
      x: points[0].x,
      y: points[0].y,
      radius: strokeWidthAtPoint(annotation, points[0]) / 2,
      opacity,
      composite: annotation.type === "highlighter" ? "multiply" : "source-over"
    };
    if (annotation && typeof annotation === "object") strokeGeometryCache.set(annotation, { key: cacheKey, geometry });
    return geometry;
  }
  if (annotation.type === "highlighter") {
    /** @type {StrokeGeometry} */
    const geometry = { kind: "centerline", path: strokeCenterlinePath(points, smoothing), width: Math.max(.5, finite(annotation.width, 4)), opacity, composite: "multiply" };
    if (annotation && typeof annotation === "object") strokeGeometryCache.set(annotation, { key: cacheKey, geometry });
    return geometry;
  }
  /** @type {StrokeGeometry} */
  const geometry = {
    kind: "outline",
    path: strokeOutlinePath(annotation),
    opacity,
    composite: "source-over"
  };
  if (annotation && typeof annotation === "object") strokeGeometryCache.set(annotation, { key: cacheKey, geometry });
  return geometry;
}

export function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) return pointDistance(point, start);
  const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
}

function orientation(first, second, third) {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function pointOnSegment(point, start, end) {
  return point.x >= Math.min(start.x, end.x) - .0001
    && point.x <= Math.max(start.x, end.x) + .0001
    && point.y >= Math.min(start.y, end.y) - .0001
    && point.y <= Math.max(start.y, end.y) + .0001;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const o1 = orientation(firstStart, firstEnd, secondStart);
  const o2 = orientation(firstStart, firstEnd, secondEnd);
  const o3 = orientation(secondStart, secondEnd, firstStart);
  const o4 = orientation(secondStart, secondEnd, firstEnd);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  if (Math.abs(o1) <= .0001 && pointOnSegment(secondStart, firstStart, firstEnd)) return true;
  if (Math.abs(o2) <= .0001 && pointOnSegment(secondEnd, firstStart, firstEnd)) return true;
  if (Math.abs(o3) <= .0001 && pointOnSegment(firstStart, secondStart, secondEnd)) return true;
  if (Math.abs(o4) <= .0001 && pointOnSegment(firstEnd, secondStart, secondEnd)) return true;
  return false;
}

export function distanceBetweenSegments(firstStart, firstEnd, secondStart, secondEnd) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    distancePointToSegment(firstStart, secondStart, secondEnd),
    distancePointToSegment(firstEnd, secondStart, secondEnd),
    distancePointToSegment(secondStart, firstStart, firstEnd),
    distancePointToSegment(secondEnd, firstStart, firstEnd)
  );
}

export function strokeIntersectsEraserPath(annotation, eraserStart, eraserEnd, radius) {
  const points = annotation?.points || [];
  if (!points.length) return false;
  if (points.length === 1) return distancePointToSegment(points[0], eraserStart, eraserEnd) <= radius + strokeWidthAtPoint(annotation, points[0]) / 2;
  for (let index = 1; index < points.length; index += 1) {
    const strokeRadius = Math.max(strokeWidthAtPoint(annotation, points[index - 1]), strokeWidthAtPoint(annotation, points[index])) / 2;
    if (distanceBetweenSegments(points[index - 1], points[index], eraserStart, eraserEnd) <= radius + strokeRadius) return true;
  }
  return false;
}

export function strokeIntersectsEraserPolyline(annotation, eraserPoints, radius) {
  const path = Array.isArray(eraserPoints) ? eraserPoints : [];
  if (!path.length) return false;
  return strokeIntersectsEraserIndex(annotation, createEraserPathIndex(path, radius), radius);
}

/**
 * Measures how meaningfully a scribble covers a stroke. A single incidental
 * crossing of a long stroke has low coverage and one intersection run, while
 * repeated scratching or following the stroke produces a stronger signal.
 */
export function strokeEraseCoverage(annotation, eraserPoints, radius) {
  const sourcePoints = annotation?.points || [];
  const path = eraserPoints || [];
  if (!sourcePoints.length || path.length < 2) return { intersects: false, coverage: 0, intersectionRatio: 0, intersectionRuns: 0, touchedSegments: 0 };
  if (sourcePoints.length === 1) {
    const intersects = path.some((end, index) => index > 0 && strokeIntersectsEraserPath(annotation, path[index - 1], end, radius));
    return { intersects, coverage: intersects ? 1 : 0, intersectionRatio: intersects ? 1 : 0, intersectionRuns: intersects ? 1 : 0, touchedSegments: intersects ? 1 : 0 };
  }
  const points = densifyStroke(sourcePoints, Math.max(1, radius * .65));
  let totalLength = 0;
  let touchedLength = 0;
  let touchedSegments = 0;
  const touchedEraserSegments = new Set();
  for (let strokeIndex = 1; strokeIndex < points.length; strokeIndex += 1) {
    const start = points[strokeIndex - 1];
    const end = points[strokeIndex];
    const length = pointDistance(start, end);
    totalLength += length;
    const strokeRadius = Math.max(strokeWidthAtPoint(annotation, start), strokeWidthAtPoint(annotation, end)) / 2;
    let touched = false;
    for (let eraserIndex = 1; eraserIndex < path.length; eraserIndex += 1) {
      if (distanceBetweenSegments(start, end, path[eraserIndex - 1], path[eraserIndex]) <= radius + strokeRadius) {
        touched = true;
        touchedEraserSegments.add(eraserIndex);
      }
    }
    if (touched) {
      touchedSegments += 1;
      touchedLength += length;
    }
  }
  let intersectionRuns = 0;
  let previousTouched = false;
  for (let index = 1; index < path.length; index += 1) {
    const touched = touchedEraserSegments.has(index);
    if (touched && !previousTouched) intersectionRuns += 1;
    previousTouched = touched;
  }
  return {
    intersects: touchedSegments > 0,
    coverage: totalLength > .001 ? touchedLength / totalLength : 0,
    intersectionRatio: touchedEraserSegments.size / Math.max(1, path.length - 1),
    intersectionRuns,
    touchedSegments
  };
}

function createEraserPathIndex(path, radius) {
  const cellSize = Math.max(10, radius * 2.5);
  const segments = path.length === 1
    ? [{ start: path[0], end: path[0] }]
    : path.slice(1).map((end, index) => ({ start: path[index], end }));
  const cells = new Map();
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const startX = Math.floor(Math.min(segment.start.x, segment.end.x) / cellSize);
    const endX = Math.floor(Math.max(segment.start.x, segment.end.x) / cellSize);
    const startY = Math.floor(Math.min(segment.start.y, segment.end.y) / cellSize);
    const endY = Math.floor(Math.max(segment.start.y, segment.end.y) / cellSize);
    for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
      const key = `${x}:${y}`;
      const items = cells.get(key) || [];
      items.push(segmentIndex);
      cells.set(key, items);
    }
  }
  return { cellSize, segments, cells, visitMarks: new Uint32Array(segments.length), visitToken: 0 };
}

function someEraserSegmentNear(index, bounds, padding, predicate) {
  index.visitToken += 1;
  if (index.visitToken >= 0xfffffff0) {
    index.visitMarks.fill(0);
    index.visitToken = 1;
  }
  const token = index.visitToken;
  const startX = Math.floor((bounds.x - padding) / index.cellSize);
  const endX = Math.floor((bounds.x + bounds.width + padding) / index.cellSize);
  const startY = Math.floor((bounds.y - padding) / index.cellSize);
  const endY = Math.floor((bounds.y + bounds.height + padding) / index.cellSize);
  for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
    for (const segmentIndex of index.cells.get(`${x}:${y}`) || []) {
      if (index.visitMarks[segmentIndex] === token) continue;
      index.visitMarks[segmentIndex] = token;
      if (predicate(index.segments[segmentIndex])) return true;
    }
  }
  return false;
}

function pointTouchesEraserPath(point, eraserIndex, threshold) {
  return someEraserSegmentNear(
    eraserIndex,
    { x: point.x, y: point.y, width: 0, height: 0 },
    threshold,
    (segment) => distancePointToSegment(point, segment.start, segment.end) <= threshold
  );
}

function strokeIntersectsEraserIndex(annotation, eraserIndex, radius) {
  const points = annotation?.points || [];
  if (!points.length || !eraserIndex.segments.length) return false;
  if (points.length === 1) return pointTouchesEraserPath(points[0], eraserIndex, radius + strokeWidthAtPoint(annotation, points[0]) / 2);
  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    const threshold = radius + Math.max(strokeWidthAtPoint(annotation, start), strokeWidthAtPoint(annotation, end)) / 2;
    if (someEraserSegmentNear(eraserIndex, {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    }, threshold, (segment) => distanceBetweenSegments(start, end, segment.start, segment.end) <= threshold)) return true;
  }
  return false;
}

function boundaryPoint(annotation, outside, inside, eraserIndex, radius) {
  let low = outside;
  let high = inside;
  for (let index = 0; index < 8; index += 1) {
    const midpoint = interpolatePoint(low, high, .5);
    const erased = pointTouchesEraserPath(midpoint, eraserIndex, radius + strokeWidthAtPoint(annotation, midpoint) / 2);
    if (erased) high = midpoint;
    else low = midpoint;
  }
  return interpolatePoint(low, high, .5);
}

function densifyStroke(points, maximumStep) {
  if (points.length < 2) return [...points];
  const dense = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const steps = Math.min(64, Math.max(1, Math.ceil(pointDistance(start, end) / maximumStep)));
    for (let step = 1; step <= steps; step += 1) dense.push(interpolatePoint(start, end, step / steps));
  }
  return dense;
}

function fragmentsOutsidePrecisionPath(annotation, eraserIndex, radius) {
  const dense = densifyStroke(annotation.points || [], Math.max(.8, Math.min(3, radius * .42)));
  const outside = (point) => !pointTouchesEraserPath(point, eraserIndex, radius + strokeWidthAtPoint(annotation, point) / 2);
  const fragments = [];
  let current = [];
  for (let index = 0; index < dense.length; index += 1) {
    const point = dense[index];
    const isOutside = outside(point);
    const previous = dense[index - 1];
    const previousOutside = previous ? outside(previous) : isOutside;
    if (isOutside) {
      if (previous && !previousOutside) current.push(boundaryPoint(annotation, point, previous, eraserIndex, radius));
      current.push(point);
    } else if (previous && previousOutside && current.length) {
      current.push(boundaryPoint(annotation, previous, point, eraserIndex, radius));
      if (current.length >= 2) fragments.push(current);
      current = [];
    }
  }
  if (current.length >= 2) fragments.push(current);
  return fragments;
}

function fragmentsOutsideTouchedSegments(annotation, eraserIndex, radius) {
  const points = annotation.points || [];
  if (points.length < 2) return strokeIntersectsEraserIndex(annotation, eraserIndex, radius) ? [] : [points];
  const fragments = [];
  let current = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const strokeRadius = Math.max(strokeWidthAtPoint(annotation, start), strokeWidthAtPoint(annotation, end)) / 2;
    const threshold = radius + strokeRadius;
    const touched = someEraserSegmentNear(eraserIndex, {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    }, threshold, (segment) => distanceBetweenSegments(start, end, segment.start, segment.end) <= threshold);
    if (touched) {
      if (current.length >= 2) fragments.push(current);
      current = [end];
    } else current.push(end);
  }
  if (current.length >= 2) fragments.push(current);
  return fragments;
}

/**
 * Clips one editable vector stroke against the swept circular eraser path.
 * It returns replacement strokes so undo can restore the exact original.
 */
export function eraseStrokeWithPath(annotation, eraserStart, eraserEnd, radius, mode = String(ERASER_MODE.PRECISION), idFactory = () => `${annotation.id}-split`) {
  return eraseStrokeWithPolyline(annotation, [eraserStart, eraserEnd], radius, mode, idFactory);
}

/**
 * Clips a stroke against a complete eraser drag in one pass. Recomputing from
 * the immutable source prevents fragment point counts from growing on every
 * pointer sample and keeps precision, segment, and stroke modes deterministic.
 */
export function eraseStrokeWithPolyline(annotation, eraserPoints, radius, mode = String(ERASER_MODE.PRECISION), idFactory = () => `${annotation.id}-split`) {
  if (!annotation || !["pen", "pencil", "highlighter"].includes(annotation.type)) return { changed: false, fragments: [annotation] };
  const path = Array.isArray(eraserPoints) ? eraserPoints.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y)) : [];
  if (!path.length) return { changed: false, fragments: [annotation] };
  const eraserIndex = createEraserPathIndex(path, radius);
  if (!strokeIntersectsEraserIndex(annotation, eraserIndex, radius)) return { changed: false, fragments: [annotation] };
  if (mode === ERASER_MODE.STROKE) return { changed: true, fragments: [] };
  const pointFragments = mode === ERASER_MODE.SEGMENT
    ? fragmentsOutsideTouchedSegments(annotation, eraserIndex, radius)
    : fragmentsOutsidePrecisionPath(annotation, eraserIndex, radius);
  const minimumFragmentLength = Math.max(1.5, radius * .35);
  const retainedFragments = pointFragments.filter((points) => {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) length += pointDistance(points[index - 1], points[index]);
    return points.length >= 2 && length >= minimumFragmentLength;
  });
  const fragments = retainedFragments.map((points, index) => ({
    ...annotation,
    id: index === 0 ? annotation.id : idFactory(),
    points: simplifyStrokePoints(points, Math.max(.45, Math.min(1.25, radius * .12)))
  })).filter((fragment) => fragment.points.length >= 2);
  return { changed: true, fragments };
}

/**
 * Keeps the visual contour while dropping near-duplicate raw pointer samples
 * after a stroke ends. Active drawing always receives the unmodified stream.
 */
export function simplifyStrokePoints(points, minimumDistance = 1.15) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? [...points] : [];
  const retained = [points[0]];
  const thresholdSquared = Math.max(.01, Number(minimumDistance) || 1) ** 2;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const previous = retained[retained.length - 1];
    const next = points[index + 1];
    const distanceSquared = (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2;
    const directionChange = Math.abs((point.x - previous.x) * (next.y - point.y) - (point.y - previous.y) * (next.x - point.x));
    if (distanceSquared >= thresholdSquared || directionChange >= minimumDistance * 1.5) retained.push(point);
  }
  retained.push(points[points.length - 1]);
  return retained;
}

/**
 * Builds a page-local grid for legacy canvas strokes. Erasing then inspects
 * only the cells around the pointer instead of every point in every stroke.
 */
export function createStrokeSpatialIndex(strokes, cellSize = 96, canvasWidth = 1, canvasHeight = 1) {
  const size = Math.max(24, Number(cellSize) || 96);
  const cells = new Map();
  for (let strokeIndex = 0; strokeIndex < (strokes || []).length; strokeIndex += 1) {
    const stroke = strokes[strokeIndex];
    const sourcePoints = stroke?.points || [];
    const points = stroke?.normalized
      ? sourcePoints.map((point) => ({ ...point, x: point.x * canvasWidth, y: point.y * canvasHeight }))
      : sourcePoints;
    if (!points.length) continue;
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const startX = Math.floor(minX / size);
    const endX = Math.floor(maxX / size);
    const startY = Math.floor(minY / size);
    const endY = Math.floor(maxY / size);
    for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
      const key = `${x}:${y}`;
      const indices = cells.get(key) || [];
      indices.push(strokeIndex);
      cells.set(key, indices);
    }
  }
  return { cellSize: size, cells };
}

export function queryStrokeSpatialIndex(index, point, radius = 0) {
  const size = Math.max(24, Number(index?.cellSize) || 96);
  const cells = index?.cells;
  if (!cells) return [];
  const candidates = new Set();
  const startX = Math.floor((point.x - radius) / size);
  const endX = Math.floor((point.x + radius) / size);
  const startY = Math.floor((point.y - radius) / size);
  const endY = Math.floor((point.y + radius) / size);
  for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
    for (const strokeIndex of cells.get(`${x}:${y}`) || []) candidates.add(strokeIndex);
  }
  return [...candidates].sort((first, second) => second - first);
}

export function strokeSampleForServer(point, canvasWidth, canvasHeight) {
  const x = Math.min(1, Math.max(0, Number(point.x) / Math.max(Number(canvasWidth) || 0, 1)));
  const y = Math.min(1, Math.max(0, Number(point.y) / Math.max(Number(canvasHeight) || 0, 1)));
  return {
    x: Number(x.toFixed(6)),
    y: Number(y.toFixed(6)),
    pointer: ["pen", "touch", "mouse", "unknown"].includes(point.pointer) ? point.pointer : "unknown",
    pressure: Math.min(1, Math.max(0, Number(point.p ?? point.pressure) || 0)),
    tiltX: Math.min(90, Math.max(-90, Number(point.tiltX) || 0)),
    tiltY: Math.min(90, Math.max(-90, Number(point.tiltY) || 0)),
    timestamp: Math.max(0, Number(point.t ?? point.timestamp) || Date.now())
  };
}
