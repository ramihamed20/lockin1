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
  const directionX = (end.x - start.x) / Math.max(1, direct);
  const directionY = (end.y - start.y) / Math.max(1, direct);
  let backwardTravel = 0;
  for (let index = 1; index < points.length; index += 1) {
    const progress = (points[index].x - points[index - 1].x) * directionX
      + (points[index].y - points[index - 1].y) * directionY;
    if (progress < 0) backwardTravel -= progress;
  }
  const confidence = clamp((direct / Math.max(1, length) - .68) / .27) * .55
    + clamp(1 - maximumDeviation / Math.max(7, direct * .13)) * .45;
  return { start, end, direct, length, maximumDeviation, backwardTravel, confidence };
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

const LINE_MIN_LENGTH_PX = 40;

/** Evenly spaced samples along the path, so sample density cannot weigh the fit. */
function resampleByDistance(points, spacing) {
  const resampled = [points[0]];
  let carried = 0;
  for (let index = 1; index < points.length; index += 1) {
    let from = points[index - 1];
    const to = points[index];
    let segment = distance(from, to);
    while (carried + segment >= spacing && segment > 0) {
      const ratio = (spacing - carried) / segment;
      const next = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
      resampled.push(next);
      from = next;
      segment = distance(from, to);
      carried = 0;
    }
    carried += segment;
  }
  const last = points[points.length - 1];
  if (distance(resampled[resampled.length - 1], last) > spacing * .25 || resampled.length === 1) resampled.push(last);
  else resampled[resampled.length - 1] = last;
  return resampled;
}

/** A light moving average that removes hand tremor but keeps the endpoints. */
function smoothPolyline(points, passes = 2) {
  let current = points;
  for (let pass = 0; pass < passes && current.length > 2; pass += 1) {
    const next = [current[0]];
    for (let index = 1; index < current.length - 1; index += 1) {
      next.push({
        x: (current[index - 1].x + current[index].x * 2 + current[index + 1].x) / 4,
        y: (current[index - 1].y + current[index].y * 2 + current[index + 1].y) / 4
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)))];
}

/**
 * Decides whether a freehand stroke was meant as one straight line.
 *
 * The test is geometric intent rather than a near-perfect raw trace: the
 * stroke is measured in screen pixels (so zoom and the non-square page space
 * do not skew it), resampled and lightly smoothed to discount tremor, and then
 * fitted with a principal-axis (PCA) line. It is a line when it travels mostly
 * one way along that axis, stays within a band that grows with its length, and
 * does not bow consistently to one side the way an intended curve does.
 *
 * @param {{x:number,y:number}[]} points Page-space samples.
 * @param {{ unitsPerCssPixel?: number, aspect?: number }} [options] `aspect` is
 *   the rendered page height divided by its width.
 */
export function analyzeLineIntent(points, { unitsPerCssPixel = 1, aspect = 1 } = {}) {
  const source = (Array.isArray(points) ? points : []).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  const rejected = (reason, signals = {}) => ({ recognized: false, confidence: 0, reason, signals });
  if (source.length < 2) return rejected("too-few-points");
  const unit = Math.max(.01, finite(unitsPerCssPixel, 1));
  const yScale = Math.max(.05, finite(aspect, 1));
  const screen = source.map((point) => ({ x: point.x / unit, y: (point.y * yScale) / unit }));
  const first = screen[0];
  const last = screen[screen.length - 1];
  const direct = distance(first, last);
  if (direct < LINE_MIN_LENGTH_PX) return rejected("too-short", { direct });

  const path = smoothPolyline(resampleByDistance(screen, clamp(direct / 40, 2.5, 8)));
  const smoothedLength = pathLength(path);
  let meanX = 0;
  let meanY = 0;
  for (const point of path) { meanX += point.x; meanY += point.y; }
  meanX /= path.length;
  meanY /= path.length;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of path) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const angle = .5 * Math.atan2(2 * xy, xx - yy);
  let axisX = Math.cos(angle);
  let axisY = Math.sin(angle);
  if ((last.x - first.x) * axisX + (last.y - first.y) * axisY < 0) { axisX = -axisX; axisY = -axisY; }

  const offsets = [];
  const progress = [];
  for (const point of path) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    offsets.push(Math.abs(dx * axisY - dy * axisX));
    progress.push(dx * axisX + dy * axisY);
  }
  let backward = 0;
  for (let index = 1; index < progress.length; index += 1) backward += Math.max(0, progress[index - 1] - progress[index]);
  const span = Math.max(...progress) - Math.min(...progress);
  const endSpan = progress[progress.length - 1] - progress[0];
  const rms = Math.sqrt(offsets.reduce((total, offset) => total + offset * offset, 0) / offsets.length);
  const p90 = percentile(offsets, .9);
  const maximum = Math.max(...offsets);

  // A deliberate curve bows to one side of its chord; a wobbly line crosses it.
  let chordSigned = 0;
  let chordAbsolute = 0;
  let sagitta = 0;
  for (const point of path) {
    const signed = cross(first, last, point) / Math.max(1, direct);
    chordSigned += signed;
    chordAbsolute += Math.abs(signed);
    sagitta = Math.max(sagitta, Math.abs(signed));
  }
  const oneSided = chordAbsolute > 0 ? Math.abs(chordSigned) / chordAbsolute : 0;

  const signals = { direct, straightness: direct / Math.max(1, smoothedLength), rms, p90, maximum, backward, span, endSpan, sagitta, oneSided };
  const limits = {
    rms: Math.max(2.5, direct * .05),
    p90: Math.max(5, direct * .085),
    maximum: Math.max(9, direct * .15),
    backward: 2 + direct * .08,
    sagitta: Math.max(8, direct * .1)
  };
  if (signals.straightness < .86) return rejected("path-too-long", signals);
  if (backward > limits.backward || endSpan < span * .9) return rejected("reverses", signals);
  if (rms > limits.rms || p90 > limits.p90 || maximum > limits.maximum) return rejected("too-wide", signals);
  if (oneSided >= .75 && sagitta > limits.sagitta) return rejected("curved", signals);

  const confidence = clamp(1
    - .35 * (rms / limits.rms)
    - .2 * (maximum / limits.maximum)
    - .2 * Math.max(0, (1 - signals.straightness) / .14)
    - .1 * (backward / limits.backward), .5, 1);
  // Endpoints are projected onto the fitted line, which keeps the drawn
  // direction and length while discarding end hooks and tremor.
  const project = (point) => {
    const along = (point.x - meanX) * axisX + (point.y - meanY) * axisY;
    return { x: (meanX + axisX * along) * unit, y: ((meanY + axisY * along) * unit) / yScale };
  };
  return { recognized: true, confidence, start: project(first), end: project(last), signals };
}

/**
 * Replaces a recognized freehand line with a clean straight stroke of the same
 * tool. Color, width, opacity, pen profile and the stroke's own direction are
 * preserved; pressure is evened out to the stroke's median so the line keeps
 * a steady weight.
 */
export function straightenedInkStroke(stroke, recognition) {
  if (!stroke || !recognition?.start || !recognition?.end || !Array.isArray(stroke.points) || !stroke.points.length) return null;
  const source = stroke.points;
  const pressures = source.map((point) => Number(point.p)).filter((pressure) => Number.isFinite(pressure));
  const pressure = pressures.length ? percentile(pressures, .5) : undefined;
  const template = source[Math.floor(source.length / 2)] || source[0];
  const firstTime = finite(source[0].t, 0);
  const lastTime = finite(source[source.length - 1].t, firstTime);
  const length = distance(recognition.start, recognition.end);
  const count = Math.max(2, Math.min(96, Math.ceil(length / 6) + 1));
  const points = Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    return {
      ...template,
      x: recognition.start.x + (recognition.end.x - recognition.start.x) * ratio,
      y: recognition.start.y + (recognition.end.y - recognition.start.y) * ratio,
      t: firstTime + (lastTime - firstTime) * ratio,
      ...(pressure === undefined ? {} : { p: pressure })
    };
  });
  const { erasures: _erasures, rawStroke: _rawStroke, ...rest } = stroke;
  return { ...rest, points };
}

/** Returns a vector shape proposal for draw-and-hold, or null when confidence is low. */
export function recognizeHeldStroke(points, { unitsPerCssPixel = 1, aspect = 1 } = {}) {
  const source = Array.isArray(points) ? points : [];
  if (source.length < 2) return null;
  const unit = Math.max(.01, finite(unitsPerCssPixel, 1));
  const arrow = recognizeArrow(source, unit);
  if (arrow) return arrow;
  const line = analyzeLineIntent(source, { unitsPerCssPixel: unit, aspect });
  if (line.recognized) return { kind: "line", confidence: line.confidence, start: line.start, end: line.end };
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
