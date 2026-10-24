import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { smoothStrokePoints, strokeRenderGeometry, strokeWidthAtPoint } from "./strokeModel.js";
import { createPreviewStrokeCache } from "./previewStrokeCache.js";
import { createSvgEraserPreview } from "./svgEraserPreview.js";
import { createIsolatedInkPreview } from "./isolatedInkPreview.js";
import { createLiveStrokeGeometry } from "./liveStrokeGeometry.js";
import { measureInkCanvas, observeInkCanvas, sizeInkCanvas } from "./inkCanvasViewport.js";
import { paintInkErasures } from "./inkErasures.js";
import { useWorkspacePaneActive } from "../catalog/workspacePane.js";

/** A dot is round on the page, so in page units it is an ellipse on a page that is not square. */
function drawDot(context, geometry, color, opacity) {
  const radius = Math.max(.6, geometry.radius);
  context.globalAlpha = opacity;
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(geometry.x, geometry.y, geometry.radiusX ?? radius, geometry.radiusY ?? radius, 0, 0, Math.PI * 2);
  context.fill();
}

function paintGeometry(context, geometry, color, preparedPath = null) {
  if (!geometry.path) return;
  if (typeof window.Path2D === "function") {
    const path = preparedPath || new window.Path2D(geometry.path);
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

const mergePathCache = new WeakMap();

/**
 * Removes, from the live highlighter, the area already covered by saved
 * highlights it will merge with. Saved highlights of one colour and opacity
 * are drawn as a single group, so they never darken where they overlap; the
 * live stroke has its own opacity, and without this cut it would show a darker
 * band over them until the pen lifts.
 */
function cutMergedHighlights(context, targets, pageAspect = 1) {
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = 1;
  for (const target of targets) {
    const geometry = strokeRenderGeometry(target, pageAspect);
    if (geometry.kind === "dot") {
      drawDot(context, geometry, "#000", 1);
      continue;
    }
    if (!geometry.path) continue;
    let cached = mergePathCache.get(target);
    if (cached?.source !== geometry.path) {
      cached = { source: geometry.path, path: new window.Path2D(geometry.path) };
      mergePathCache.set(target, cached);
    }
    paintGeometry(context, geometry, "#000", cached.path);
  }
  context.globalCompositeOperation = "source-over";
}

function drawStroke(context, annotation, pageAspect = 1, previewCache = null) {
  const points = annotation?.points || [];
  if (!points.length) return 0;
  const geometryStarted = window.performance.now();
  const prepared = previewCache?.get(annotation, window.Path2D, pageAspect);
  const geometry = prepared?.geometry || strokeRenderGeometry(annotation, pageAspect);
  const geometryTime = window.performance.now() - geometryStarted;
  if (geometry.kind === "dot") {
    drawDot(context, geometry, annotation.color, geometry.opacity);
    paintInkErasures(context, annotation.erasures, pageAspect);
    return geometryTime;
  }
  context.save();
  context.globalAlpha = geometry.opacity;
  context.globalCompositeOperation = "source-over";
  if (typeof window.Path2D === "function" && geometry.path) paintGeometry(context, geometry, annotation.color, prepared?.path);
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
  paintInkErasures(context, annotation.erasures, pageAspect);
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
 *
 * The backing store is allocated on the first paint, not on mount. The canvas
 * moves to whichever page is current, so scrolling through a document would
 * otherwise allocate (and composite) a full-page transparent bitmap on every
 * page change even when nothing is ever drawn.
 */
export const LiveAnnotationCanvas = forwardRef(
/** @param {{ pageNumber: number, pageAspect?: number }} props */
function LiveAnnotationCanvas({ pageNumber, pageAspect = 1 }, ref) {
  const paneActive = useWorkspacePaneActive();
  const paneActiveRef = useRef(paneActive);
  paneActiveRef.current = paneActive;
  const canvasRef = useRef(null);
  const svgPreviewRef = useRef(null);
  if (svgPreviewRef.current === null) svgPreviewRef.current = createSvgEraserPreview();
  const isolatedPreviewRef = useRef(null);
  if (isolatedPreviewRef.current === null) isolatedPreviewRef.current = createIsolatedInkPreview(() => document.createElement("canvas"));
  const previewStrokeCacheRef = useRef(null);
  if (previewStrokeCacheRef.current === null) previewStrokeCacheRef.current = createPreviewStrokeCache();
  const pageAspectRef = useRef(pageAspect);
  pageAspectRef.current = pageAspect;
  const sizeRef = useRef({ width: 0, height: 0, ratio: 1, x: 0, y: 0, surfaceWidth: 0, surfaceHeight: 0, pixelWidth: 0, pixelHeight: 0 });
  const sizeDirtyRef = useRef(true);
  const contextRef = useRef(null);
  const frameRef = useRef(null);
  // Saved highlights the live highlighter will merge with (same colour and opacity).
  const mergeTargetsRef = useRef([]);
  const liveGeometryRef = useRef(null);
  if (liveGeometryRef.current === null) liveGeometryRef.current = createLiveStrokeGeometry();

  const ensureSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !paneActiveRef.current) return null;
    if (sizeDirtyRef.current) {
      const next = measureInkCanvas(canvas);
      const previous = sizeRef.current;
      if (Object.keys(next).some((key) => next[key] !== previous[key])) {
        sizeInkCanvas(canvas, next);
        // A moving crop or density change needs the complete vector stroke.
        if (contextRef.current) {
          contextRef.current.setTransform(1, 0, 0, 1, 0, 0);
          contextRef.current.clearRect(0, 0, canvas.width, canvas.height);
        }
        sizeRef.current = next;
        liveGeometryRef.current.invalidate();
      }
      sizeDirtyRef.current = false;
    }
    if (!canvas.width || !canvas.height) {
      sizeInkCanvas(canvas, sizeRef.current);
      liveGeometryRef.current.invalidate();
    }
    if (!contextRef.current) {
      // A desynchronized canvas may present outside the compositor's frame,
      // which shortens pen-to-ink latency where the browser supports it
      // (Chromium); elsewhere the hint is ignored.
      contextRef.current = canvas.getContext("2d", { desynchronized: true });
    }
    return contextRef.current;
  }, []);

  const resetSurface = useCallback((context, { blend = "normal", opacity = 1 } = {}) => {
    const canvas = canvasRef.current;
    const { width, height, ratio, x = 0, y = 0 } = sizeRef.current;
    context.setTransform(ratio, 0, 0, ratio, -x * ratio, -y * ratio);
    if (canvas) {
      canvas.style.mixBlendMode = blend;
      canvas.style.opacity = String(opacity);
    }
    return { width, height };
  }, []);

  const clear = useCallback(() => {
    svgPreviewRef.current.release();
    isolatedPreviewRef.current.release();
    previewStrokeCacheRef.current.clear();
    liveGeometryRef.current.reset();
    frameRef.current = null;
    const canvas = canvasRef.current;
    // Nothing has been painted into an unallocated canvas.
    if (!canvas || !canvas.width || !canvas.height) return;
    const context = ensureSize();
    if (!context) return;
    const { width, height } = resetSurface(context);
    context.clearRect(0, 0, width, height);
  }, [ensureSize, resetSurface]);

  /** Repaints the active stroke, appending only new geometry when it can. */
  const paintLiveStroke = useCallback((annotation, predicted, diagnostics, { forceFull = false } = {}) => {
    const context = ensureSize();
    if (!context) return { geometryTime: 0, incremental: false };
    if (typeof window.Path2D !== "function") {
      const { width, height, ratio, x, y } = sizeRef.current;
      const canvas = canvasRef.current;
      context.setTransform(ratio, 0, 0, ratio, -x * ratio, -y * ratio);
      if (canvas) {
        canvas.style.opacity = "1";
        canvas.style.mixBlendMode = annotation?.type === "highlighter" ? "multiply" : "normal";
      }
      context.clearRect(0, 0, width, height);
      context.save();
      context.scale(width / 1000, height / 1000);
      const geometryTime = drawStroke(context, predicted?.length ? { ...annotation, points: [...(annotation.points || []), ...predicted] } : annotation, pageAspectRef.current);
      drawDiagnostics(context, diagnostics, 1000 / Math.max(1, width));
      context.restore();
      return { geometryTime, incremental: false };
    }
    const geometryStarted = window.performance.now();
    const geometry = liveGeometryRef.current.frame(annotation, predicted, { forceFull: forceFull || Boolean(diagnostics), pageAspect: pageAspectRef.current });
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
    if (geometry.kind === "dot") drawDot(context, geometry, geometry.color, 1);
    else paintGeometry(context, geometry, geometry.color);
    // Re-cut every frame: appended geometry is painted over the earlier cut.
    if (annotation?.type === "highlighter" && mergeTargetsRef.current.length) cutMergedHighlights(context, mergeTargetsRef.current, pageAspectRef.current);
    drawDiagnostics(context, diagnostics, cssScale);
    context.restore();
    return { geometryTime, incremental: geometry.mode === "append" };
  }, [ensureSize, resetSurface]);

  const paintFrame = useCallback((frame, { forceFull = false } = {}) => {
    const svgWasActive = svgPreviewRef.current.active;
    if (frame?.kind === "annotations" && frame.svgPreview && paneActiveRef.current
      && svgPreviewRef.current.paint(canvasRef.current, frame.annotations, frame.hiddenIds, pageAspectRef.current)) {
      isolatedPreviewRef.current.release();
      return { geometryTime: 0, incremental: false };
    }
    svgPreviewRef.current.release();
    if (frame?.kind === "annotations" && (svgWasActive || frame.svgPreview)) {
      // A later touched mark can require raster fragmentation. Re-hide all
      // originals when switching renderers, including marks restored by SVG.
      const ids = new Set(frame.hiddenIds.map(String));
      const layer = canvasRef.current?.parentElement?.querySelector(":scope > svg.workspace-v2-annotation-layer");
      for (const mark of layer?.querySelectorAll("[data-annotation-id]") || []) {
        if (ids.has(String(mark.getAttribute("data-annotation-id")))) mark.style.visibility = "hidden";
      }
    }
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
    else for (const annotation of annotations) geometryTime += isolatedPreviewRef.current.paint(
      context, annotation, sizeRef.current,
      (target, mark) => drawStroke(target, mark, pageAspectRef.current, previewStrokeCacheRef.current)
    );
    context.restore();
    return { geometryTime, incremental: false };
  }, [ensureSize, paintLiveStroke, resetSurface]);

  const draw = useCallback((annotation, diagnostics = null, predicted = null) => {
    const frame = { kind: "annotation", annotation, diagnostics, predicted };
    frameRef.current = frame;
    return paintFrame(frame);
  }, [paintFrame]);

  const drawAnnotations = useCallback((annotations, options = {}) => {
    const frame = { kind: "annotations", annotations: annotations || [], svgPreview: options.svgPreview, hiddenIds: options.hiddenIds || [] };
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

  const setMergeTargets = useCallback((annotations) => {
    // A highlight with erasures would cut more than it shows, so it is left out.
    mergeTargetsRef.current = (annotations || []).filter((annotation) => annotation?.points?.length && !annotation.erasures?.length);
  }, []);

  useImperativeHandle(ref, () => ({ clear, draw, drawAnnotations, drawLasso: drawLassoPreview, setMergeTargets, pageNumber }), [clear, draw, drawAnnotations, drawLassoPreview, setMergeTargets, pageNumber]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!paneActive) {
      svgPreviewRef.current.release();
      isolatedPreviewRef.current.release();
      previewStrokeCacheRef.current.clear();
      // Keep the logical preview/handoff, but release its hidden bitmap.
      // Background draws and resize callbacks cannot allocate while hidden.
      canvas.width = 0;
      canvas.height = 0;
      contextRef.current = null;
      liveGeometryRef.current.invalidate();
      return;
    }
    // A committed handoff may already have cleared the frame while hidden.
    // An interrupted live stroke or selection still needs its full preview.
    sizeDirtyRef.current = true;
    if (frameRef.current) paintFrame(frameRef.current, { forceFull: true });
  }, [paneActive, paintFrame]);

  useEffect(() => () => {
    svgPreviewRef.current.release();
    isolatedPreviewRef.current.release();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = null;
    const stop = observeInkCanvas(canvas, () => {
      sizeDirtyRef.current = true;
      if (frameRef.current && frame === null) frame = requestAnimationFrame(() => {
        frame = null;
        if (frameRef.current) paintFrame(frameRef.current, { forceFull: true });
      });
    });
    return () => { stop(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [paintFrame]);

  return <canvas ref={canvasRef} className="workspace-v2-live-annotation-canvas" width={0} height={0} aria-hidden="true" />;
});
