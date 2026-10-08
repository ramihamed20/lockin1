import { useEffect, useRef } from "react";
import { inkCanvasOutputScale } from "../catalog/renderBudget.js";
import { TRANSIENT_INK_KIND, transientAlpha } from "./transientInk.js";

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
  const alpha = transientAlpha(stroke, now);
  if (!stroke.points.length || alpha <= 0) return;
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.shadowColor = stroke.color;
  // Wide halo, then tighter layers, so the light spreads well beyond the line.
  // shadowBlur is in device pixels whatever the transform is.
  for (const [blur, layerAlpha] of NEON_GLOW_LAYERS) {
    context.globalAlpha = alpha * layerAlpha;
    context.shadowBlur = stroke.width * devicePxPerUnit * blur;
    tracePath(context, stroke.points);
    context.stroke();
  }
  context.globalAlpha = alpha;
  context.shadowBlur = stroke.width * devicePxPerUnit * .8;
  context.shadowColor = "rgba(255, 255, 255, .9)";
  context.strokeStyle = "rgba(255, 255, 255, .92)";
  context.lineWidth = stroke.width * .4;
  tracePath(context, stroke.points);
  context.stroke();
}

const NEON_GLOW_LAYERS = [[7, .55], [3.6, .8], [1.6, 1]];

/** A laser line with a soft glow and a bright dot at the tip while it moves. */
function paintPointer(context, stroke, now, devicePxPerUnit) {
  const { points } = stroke;
  const alpha = transientAlpha(stroke, now);
  if (!points.length || alpha <= 0) return;
  context.globalAlpha = alpha;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.shadowColor = stroke.color;
  context.shadowBlur = stroke.width * devicePxPerUnit * 3;
  tracePath(context, points);
  context.stroke();
  if (stroke.fadeAt === null) {
    const tip = points[points.length - 1];
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
    let wake = null;
    let painted = false;

    const paint = () => {
      frame = null;
      if (wake !== null) { clearTimeout(wake); wake = null; }
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
      // Held ink does not change, so sleep until the pen moves again or the
      // fade is due instead of redrawing glowing strokes every frame.
      const animating = store.isDrawing() || strokes.some((stroke) => stroke.fadeAt !== null && stroke.fadeAt <= time);
      if (animating) {
        frame = requestAnimationFrame(paint);
      } else {
        const next = Math.min(...strokes.map((stroke) => stroke.fadeAt ?? Infinity));
        if (Number.isFinite(next)) wake = setTimeout(schedule, Math.max(0, next - time));
      }
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(paint); };
    const unsubscribe = store.subscribe(schedule);
    schedule();
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
      if (wake !== null) clearTimeout(wake);
    };
  }, [pageNumber, store]);

  return <canvas ref={canvasRef} className="workspace-v2-transient-ink-canvas" width={0} height={0} aria-hidden="true" data-transient-ink-page={pageNumber} />;
}
