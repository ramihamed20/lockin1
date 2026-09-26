import { distanceBetweenSegments } from "./strokeModel.js";

const ELLIPSE_SEGMENTS = 48;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * The painted outline of a vector shape, in page units, matching how the
 * workspace renders it. Closed outlines repeat their first point.
 * @returns {{ points: {x:number,y:number}[], closed: boolean }[]}
 */
export function shapeOutlines(shape) {
  if (shape?.type !== "shape" || !shape.start || !shape.end) return [];
  const start = { x: finite(shape.start.x), y: finite(shape.start.y) };
  const end = { x: finite(shape.end.x), y: finite(shape.end.y) };
  if (["line", "arrow"].includes(shape.shape)) {
    const outlines = [{ points: [start, end], closed: false }];
    if (shape.shape === "arrow") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const head = Math.min(34, Math.max(12, finite(shape.width, 4) * 5));
      const normalX = -dy / length;
      const normalY = dx / length;
      const baseX = end.x - (dx / length) * head;
      const baseY = end.y - (dy / length) * head;
      outlines.push({ points: [
        { x: baseX + normalX * head * .45, y: baseY + normalY * head * .45 },
        end,
        { x: baseX - normalX * head * .45, y: baseY - normalY * head * .45 }
      ], closed: false });
    }
    return outlines;
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  let points;
  if (["circle", "ellipse"].includes(shape.shape)) {
    points = Array.from({ length: ELLIPSE_SEGMENTS }, (_, index) => {
      const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
      return { x: x + width / 2 + Math.cos(angle) * width / 2, y: y + height / 2 + Math.sin(angle) * height / 2 };
    });
  } else if (shape.shape === "triangle") {
    points = [{ x: x + width / 2, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  } else if (shape.shape === "polygon") {
    points = Array.from({ length: 6 }, (_, index) => ({
      x: x + width / 2 + Math.cos(index * Math.PI / 3) * width / 2,
      y: y + height / 2 + Math.sin(index * Math.PI / 3) * height / 2
    }));
  } else {
    points = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  }
  return [{ points: [...points, points[0]], closed: true }];
}

function pointInClosedPolyline(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const last = points[previous];
    if ((current.y > point.y) !== (last.y > point.y)
      && point.x < ((last.x - current.x) * (point.y - current.y)) / ((last.y - current.y) || 1e-9) + current.x) inside = !inside;
  }
  return inside;
}

/**
 * Whether a round eraser tip swept from `eraserStart` to `eraserEnd` touches
 * the visible shape. `radius` is in eraser space and `scale` maps page units
 * into it, so the test agrees with the circle drawn under the pointer. The
 * shape's own stroke width widens the hit area, as it does on screen.
 */
export function shapeIntersectsEraserPath(shape, eraserStart, eraserEnd, radius, scale = { x: 1, y: 1 }) {
  const outlines = shapeOutlines(shape);
  if (!outlines.length) return false;
  const sx = finite(scale?.x, 1) || 1;
  const sy = finite(scale?.y, 1) || 1;
  const toSpace = (point) => ({ x: point.x * sx, y: point.y * sy });
  const from = toSpace(eraserStart);
  const to = toSpace(eraserEnd);
  const threshold = Math.max(0, finite(radius)) + Math.max(.5, finite(shape.width, 4)) / 2;
  for (const outline of outlines) {
    const points = outline.points.map(toSpace);
    if (points.length === 1 && distanceBetweenSegments(points[0], points[0], from, to) <= threshold) return true;
    for (let index = 1; index < points.length; index += 1) {
      if (distanceBetweenSegments(points[index - 1], points[index], from, to) <= threshold) return true;
    }
    if (outline.closed && shape.fill && (pointInClosedPolyline(from, points) || pointInClosedPolyline(to, points))) return true;
  }
  return false;
}
