import { useEffect, useRef } from "react";
import { inkCanvasOutputScale } from "../catalog/renderBudget.js";
import { TRANSIENT_INK_KIND, neonAlpha, pointerAlpha } from "./transientInk.js";

function tracePath(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  if (points.length === 1) {
    context.lineTo(points[0].x + .01, points[0].y);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y);
}

/** A glowing coloured line with a bright core, like a neon tube. */
function paintNeon(context, stroke, now, devicePxPerUnit) {
  const alpha = neonAlpha(stroke, now);
  if (!stroke.points.length || alpha <= 0) return;
  context.globalAlpha = alpha;
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  // shadowBlur is in device pixels whatever the transform is.
  context.shadowColor = stroke.color;
  context.shadowBlur = stroke.width * devicePxPerUnit * 2.4;
  tracePath(context, stroke.points);
  context.stroke();
  context.stroke();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(255, 255, 255, .82)";
  context.lineWidth = stroke.width * .36;
  context.stroke();
}

/**
 * A laser trail. Samples are grouped into a few bands of equal opacity and each
 * band is one continuous path, so the fade reads as smooth rather than beaded
 * by the round caps of hundreds of overlapping segments.
 */
const POINTER_BANDS = 8;

function paintPointer(context, stroke, now, devicePxPerUnit) {
  const { points } = stroke;
  if (!points.length) return;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.shadowColor = stroke.color;
  context.shadowBlur = stroke.width * devicePxPerUnit * 1.6;
  let index = 1;
  while (index < points.length) {
    const band = Math.ceil(pointerAlpha(points[index].t, now) * POINTER_BANDS);
    const start = index - 1;
    while (index + 1 < points.length && Math.ceil(pointerAlpha(points[index + 1].t, now) * POINTER_BANDS) === band) index += 1;
    if (band > 0) {
      context.globalAlpha = band / POINTER_BANDS;
      tracePath(context, points.slice(start, index + 1));
      context.stroke();
    }
    index += 1;
  }
  if (stroke.endedAt === null) {
    const tip = points[points.length - 1];
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(tip.x, tip.y, stroke.width * .9, 0, Math.PI * 2);
    context.fill();
  }
}

/**
 * Paints the transient ink of one page. It animates only while that page has
 * something visible, and the backing store is allocated on first paint.
 *
 * @param {{ store: ReturnType<typeof import("./transientInk.js").createTransientInk>, pageNumber: any }} props
 */
export function TransientInkCanvas({ store, pageNumber }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !store) return undefined;
    let frame = null;
    let painted = false;

    const paint = () => {
      frame = null;
      const time = store.now();
      const strokes = store.visible(pageNumber, time);
      if (!strokes.length) {
        if (painted) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        painted = false;
        return;
      }
      const cssWidth = Math.max(1, canvas.clientWidth);
      const cssHeight = Math.max(1, canvas.clientHeight);
      const ratio = inkCanvasOutputScale(cssWidth, cssHeight, window.devicePixelRatio);
      const width = Math.max(1, Math.round(cssWidth * ratio));
      const height = Math.max(1, Math.round(cssHeight * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, width, height);
      // Page units run 0-1000 on both axes, as in the annotation layer.
      context.setTransform(width / 1000, 0, 0, height / 1000, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      const devicePxPerUnit = width / 1000;
      for (const stroke of strokes) {
        context.save();
        if (stroke.kind === TRANSIENT_INK_KIND.NEON) paintNeon(context, stroke, time, devicePxPerUnit);
        else paintPointer(context, stroke, time, devicePxPerUnit);
        context.restore();
      }
      painted = true;
      frame = requestAnimationFrame(paint);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(paint); };
    const unsubscribe = store.subscribe(schedule);
    schedule();
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [pageNumber, store]);

  return <canvas ref={canvasRef} className="workspace-v2-transient-ink-canvas" width={0} height={0} aria-hidden="true" data-transient-ink-page={pageNumber} />;
}
