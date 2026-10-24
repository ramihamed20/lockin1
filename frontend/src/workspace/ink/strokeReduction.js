/**
 * Fewer samples for the same stroke. A pen at 240Hz records a point every
 * fraction of a pixel; most of them sit on the straight line between their
 * neighbours. Ramer-Douglas-Peucker keeps the ones that bend the line or change
 * the pressure, so the outline drawn from what is kept matches the original.
 *
 * Distances are in page units (1/1000 of the page on each axis).
 */

const PRESSURE_TOLERANCE = .08;

function sampleDeviation(point, start, end, tolerance) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  let ratio = 0;
  let distance;
  if (lengthSquared < 1e-12) distance = Math.hypot(point.x - start.x, point.y - start.y);
  else {
    ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    distance = Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
  }
  const startPressure = Number(start.p);
  const endPressure = Number(end.p);
  const pressure = Number(point.p);
  if (!Number.isFinite(startPressure) || !Number.isFinite(endPressure) || !Number.isFinite(pressure)) return distance;
  // A pressure change counts as much as a bend of the same relative size.
  const pressureError = Math.abs(pressure - (startPressure + (endPressure - startPressure) * ratio));
  return Math.max(distance, pressureError * tolerance / PRESSURE_TOLERANCE);
}

/** Points kept at `tolerance`, always including the first and the last. */
export function simplifyStroke(points, tolerance) {
  const source = Array.isArray(points) ? points : [];
  if (source.length < 3 || !(tolerance > 0)) return [...source];
  const keep = new Uint8Array(source.length);
  keep[0] = 1;
  keep[source.length - 1] = 1;
  const stack = [[0, source.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const deviation = sampleDeviation(source[index], source[first], source[last], tolerance);
      if (deviation > farthestDistance) {
        farthest = index;
        farthestDistance = deviation;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    stack.push([first, farthest], [farthest, last]);
  }
  return source.filter((_, index) => keep[index]);
}

/**
 * At most `maxCount` samples, simplified as little as that allows. Strokes
 * already within the limit are returned unchanged.
 */
export function reduceStrokeSamples(points, maxCount, startTolerance = .15) {
  const source = Array.isArray(points) ? points : [];
  const limit = Math.max(2, Math.floor(maxCount) || 2);
  if (source.length <= limit) return source;
  let tolerance = startTolerance;
  let reduced = simplifyStroke(source, tolerance);
  while (reduced.length > limit && tolerance < 1000) {
    tolerance *= 1.5;
    reduced = simplifyStroke(source, tolerance);
  }
  if (reduced.length <= limit) return reduced;
  // Unreachable for real strokes; an even pick still keeps both ends.
  return Array.from({ length: limit }, (_, index) => reduced[Math.round(index * (reduced.length - 1) / (limit - 1))]);
}
