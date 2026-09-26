import { eraserSpaceScale } from "./strokeModel.js";

/**
 * Erase only the area swept by the round tip. Points are in 1000-unit page
 * space; the radius is in eraser space (see `eraserSpaceScale`), so the swept
 * area is a true circle on the rendered page. `pageAspect` is the height of the
 * page divided by its width, and 1 reproduces plain page-unit circles.
 */
export function paintInkErasures(context, erasures = [], pageAspect = 1) {
  if (!erasures?.length) return;
  const scale = eraserSpaceScale(pageAspect);
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "#000";
  context.fillStyle = "#000";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.scale(1 / scale.x, 1 / scale.y);
  for (const erasure of erasures) {
    const points = erasure.points || [];
    if (!points.length) continue;
    const radius = Math.max(.5, Number(erasure.radius) || 0);
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x * scale.x, points[0].y * scale.y, radius, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.lineWidth = radius * 2;
    context.beginPath();
    context.moveTo(points[0].x * scale.x, points[0].y * scale.y);
    for (const point of points.slice(1)) context.lineTo(point.x * scale.x, point.y * scale.y);
    context.stroke();
  }
  context.restore();
}
