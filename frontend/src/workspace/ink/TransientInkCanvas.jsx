import { useEffect, useRef } from "react";
import { measureInkCanvas, observeInkCanvas, sizeInkCanvas } from "./inkCanvasViewport.js";
import { transientAlpha } from "./transientInk.js";

/** Traces page points with y stretched by `yScale`, so the canvas scale stays uniform. */
function tracePath(context, points, yScale) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y * yScale);
  if (points.length === 1) {
    context.lineTo(points[0].x + .01, points[0].y * yScale);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(point.x, point.y * yScale, (point.x + next.x) / 2, ((point.y + next.y) / 2) * yScale);
  }
  const last = points[points.length - 1];
  context.lineTo(last.x, last.y * yScale);
}

/** `color` mixed toward white by `amount` (0-1), for the hot core of the line. */
function tint(color, amount) {
  const hex = String(color || "").trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, (digit) => digit + digit) : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return "#ffffff";
  const value = Number.parseInt(full, 16);
  const channel = (shift) => {
    const base = (value >> shift) & 255;
    return Math.round(base + (255 - base) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/**
 * Glow layers, widest first: [shadow blur as a multiple of the stroke width,
 * opacity]. The wide halo spreads light around the line; the tight layers make
 * the line itself burn.
 */
const POINTER_GLOW_LAYERS = [[9, .42], [4.5, .75], [1.8, 1]];

/**
 * A neon line: layered coloured glow, a near-white core, and a bright spark at
 * the tip of the stroke the pen is drawing. Fading thins the line as well as
 * dimming it, so it reads as the light going out rather than ink turning grey.
 */
function paintPointer(context, stroke, now, devicePxPerUnit, yScale) {
  const { points } = stroke;
  const fade = transientAlpha(stroke, now);
  if (!points.length || fade <= 0) return;
  const alpha = fade * fade * (3 - 2 * fade);
  const width = stroke.width * (.72 + .28 * fade);
  // shadowBlur is in device pixels whatever the transform is.
  const blurUnit = width * devicePxPerUnit;
  context.strokeStyle = stroke.color;
  context.shadowColor = stroke.color;
  context.lineWidth = width;
  for (const [blur, layerAlpha] of POINTER_GLOW_LAYERS) {
    context.globalAlpha = alpha * layerAlpha;
    context.shadowBlur = blurUnit * blur;
    tracePath(context, points, yScale);
    context.stroke();
  }
  const core = tint(stroke.color, .72);
  context.globalAlpha = alpha;
  context.strokeStyle = core;
  context.shadowColor = core;
  context.shadowBlur = blurUnit * .6;
  context.lineWidth = width * .42;
  tracePath(context, points, yScale);
  context.stroke();
  // Only the stroke under the pen: an earlier stroke held on screen by new
  // writing must not light up where the pen left it.
  if (!stroke.live) return;
  const last = points[points.length - 1];
  const tip = { x: last.x, y: last.y * yScale };
  const radius = width * 1.5;
  const spark = context.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, radius);
  spark.addColorStop(0, "rgba(255, 255, 255, 1)");
  spark.addColorStop(.35, core);
  spark.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.shadowColor = stroke.color;
  context.shadowBlur = blurUnit * 3;
  context.fillStyle = spark;
  context.beginPath();
  context.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
  context.fill();
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
    let size = null;

    const paint = () => {
      frame = null;
      if (wake !== null) { clearTimeout(wake); wake = null; }
      const time = store.now();
      const strokes = store.visible(pageNumber, time);
      if (!strokes.length) {
        // Release the backing store; the next stroke measures and allocates again.
        if (painted) {
          canvas.width = 0;
          canvas.height = 0;
          size = null;
        }
        painted = false;
        return;
      }
      if (!size) {
        size = measureInkCanvas(canvas);
        sizeInkCanvas(canvas, size);
      }
      const { width, height, ratio, x, y } = size;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      // Page units run 0-1000 on both axes, as in the annotation layer. The
      // transform stays uniform (y is stretched per point instead) so a line
      // is as thick going across the page as going down it.
      const unit = width * ratio / 1000;
      context.setTransform(unit, 0, 0, unit, -x * ratio, -y * ratio);
      const yScale = height / width;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const stroke of strokes) {
        context.save();
        paintPointer(context, stroke, time, unit, yScale);
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
    const stopObserving = observeInkCanvas(canvas, () => { size = null; schedule(); });
    schedule();
    return () => {
      unsubscribe();
      stopObserving();
      if (frame !== null) cancelAnimationFrame(frame);
      if (wake !== null) clearTimeout(wake);
    };
  }, [pageNumber, store]);

  return <canvas ref={canvasRef} className="workspace-v2-transient-ink-canvas" width={0} height={0} aria-hidden="true" data-transient-ink-page={pageNumber} />;
}
