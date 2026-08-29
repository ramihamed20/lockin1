/**
 * @typedef {{kind:"line"|"ellipse"|"rectangle"|string, confidence?:number, start?:{x:number,y:number}, end?:{x:number,y:number}, [key:string]:unknown}} GestureResult
 */

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(first, second) {
  return Math.hypot(finite(second?.x) - finite(first?.x), finite(second?.y) - finite(first?.y));
}

function cross(first, second, third) {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function orientation(first, second, third) {
  const value = cross(first, second, third);
  return Math.abs(value) < .001 ? 0 : Math.sign(value);
}

function onSegment(point, start, end) {
  return point.x >= Math.min(start.x, end.x) - .001
    && point.x <= Math.max(start.x, end.x) + .001
    && point.y >= Math.min(start.y, end.y) - .001
    && point.y <= Math.max(start.y, end.y) + .001;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
  if (firstOrientation !== secondOrientation && thirdOrientation !== fourthOrientation) return true;
  if (firstOrientation === 0 && onSegment(secondStart, firstStart, firstEnd)) return true;
  if (secondOrientation === 0 && onSegment(secondEnd, firstStart, firstEnd)) return true;
  if (thirdOrientation === 0 && onSegment(firstStart, secondStart, secondEnd)) return true;
  return fourthOrientation === 0 && onSegment(firstEnd, secondStart, secondEnd);
}

export function gestureBounds(points) {
  const source = Array.isArray(points) ? points : [];
  if (!source.length) return null;
  let minX = finite(source[0].x);
  let maxX = minX;
  let minY = finite(source[0].y);
  let maxY = minY;
  for (let index = 1; index < source.length; index += 1) {
    minX = Math.min(minX, finite(source[index].x));
    maxX = Math.max(maxX, finite(source[index].x));
    minY = Math.min(minY, finite(source[index].y));
    maxY = Math.max(maxY, finite(source[index].y));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pathLength(points) {
  let length = 0;
  for (let index = 1; index < (points || []).length; index += 1) length += distance(points[index - 1], points[index]);
  return length;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function distanceToLine(point, start, end) {
  const lineLength = Math.max(.001, distance(start, end));
  return Math.abs(cross(start, end, point)) / lineLength;
}

function selfIntersectionCount(points) {
  if (points.length < 6) return 0;
  const stride = Math.max(1, Math.ceil(points.length / 120));
  const sampled = points.filter((_, index) => index % stride === 0 || index === points.length - 1);
  let intersections = 0;
  for (let first = 1; first < sampled.length; first += 1) {
    for (let second = first + 3; second < sampled.length; second += 1) {
      if (first === 1 && second === sampled.length - 1) continue;
      if (segmentsIntersect(sampled[first - 1], sampled[first], sampled[second - 1], sampled[second])) intersections += 1;
      if (intersections >= 20) return intersections;
    }
  }
  return intersections;
}

function directionChangeCount(points) {
  let changes = 0;
  let previousAngle = null;
  for (let index = 2; index < points.length; index += 2) {
    const previous = points[index - 2];
    const current = points[index];
    if (distance(previous, current) < 2) continue;
    const angle = Math.atan2(current.y - previous.y, current.x - previous.x);
    if (previousAngle !== null) {
      let delta = Math.abs(angle - previousAngle);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta > Math.PI * .42) changes += 1;
    }
    previousAngle = angle;
  }
  return changes;
}

/** Conservative multi-signal recognizer. It never mutates ink by itself. */
export function analyzeScribbleGesture(points) {
  const source = Array.isArray(points) ? points : [];
  const bounds = gestureBounds(source);
  if (!bounds || source.length < 14) return { recognized: false, confidence: 0, bounds, signals: {} };
  const length = pathLength(source);
  const diagonal = Math.max(1, Math.hypot(bounds.width, bounds.height));
  const direct = distance(source[0], source[source.length - 1]);
  const changes = directionChangeCount(source);
  const intersections = selfIntersectionCount(source);
  const density = length / diagonal;
  const compactness = direct / Math.max(1, length);
  const scores = {
    length: clamp((length - 150) / 260),
    density: clamp((density - 4.2) / 5.2),
    directionChanges: clamp((changes - 4) / 8),
    intersections: clamp((intersections - 2) / 7),
    compactness: clamp((.24 - compactness) / .19),
    area: clamp((bounds.width * bounds.height - 500) / 5_000)
  };
  const confidence = scores.length * .12
    + scores.density * .22
    + scores.directionChanges * .24
    + scores.intersections * .27
    + scores.compactness * .1
    + scores.area * .05;
  const recognized = confidence >= .68
    && changes >= 7
    && intersections >= 3
    && density >= 5.2
    && Math.min(bounds.width, bounds.height) >= 10;
  return { recognized, confidence, bounds, signals: { length, diagonal, direct, density, changes, intersections, compactness } };
}

export function analyzeClosedGesture(points, { unitsPerCssPixel = 1 } = {}) {
  const source = Array.isArray(points) ? points : [];
  const bounds = gestureBounds(source);
  if (!bounds || source.length < 8) return { recognized: false, confidence: 0, bounds };
  const unit = Math.max(.01, finite(unitsPerCssPixel, 1));
  const diagonal = Math.max(1, Math.hypot(bounds.width, bounds.height));
  const length = pathLength(source);
  const closure = distance(source[0], source[source.length - 1]);
  const area = polygonArea(source);
  const circularity = clamp((4 * Math.PI * area) / Math.max(1, length * length));
  const closureScore = clamp(1 - closure / Math.max(14 * unit, diagonal * .28));
  const areaScore = clamp(area / Math.max(1, bounds.width * bounds.height) / .72);
  const confidence = closureScore * .48 + circularity * .34 + areaScore * .18;
  const recognized = closure <= Math.max(22 * unit, diagonal * .24)
    && area >= 180 * unit * unit
    && Math.min(bounds.width, bounds.height) >= 12 * unit
    && confidence >= .58;
  return { recognized, confidence, bounds, circularity, area, closure, length };
}

function simplifyRdp(points, tolerance) {
  if (points.length <= 2) return [...points];
  let maximumDistance = 0;
  let splitIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const currentDistance = distanceToLine(points[index], points[0], points[points.length - 1]);
    if (currentDistance > maximumDistance) {
      maximumDistance = currentDistance;
      splitIndex = index;
    }
  }
  if (maximumDistance <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplifyRdp(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyRdp(points.slice(splitIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function polygonCorners(points, diagonal, unitsPerCssPixel = 1) {
  const minimumStep = Math.max(1.5 * unitsPerCssPixel, diagonal * .018);
  const sampled = [];
  for (const point of points) {
    if (!sampled.length || distance(sampled[sampled.length - 1], point) >= minimumStep) sampled.push(point);
  }
  if (sampled.length > 2 && distance(sampled[0], sampled.at(-1)) < minimumStep) sampled.pop();
  const corners = [];
  for (let index = 0; index < sampled.length; index += 1) {
    const previous = sampled[(index - 1 + sampled.length) % sampled.length];
    const point = sampled[index];
    const next = sampled[(index + 1) % sampled.length];
    const incoming = Math.atan2(point.y - previous.y, point.x - previous.x);
    const outgoing = Math.atan2(next.y - point.y, next.x - point.x);
    let turn = Math.abs(outgoing - incoming);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    if (turn >= Math.PI * .24) corners.push(point);
  }
  return corners;
}

function fittedLine(points) {
  const start = points[0];
  const end = points[points.length - 1];
  const direct = distance(start, end);
  const length = pathLength(points);
  let maximumDeviation = 0;
  for (const point of points) maximumDeviation = Math.max(maximumDeviation, distanceToLine(point, start, end));
  const confidence = clamp((direct / Math.max(1, length) - .82) / .17) * .55
    + clamp(1 - maximumDeviation / Math.max(5, direct * .075)) * .45;
  return { start, end, direct, length, maximumDeviation, confidence };
}

function recognizeArrow(points, unitsPerCssPixel = 1) {
  if (points.length < 8) return null;
  const start = points[0];
  let tipIndex = 1;
  let shaftLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const candidate = distance(start, points[index]);
    if (candidate > shaftLength) {
      shaftLength = candidate;
      tipIndex = index;
    }
  }
  if (tipIndex < Math.floor(points.length * .48) || tipIndex > points.length - 3 || shaftLength < 30 * unitsPerCssPixel) return null;
  const shaft = fittedLine(points.slice(0, tipIndex + 1));
  if (shaft.confidence < .73) return null;
  const tip = points[tipIndex];
  const head = points.slice(tipIndex + 1);
  const headDistances = head.map((point) => distance(tip, point));
  const maximumHead = Math.max(...headDistances);
  const returnsToTip = head.slice(0, -1).some((point) => distance(tip, point) <= Math.max(6, maximumHead * .3));
  const finalHead = headDistances.at(-1);
  if (!returnsToTip || maximumHead < shaftLength * .07 || maximumHead > shaftLength * .48 || finalHead < shaftLength * .07) return null;
  return { kind: "arrow", confidence: Math.min(.96, shaft.confidence * .8 + .18), start, end: tip };
}

/** Returns a vector shape proposal for draw-and-hold, or null when confidence is low. */
export function recognizeHeldStroke(points, { unitsPerCssPixel = 1 } = {}) {
  const source = Array.isArray(points) ? points : [];
  if (source.length < 3) return null;
  const unit = Math.max(.01, finite(unitsPerCssPixel, 1));
  const arrow = recognizeArrow(source, unit);
  if (arrow) return arrow;
  const line = fittedLine(source);
  if (line.direct >= 24 * unit && line.confidence >= .7 && line.maximumDeviation <= Math.max(8 * unit, line.direct * .1)) {
    return { kind: "line", confidence: line.confidence, start: line.start, end: line.end };
  }
  const closed = analyzeClosedGesture(source, { unitsPerCssPixel: unit });
  if (!closed.recognized) return null;
  const { bounds } = closed;
  const diagonal = Math.max(1, Math.hypot(bounds.width, bounds.height));
  const detectedCorners = polygonCorners(source, diagonal, unit);
  const closedPoints = distance(source[0], source[source.length - 1]) > 1 ? [...source, source[0]] : source;
  const simplifiedCorners = simplifyRdp(closedPoints, diagonal * .055).slice(0, -1);
  const corners = detectedCorners.length >= 3 && detectedCorners.length <= 5 ? detectedCorners : simplifiedCorners;
  const fillRatio = closed.area / Math.max(1, bounds.width * bounds.height);
  if (corners.length === 3 && fillRatio >= .34 && fillRatio <= .68) {
    return { kind: "triangle", confidence: Math.min(.96, closed.confidence + .08), bounds };
  }
  if (corners.length === 4 && fillRatio >= .68) {
    const squareRatio = Math.min(bounds.width, bounds.height) / Math.max(1, Math.max(bounds.width, bounds.height));
    return { kind: squareRatio >= .86 ? "square" : "rectangle", confidence: Math.min(.96, closed.confidence + .08), bounds };
  }
  if (closed.circularity >= .46) {
    const circleRatio = Math.min(bounds.width, bounds.height) / Math.max(1, Math.max(bounds.width, bounds.height));
    return { kind: circleRatio >= .84 ? "circle" : "ellipse", confidence: closed.confidence, bounds };
  }
  return null;
}

export function recognizedShapeAnnotation(stroke, recognition) {
  if (!stroke || !recognition) return null;
  if (["line", "arrow"].includes(recognition.kind)) {
    return { ...stroke, type: "shape", shape: recognition.kind, start: recognition.start, end: recognition.end, points: undefined, rawStroke: undefined };
  }
  const bounds = recognition.bounds;
  if (!bounds) return null;
  return {
    ...stroke,
    type: "shape",
    shape: recognition.kind,
    start: { ...stroke.points[0], x: bounds.x, y: bounds.y },
    end: { ...stroke.points[stroke.points.length - 1], x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    points: undefined,
    rawStroke: undefined
  };
}

export function rectangleLassoPolygon(start, end) {
  return [
    { ...start, x: start.x, y: start.y },
    { ...start, x: end.x, y: start.y },
    { ...end, x: end.x, y: end.y },
    { ...end, x: start.x, y: end.y }
  ];
}
