/** Erase only the area swept by the round tip, in the same 1000-unit page space as ink. */
export function paintInkErasures(context, erasures = []) {
  if (!erasures.length) return;
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "#000";
  context.fillStyle = "#000";
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const erasure of erasures) {
    const points = erasure.points || [];
    if (!points.length) continue;
    const radius = Math.max(.5, Number(erasure.radius) || 0);
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.lineWidth = radius * 2;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
}
