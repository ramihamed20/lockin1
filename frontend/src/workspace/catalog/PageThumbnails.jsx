import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Lock, X } from "lucide-react";
import { PdfRenderQueue } from "./pdfRenderQueue.js";
import "./PageThumbnails.css";

const CELL_WIDTH = 92;
const CELL_HEIGHT = 150;
const GAP = 8;
const OVERSCAN_ROWS = 1;
const CACHE_LIMIT = 80;
const SETTLE_MS = 140;
/** Pixel width of a thumbnail bitmap; small on purpose so it never rivals the reader's own render. */
const THUMB_PIXELS = 160;

/** Pure windowing maths, exported for tests. */
export function thumbnailWindow({ scrollTop, viewportHeight, columns, total, rowHeight = CELL_HEIGHT + GAP, overscan = OVERSCAN_ROWS }) {
  const cols = Math.max(1, columns);
  const rows = Math.ceil(total / cols);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan - 1);
  return { rows, firstRow, lastRow, first: firstRow * cols + 1, last: Math.min(total, (lastRow + 1) * cols) };
}

/**
 * Lazy page overview for the Focus reader. Only the rows in (and just around)
 * the viewport exist in the DOM, and their bitmaps come from a private
 * single-lane queue that waits for scrolling to settle, so the reader's own
 * render is never starved. Pages past `accessibleCount` are shown locked.
 */
export function PageThumbnails({ pdf, total, accessibleCount, currentPage, onJump, onClose, labels }) {
  const scrollerRef = useRef(null);
  const queueRef = useRef(null);
  const cacheRef = useRef(new Map());
  const requestedRef = useRef(new Set());
  const [size, setSize] = useState({ width: 280, height: 320 });
  const [scrollTop, setScrollTop] = useState(0);
  const [version, setVersion] = useState(0);
  const [settledWindow, setSettledWindow] = useState(null);
  const [focusPage, setFocusPage] = useState(() => Math.min(Math.max(1, currentPage), Math.max(1, accessibleCount)));
  const pendingFocusRef = useRef(false);

  const columns = Math.max(1, Math.floor((size.width + GAP) / (CELL_WIDTH + GAP)));
  const win = useMemo(
    () => thumbnailWindow({ scrollTop, viewportHeight: size.height, columns, total }),
    [scrollTop, size.height, columns, total]
  );

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const measure = () => setSize({ width: scroller.clientWidth, height: scroller.clientHeight });
    measure();
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(measure) : null;
    observer?.observe(scroller);
    return () => observer?.disconnect();
  }, []);

  // Start centred on the current page.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const row = Math.floor((focusPage - 1) / columns);
    scroller.scrollTop = Math.max(0, row * (CELL_HEIGHT + GAP) - (scroller.clientHeight - CELL_HEIGHT) / 2);
    setScrollTop(scroller.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns > 0]);

  useEffect(() => {
    const queue = new PdfRenderQueue({ concurrency: 1 });
    queueRef.current = queue;
    const cache = cacheRef.current;
    const requested = requestedRef.current;
    return () => {
      queue.destroy();
      queueRef.current = null;
      cache.clear();
      requested.clear();
    };
  }, [pdf]);

  // Wait for scrolling to settle before asking for bitmaps.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledWindow({ first: win.first, last: win.last }), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [win.first, win.last]);

  useEffect(() => {
    const queue = queueRef.current;
    if (!queue || !pdf || !settledWindow) return;
    const centre = (settledWindow.first + settledWindow.last) / 2;
    const cache = cacheRef.current;
    const requested = requestedRef.current;
    for (let pageNumber = settledWindow.first; pageNumber <= Math.min(settledWindow.last, accessibleCount, pdf.numPages); pageNumber += 1) {
      if (cache.has(pageNumber) || requested.has(pageNumber)) continue;
      requested.add(pageNumber);
      queue.enqueue({
        key: `thumb:${pageNumber}`,
        priority: Math.abs(pageNumber - centre),
        run: async (controls) => {
          let renderTask = null;
          try {
            const pdfPage = await pdf.getPage(pageNumber);
            if (controls.isCancelled()) return;
            const base = pdfPage.getViewport({ scale: 1 });
            const viewport = pdfPage.getViewport({ scale: THUMB_PIXELS / base.width });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            renderTask = pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport, background: "#ffffff" });
            controls.registerCancel(() => renderTask?.cancel?.());
            await renderTask.promise;
            if (controls.isCancelled()) return;
            cache.set(pageNumber, canvas);
            if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
            setVersion((value) => value + 1);
          } catch (error) {
            if (error?.name !== "RenderingCancelledException") console.warn("Thumbnail render failed", pageNumber);
          } finally {
            requested.delete(pageNumber);
          }
        }
      });
    }
  }, [settledWindow, pdf, accessibleCount]);

  const moveFocus = useCallback((next) => {
    const target = Math.min(total, Math.max(1, next));
    setFocusPage(target);
    const scroller = scrollerRef.current;
    if (scroller) {
      const top = Math.floor((target - 1) / columns) * (CELL_HEIGHT + GAP);
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + CELL_HEIGHT > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + CELL_HEIGHT - scroller.clientHeight;
      setScrollTop(scroller.scrollTop);
    }
    pendingFocusRef.current = true;
  }, [columns, total]);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    scrollerRef.current?.querySelector(`[data-thumb-page="${focusPage}"]`)?.focus({ preventScroll: true });
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (!scroller.contains(document.activeElement)) scroller.querySelector(`[data-thumb-page="${focusPage}"]`)?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rtl = typeof document !== "undefined" && window.getComputedStyle(scrollerRef.current || document.body).direction === "rtl";
  const onKeyDown = (event) => {
    const horizontal = rtl ? -1 : 1;
    const moves = {
      ArrowRight: horizontal, ArrowLeft: -horizontal, ArrowDown: columns, ArrowUp: -columns,
      PageDown: columns * 3, PageUp: -columns * 3
    };
    if (event.key === "Home") { event.preventDefault(); event.stopPropagation(); moveFocus(1); return; }
    if (event.key === "End") { event.preventDefault(); event.stopPropagation(); moveFocus(total); return; }
    if (moves[event.key] !== undefined) { event.preventDefault(); event.stopPropagation(); moveFocus(focusPage + moves[event.key]); }
  };

  const cells = [];
  for (let pageNumber = win.first; pageNumber <= win.last; pageNumber += 1) {
    const locked = pageNumber > accessibleCount;
    cells.push(
      <Thumb
        key={pageNumber}
        pageNumber={pageNumber}
        locked={locked}
        current={pageNumber === currentPage}
        tabbable={pageNumber === focusPage}
        bitmap={locked ? null : cacheRef.current.get(pageNumber)}
        version={version}
        label={locked ? labels.locked(pageNumber) : labels.page(pageNumber)}
        onActivate={() => { if (!locked) onJump(pageNumber); }}
        onFocus={() => setFocusPage(pageNumber)}
      />
    );
  }

  return (
    <section id="workspace-page-thumbnails" className="workspace-page-thumbs" aria-label={labels.title} onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <strong>{labels.title}</strong>
        <button type="button" className="workspace-page-thumbs-close" aria-label={labels.close} title={labels.close} onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </header>
      <div
        ref={scrollerRef}
        className="workspace-page-thumbs-scroller"
        role="grid"
        tabIndex={-1}
        aria-label={labels.title}
        aria-rowcount={win.rows}
        aria-colcount={columns}
        data-thumb-columns={columns}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div className="workspace-page-thumbs-space" style={{ height: win.rows * (CELL_HEIGHT + GAP) }}>
          <div className="workspace-page-thumbs-grid" style={{ transform: `translateY(${win.firstRow * (CELL_HEIGHT + GAP)}px)`, gridTemplateColumns: `repeat(${columns}, ${CELL_WIDTH}px)` }}>
            {cells}
          </div>
        </div>
      </div>
    </section>
  );
}

function Thumb({ pageNumber, locked, current, tabbable, bitmap, version, label, onActivate, onFocus }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
  }, [bitmap, version]);
  return (
    <button
      type="button"
      role="gridcell"
      className={`workspace-page-thumb${current ? " is-current" : ""}${locked ? " is-locked" : ""}`}
      data-thumb-page={pageNumber}
      data-thumb-state={locked ? "locked" : bitmap ? "ready" : "pending"}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      aria-disabled={locked ? "true" : undefined}
      tabIndex={tabbable ? 0 : -1}
      onClick={onActivate}
      onFocus={onFocus}
    >
      <span className="workspace-page-thumb-frame">
        {locked ? <Lock size={18} aria-hidden="true" /> : bitmap ? <canvas ref={canvasRef} aria-hidden="true" /> : null}
      </span>
      <span className="workspace-page-thumb-number" aria-hidden="true">{pageNumber}</span>
    </button>
  );
}
