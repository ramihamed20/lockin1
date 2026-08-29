import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { smoothStrokePoints, strokeRenderGeometry, strokeWidthAtPoint } from "./strokeModel.js";
import { createLiveStrokeGeometry } from "./liveStrokeGeometry.js";
import { inkCanvasOutputScale } from "../catalog/renderBudget.js";

function drawDot(context, point, width, color, opacity) {
  context.globalAlpha = opacity;
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, Math.max(.6, width / 2), 0, Math.PI * 2);
  context.fill();
}

function paintGeometry(context, geometry, color) {
  if (!geometry.path) return;
  if (typeof window.Path2D === "function") {
    const path = new window.Path2D(geometry.path);
    if (geometry.kind === "outline") {
      context.fillStyle = color;
      context.fill(path);
      return;
    }
    context.strokeStyle = color;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = geometry.width;
    context.stroke(path);
    return;
  }
  paintCenterlineFallback(context, geometry, color);
}

/**
 * Path2D SVG parsing is broadly available, but keep a smooth centerline
 * fallback for older embedded webviews instead of dropping live ink.
 */
function paintCenterlineFallback(context, geometry, color) {
  const smoothed = geometry.fallbackPoints || [];
  if (smoothed.length < 2) return;
  context.strokeStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = geometry.width || 2;
  context.beginPath();
  context.moveTo(smoothed[0].x, smoothed[0].y);
  for (let index = 1; index < smoothed.length - 1; index += 1) {
    const point = smoothed[index];
    const next = smoothed[index + 1];
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  const last = smoothed[smoothed.length - 1];
  context.lineTo(last.x, last.y);
  context.stroke();
}

function drawStroke(context, annotation) {
  const points = annotation?.points || [];
  if (!points.length) return 0;
  const geometryStarted = window.performance.now();
  const geometry = strokeRenderGeometry(annotation);
  const geometryTime = window.performance.now() - geometryStarted;
  if (geometry.kind === "dot") {
    drawDot(context, geometry, geometry.radius * 2, annotation.color, geometry.opacity);
    return geometryTime;
  }
  context.save();
  context.globalAlpha = geometry.opacity;
  context.globalCompositeOperation = "source-over";
  if (typeof window.Path2D === "function" && geometry.path) paintGeometry(context, geometry, annotation.color);
  else {
    const smoothed = smoothStrokePoints(points);
    paintCenterlineFallback(context, {
      ...geometry,
      fallbackPoints: smoothed,
      width: geometry.kind === "centerline"
        ? geometry.width
        : smoothed.reduce((total, point) => total + strokeWidthAtPoint(annotation, point), 0) / Math.max(1, smoothed.length)
    }, annotation.color);
  }
  context.restore();
  return geometryTime;
}

function drawLasso(context, points, cssScale) {
  if (!points?.length) return;
  context.save();
  context.fillStyle = "rgba(118,80,237,.08)";
  context.strokeStyle = "#7650ed";
  context.lineWidth = 3 * cssScale;
  context.setLineDash([12 * cssScale, 8 * cssScale]);
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function drawDiagnostics(context, diagnostics, cssScale) {
  if (!diagnostics) return;
  const collections = [
    [diagnostics.rawPage, "#a855f7", 2.5],
    [diagnostics.normalized, "#06b6d4", 1.7],
    [diagnostics.predicted, "#f59e0b", 2]
  ];
  context.save();
  for (const [points, color, radius] of collections) {
    context.fillStyle = color;
    for (const point of points || []) {
      context.beginPath();
      context.arc(point.x, point.y, radius * cssScale, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
}

/**
 * Imperative layer for the in-progress handwriting stroke. The parent calls
 * `draw` from its own rAF queue, so high-frequency pointer events never need
 * to enter React's render path.
 *
 * The active stroke is painted opaquely and the element carries its opacity, so
 * appending only the geometry that changed can never darken an overlap. That is
 * what lets a long stroke stay incremental instead of repainting every sample.
 */
export const LiveAnnotationCanvas = forwardRef(
/** @param {{ pageNumber: number }} props */
function LiveAnnotationCanvas({ pageNumber }, ref) {
  const canvasRef = useRef(null);
  const sizeRef = useRef({ width: 0, height: 0, ratio: 1 });
  const contextRef = useRef(null);
  const frameRef = useRef(null);
  const liveGeometryRef = useRef(null);
  if (liveGeometryRef.current === null) liveGeometryRef.current = createLiveStrokeGeometry();

  const ensureSize = useCallback((observedBounds = null) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const cached = sizeRef.current;
    const bounds = observedBounds?.width > 0 && observedBounds?.height > 0
      ? observedBounds
      : cached.width > 0 && cached.height > 0
        ? cached
        : canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, bounds.width);
    const cssHeight = Math.max(1, bounds.height);
    const ratio = inkCanvasOutputScale(cssWidth, cssHeight, window.devicePixelRatio);
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    // Resizing the backing store clears it, so the next stroke frame must be
    // repainted from its first sample instead of appending to erased pixels.
    if (canvas.width !== width) {
      canvas.width = width;
      liveGeometryRef.current.invalidate();
    }
    if (canvas.height !== height) {
      canvas.height = height;
      liveGeometryRef.current.invalidate();
    }
    if (!contextRef.current) {
      contextRef.current = canvas.getContext("2d");
    }
    sizeRef.current = { width: cssWidth, height: cssHeight, ratio };
    return contextRef.current;
  }, []);

  const resetSurface = useCallback((context, { blend = "normal", opacity = 1 } = {}) => {
    const canvas = canvasRef.current;
    const { width, height, ratio } = sizeRef.current;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (canvas) {
      canvas.style.mixBlendMode = blend;
      canvas.style.opacity = String(opacity);
    }
    return { width, height };
  }, []);

  const clear = useCallback(() => {
    const context = ensureSize();
    if (!context) return;
    const { width, height } = resetSurface(context);
    context.clearRect(0, 0, width, height);
    liveGeometryRef.current.reset();
    frameRef.current = null;
  }, [ensureSize, resetSurface]);

  /** Repaints the active stroke, appending only new geometry when it can. */
  const paintLiveStroke = useCallback((annotation, predicted, diagnostics, { forceFull = false } = {}) => {
    const context = ensureSize();
    if (!context) return { geometryTime: 0, incremental: false };
    if (typeof window.Path2D !== "function") {
      const { width, height, ratio } = sizeRef.current;
      const canvas = canvasRef.current;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (canvas) {
        canvas.style.opacity = "1";
        canvas.style.mixBlendMode = annotation?.type === "highlighter" ? "multiply" : "normal";
      }
      context.clearRect(0, 0, width, height);
      context.save();
      context.scale(width / 1000, height / 1000);
      const geometryTime = drawStroke(context, predicted?.length ? { ...annotation, points: [...(annotation.points || []), ...predicted] } : annotation);
      drawDiagnostics(context, diagnostics, 1000 / Math.max(1, width));
      context.restore();
      return { geometryTime, incremental: false };
    }
    const geometryStarted = window.performance.now();
    const geometry = liveGeometryRef.current.frame(annotation, predicted, { forceFull: forceFull || Boolean(diagnostics) });
    const geometryTime = window.performance.now() - geometryStarted;
    const { width, height } = resetSurface(context, {
      blend: geometry.composite === "multiply" ? "multiply" : "normal",
      opacity: geometry.opacity
    });
    if (geometry.mode === "full") context.clearRect(0, 0, width, height);
    context.save();
    context.scale(width / 1000, height / 1000);
    const cssScale = 1000 / Math.max(1, width);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    if (geometry.kind === "dot") drawDot(context, geometry, geometry.radius * 2, geometry.color, 1);
    else paintGeometry(context, geometry, geometry.color);
    drawDiagnostics(context, diagnostics, cssScale);
    context.restore();
    return { geometryTime, incremental: geometry.mode === "append" };
  }, [ensureSize, resetSurface]);

  const paintFrame = useCallback((frame, { forceFull = false } = {}) => {
    const context = ensureSize();
    if (!context) return { geometryTime: 0, incremental: false };
    if (frame?.kind === "annotation") {
      return paintLiveStroke(frame.annotation, frame.predicted, frame.diagnostics, { forceFull });
    }
    const annotations = frame?.annotations || [];
    // A highlighter preview keeps multiplying against the page, exactly as the
    // committed highlighter layer does.
    const highlighterOnly = frame?.kind === "annotations" && annotations.length > 0
      && annotations.every((annotation) => annotation?.type === "highlighter");
    const { width, height } = resetSurface(context, { blend: highlighterOnly ? "multiply" : "normal" });
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(width / 1000, height / 1000);
    const cssScale = 1000 / Math.max(1, width);
    let geometryTime = 0;
    if (frame?.kind === "lasso") drawLasso(context, frame.points, cssScale);
    else for (const annotation of annotations) geometryTime += drawStroke(context, annotation);
    context.restore();
    return { geometryTime, incremental: false };
  }, [ensureSize, paintLiveStroke, resetSurface]);

  const draw = useCallback((annotation, diagnostics = null, predicted = null) => {
    const frame = { kind: "annotation", annotation, diagnostics, predicted };
    frameRef.current = frame;
    return paintFrame(frame);
  }, [paintFrame]);

  const drawAnnotations = useCallback((annotations) => {
    const frame = { kind: "annotations", annotations: annotations || [] };
    frameRef.current = frame;
    liveGeometryRef.current.reset();
    paintFrame(frame);
  }, [paintFrame]);

  const drawLassoPreview = useCallback((points) => {
    const frame = { kind: "lasso", points: points || [] };
    frameRef.current = frame;
    liveGeometryRef.current.reset();
    paintFrame(frame);
  }, [paintFrame]);

  useImperativeHandle(ref, () => ({ clear, draw, drawAnnotations, drawLasso: drawLassoPreview, pageNumber }), [clear, draw, drawAnnotations, drawLassoPreview, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window.ResizeObserver === "undefined") return undefined;
    ensureSize(canvas.getBoundingClientRect());
    const observer = new window.ResizeObserver((entries) => {
      ensureSize(entries[0]?.contentRect);
      if (frameRef.current) paintFrame(frameRef.current, { forceFull: true });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [ensureSize, paintFrame]);

  return <canvas ref={canvasRef} className="workspace-v2-live-annotation-canvas" aria-hidden="true" />;
});
