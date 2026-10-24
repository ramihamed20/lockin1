import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, Minus, Plus, X } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { generateIdempotencyKey } from "../../api/pagination.js";
import { createInkInputController } from "../../workspace/ink/inkInputController.js";
import { isVirtualPageKey } from "../../workspace/catalog/virtualPages.js";
import { AnnotationVisuals, WorkspaceAnnotation } from "./annotationVisuals.jsx";
import { advanceZoomRegion, nextZoomLine, ZOOM_WINDOW_SIZES, zoomRegionHeight, clampZoomRegion, ZOOM_ADVANCE_ZONE } from "./zoomWindowModel.js";
import "./zoom-window.css";

/**
 * The Zoom Window, as in GoodNotes: a magnified strip of the page docked at
 * the bottom of the reader. What is written in it lands on the page, smaller,
 * inside the box drawn there; writing into the right-hand zone moves the box
 * along the line, and Return starts the next line.
 *
 * The PDF is rendered for the region itself, so it is sharp at any
 * magnification, and saved ink is the page's own vector layer seen through a
 * smaller viewBox. A finished stroke goes through the page's command path, so
 * Undo, saving and sync treat it like any other.
 * @param {{ region: { page: any, x: number, y: number, w: number }, onRegionChange: (region: any) => void, pageAspect: number, annotations: any[], pdfDocument: any, pen: any, onCommit: (annotation: any) => void, onClose: () => void, onHeightChange?: (height: number) => void }} props
 */
export function ZoomWindow({ region, onRegionChange, pageAspect, annotations, pdfDocument, pen, onCommit, onClose, onHeightChange }) {
  const { t } = useI18n();
  const surfaceRef = useRef(null);
  const canvasRef = useRef(null);
  const controllerRef = useRef(null);
  const draftRef = useRef(null);
  const penSeenAtRef = useRef(0);
  const frameRef = useRef(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(null);
  if (!controllerRef.current) controllerRef.current = createInkInputController();
  const height = box.width ? zoomRegionHeight(region.w, box, pageAspect) : 0;
  // Arabic is written right to left: the box moves left, lines start on the right.
  const rtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const measure = () => {
      const bounds = surface.getBoundingClientRect();
      setBox((current) => Math.abs(current.width - bounds.width) < .5 && Math.abs(current.height - bounds.height) < .5 ? current : { width: bounds.width, height: bounds.height });
    };
    measure();
    const observer = typeof window.ResizeObserver === "undefined" ? null : new window.ResizeObserver(measure);
    observer?.observe(surface);
    return () => observer?.disconnect();
  }, []);

  // The page under the region, rendered at the window's own resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !box.width || !box.height) return undefined;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!pdfDocument || isVirtualPageKey(region.page)) return undefined;
    let cancelled = false;
    let task = null;
    (async () => {
      try {
        const page = await pdfDocument.getPage(Number(region.page));
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = canvas.width / (region.w / 1000 * base.width);
        const viewport = page.getViewport({ scale });
        task = page.render({
          canvasContext: context,
          viewport,
          transform: [1, 0, 0, 1, -region.x / 1000 * viewport.width, -region.y / 1000 * viewport.height]
        });
        await task.promise;
      } catch {
        // A cancelled render is replaced by the next one; a failed page stays white.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel?.();
    };
  }, [box.height, box.width, pdfDocument, region.page, region.w, region.x, region.y]);

  const toPage = useCallback((clientX, clientY) => {
    const bounds = surfaceRef.current.getBoundingClientRect();
    return {
      x: region.x + (clientX - bounds.left) / bounds.width * region.w,
      y: region.y + (clientY - bounds.top) / bounds.height * height
    };
  }, [height, region.w, region.x, region.y]);

  function scheduleDraft() {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setDraft(draftRef.current ? { ...draftRef.current, points: [...draftRef.current.points] } : null);
    });
  }

  function begin(event) {
    if (event.button > 0) return;
    if (event.pointerType === "pen") penSeenAtRef.current = Date.now();
    // A palm resting while the stylus writes is not ink.
    else if (event.pointerType === "touch" && Date.now() - penSeenAtRef.current < 1_000) return;
    if (draftRef.current || !height) return;
    event.preventDefault();
    try {
      surfaceRef.current.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser no longer tracks cannot be captured; the stroke
      // still follows its own events.
    }
    const input = controllerRef.current.begin(event.nativeEvent, {
      page: region.page,
      pageUnitsPerCssPixel: region.w / Math.max(1, box.width),
      mapClientPoint: (clientX, clientY) => toPage(clientX, clientY),
      captured: true
    });
    draftRef.current = {
      id: generateIdempotencyKey(),
      page: region.page,
      ...pen,
      ...(event.pointerType === "pen" ? {} : { pressureSource: "speed" }),
      createdAt: new Date().toISOString(),
      points: input.points
    };
    scheduleDraft();
  }

  function move(event) {
    if (!draftRef.current || !controllerRef.current.hasActivePointer(event.pointerId)) return;
    event.preventDefault();
    if (event.pointerType === "pen") penSeenAtRef.current = Date.now();
    controllerRef.current.append(event.nativeEvent);
    scheduleDraft();
  }

  function finish(event) {
    if (!draftRef.current) return;
    const session = controllerRef.current.finish(event.nativeEvent, "pointerup");
    const stroke = { ...draftRef.current, points: session?.points || draftRef.current.points };
    draftRef.current = null;
    controllerRef.current.reset();
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    setDraft(null);
    if (!stroke.points.length) return;
    onCommit(stroke);
    // Writing into the right-hand zone moves the box along the line.
    const xs = stroke.points.map((point) => point.x);
    const intoZone = rtl ? Math.min(...xs) <= region.x + region.w * ZOOM_ADVANCE_ZONE : Math.max(...xs) >= region.x + region.w * (1 - ZOOM_ADVANCE_ZONE);
    if (intoZone) onRegionChange(advanceZoomRegion(region, height, rtl));
  }

  function cancel() {
    controllerRef.current.cancel();
    controllerRef.current.reset();
    draftRef.current = null;
    setDraft(null);
  }

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);
  // The page draws the box this window shows, so it needs the box's height.
  useEffect(() => { onHeightChange?.(height); }, [height, onHeightChange]);

  const nudge = (dx, dy) => onRegionChange(clampZoomRegion({ ...region, x: region.x + dx * region.w * .5, y: region.y + dy * height * .5 }, height));
  const sizeIndex = ZOOM_WINDOW_SIZES.indexOf(region.w);
  const resize = (direction) => {
    const next = ZOOM_WINDOW_SIZES[Math.max(0, Math.min(ZOOM_WINDOW_SIZES.length - 1, (sizeIndex < 0 ? 1 : sizeIndex) + direction))];
    onRegionChange(clampZoomRegion({ ...region, w: next }, box.width ? zoomRegionHeight(next, box, pageAspect) : height));
  };

  return <section className="workspace-zoom-window" aria-label={t("focus.zoomWindow")} onPointerDown={(event) => event.stopPropagation()}>
    <div className="workspace-zoom-window-bar" role="toolbar" aria-label={t("focus.zoomWindowControls")}>
      <button type="button" aria-label={t("focus.zoomWindowLeft")} title={t("focus.zoomWindowLeft")} onClick={() => nudge(-1, 0)}><ArrowLeft size={17} /></button>
      <button type="button" aria-label={t("focus.zoomWindowRight")} title={t("focus.zoomWindowRight")} onClick={() => nudge(1, 0)}><ArrowRight size={17} /></button>
      <button type="button" aria-label={t("focus.zoomWindowUp")} title={t("focus.zoomWindowUp")} onClick={() => nudge(0, -1)}><ArrowUp size={17} /></button>
      <button type="button" aria-label={t("focus.zoomWindowDown")} title={t("focus.zoomWindowDown")} onClick={() => nudge(0, 1)}><ArrowDown size={17} /></button>
      <button type="button" className="is-return" aria-label={t("focus.zoomWindowNewLine")} title={t("focus.zoomWindowNewLine")} onClick={() => onRegionChange(nextZoomLine(region, height, rtl))}><CornerDownLeft size={17} /></button>
      <span className="workspace-zoom-window-spacer" />
      <button type="button" aria-label={t("focus.zoomWindowLess")} title={t("focus.zoomWindowLess")} disabled={sizeIndex === ZOOM_WINDOW_SIZES.length - 1} onClick={() => resize(1)}><Minus size={17} /></button>
      <button type="button" aria-label={t("focus.zoomWindowMore")} title={t("focus.zoomWindowMore")} disabled={sizeIndex === 0} onClick={() => resize(-1)}><Plus size={17} /></button>
      <button type="button" aria-label={t("focus.closeZoomWindow")} title={t("focus.closeZoomWindow")} onClick={onClose}><X size={17} /></button>
    </div>
    <div
      ref={surfaceRef}
      className="workspace-zoom-window-surface"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={(event) => { if (controllerRef.current.hasActivePointer(event.pointerId)) finish(event); }}
    >
      <canvas ref={canvasRef} className="workspace-zoom-window-page" aria-hidden="true" />
      {height > 0 && <svg className="workspace-zoom-window-ink" viewBox={`${region.x} ${region.y} ${region.w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <AnnotationVisuals annotations={annotations} prefix="zoom-window" pageAspect={pageAspect} />
        {draft && <WorkspaceAnnotation annotation={draft} draft pageAspect={pageAspect} />}
      </svg>}
      <span className="workspace-zoom-window-advance" aria-hidden="true" />
    </div>
  </section>;
}
