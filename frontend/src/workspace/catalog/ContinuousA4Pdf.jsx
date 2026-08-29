import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assetPath } from "../../lib/utils.js";
import { boundedOutputScale, pdfPageAspectRatio } from "../document/coordinateTransforms.js";
import { WORKSPACE_RENDER } from "../config.js";
import { PdfRenderQueue, pdfRenderGenerationIsCurrent } from "./pdfRenderQueue.js";
import { catalogCanvasPixelBudget } from "./renderBudget.js";

export const A4_PAGE_WIDTH = 595;
export const A4_PAGE_RATIO = 297 / 210;
export const A4_PAGE_GAP = 14;
export const MAX_A4_CANVAS_PIXELS = WORKSPACE_RENDER.maximumCatalogCanvasPixels;
export const MAX_A4_CANVAS_EDGE = WORKSPACE_RENDER.maximumCatalogCanvasEdge;

const A4_RENDER_OVERSCAN_PAGES = WORKSPACE_RENDER.catalogOverscanPages;
const RENDER_SCALE_SETTLE_MS = WORKSPACE_RENDER.renderScaleSettleMs;
const SCROLL_SETTLE_MS = WORKSPACE_RENDER.scrollSettleMs;
const CANVAS_EVICTION_MS = WORKSPACE_RENDER.catalogCanvasEvictionMs;
const SLOW_LOAD_NOTICE_MS = 15_000;

let pdfLibraryPromise;

function loadPdfLibrary() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfLibraryPromise) return pdfLibraryPromise;
  pdfLibraryPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-catalog-pdfjs="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.pdfjsLib));
      existing.addEventListener("error", () => reject(new Error("PDF reader could not be loaded.")));
      return;
    }
    const script = document.createElement("script");
    script.src = assetPath("/pdf.min.js");
    script.async = true;
    script.dataset.catalogPdfjs = "true";
    script.onload = () => window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error("PDF reader could not be initialized."));
    script.onerror = () => reject(new Error("PDF reader could not be loaded."));
    document.head.appendChild(script);
  });
  return pdfLibraryPromise;
}

/**
 * @param {number} renderZoom
 * @param {number} [devicePixelRatio]
 * @param {number} [pageAspectRatio]
 * @param {number} [maximumPixels]
 */
export function a4RenderQualityScale(renderZoom, devicePixelRatio = 1, pageAspectRatio = A4_PAGE_RATIO, maximumPixels = MAX_A4_CANVAS_PIXELS) {
  const pageHeight = A4_PAGE_WIDTH * pdfPageAspectRatio(1, pageAspectRatio);
  const budgetScale = boundedOutputScale(A4_PAGE_WIDTH, pageHeight, devicePixelRatio, renderZoom, maximumPixels);
  const limitedScale = Math.min(budgetScale, MAX_A4_CANVAS_EDGE / A4_PAGE_WIDTH, MAX_A4_CANVAS_EDGE / pageHeight);
  // Quantize only the offscreen canvas backing-store density to avoid repeated
  // raster allocations. The visual document zoom remains the exact CSS scale.
  return Math.max(1, Math.round(limitedScale * 8) / 8);
}

const A4PdfCanvas = memo(
/** @param {{ documentProxy: any, pageNumber: number, pageAspectRatio: number, renderZoom: number, shouldRender: boolean, renderRevision: number, renderController: { suspended: boolean, generation: number, scrolling: boolean }, priority: number, renderQueue: PdfRenderQueue, onPageGeometry?: (pageNumber: number, width: number, height: number) => void, onPageRendered?: (duration: number) => void, onPageOutcome?: (pageNumber: number, failed: boolean) => void }} props */
function A4PdfCanvas({ documentProxy, pageNumber, pageAspectRatio, renderZoom, shouldRender, renderRevision, renderController, priority, renderQueue, onPageGeometry, onPageRendered, onPageOutcome }) {
  const canvasRefs = useRef([null, null]);
  const visibleCanvasRef = useRef(0);
  const renderedRef = useRef({ documentProxy: null, qualityScale: 0 });
  const evictionTimerRef = useRef(null);
  const retiredCanvasRafRef = useRef(null);
  const maximumPixels = catalogCanvasPixelBudget(window.visualViewport?.width || window.innerWidth, window.matchMedia?.("(pointer: coarse)").matches);
  const qualityScale = a4RenderQualityScale(renderZoom, window.devicePixelRatio, pageAspectRatio, maximumPixels);

  useEffect(() => {
    const queueKey = `page:${pageNumber}`;
    if (evictionTimerRef.current) {
      window.clearTimeout(evictionTimerRef.current);
      evictionTimerRef.current = null;
    }
    if (renderController.suspended) return undefined;
    if (!documentProxy || !shouldRender) {
      renderQueue.cancel(queueKey);
      if (!shouldRender && renderedRef.current.documentProxy) {
        evictionTimerRef.current = window.setTimeout(() => {
          evictionTimerRef.current = null;
          if (renderController.suspended) return;
          for (const canvas of canvasRefs.current) {
            if (!canvas) continue;
            canvas.width = 0;
            canvas.height = 0;
          }
          renderedRef.current = { documentProxy: null, qualityScale: 0 };
        }, CANVAS_EVICTION_MS);
      }
      return undefined;
    }
    if (renderedRef.current.documentProxy === documentProxy
      && renderedRef.current.qualityScale >= qualityScale
      && canvasRefs.current[visibleCanvasRef.current]?.width > 0) return undefined;

    // This hidden canvas is about to become the next render target. Cancel a
    // pending retirement before PDF.js starts painting into it.
    if (retiredCanvasRafRef.current !== null) {
      cancelAnimationFrame(retiredCanvasRafRef.current);
      retiredCanvasRafRef.current = null;
    }

    const renderGeneration = renderController.generation;
    const cancelQueuedRender = renderQueue.enqueue({
      key: queueKey,
      priority,
      run: async ({ isCancelled, registerCancel }) => {
        let renderTask;
        /** @type {null | (() => void)} */
        let cancelScheduledContinuation = null;
        let backCanvasIndex = null;
        const renderStarted = window.performance.now();
        try {
          const pdfPage = await documentProxy.getPage(pageNumber);
          if (!pdfRenderGenerationIsCurrent(renderController, renderGeneration, isCancelled())) return;
          const rawViewport = pdfPage.getViewport({ scale: 1 });
          onPageGeometry?.(pageNumber, rawViewport.width, rawViewport.height);
          const pdfScale = (A4_PAGE_WIDTH / rawViewport.width) * qualityScale;
          const viewport = pdfPage.getViewport({ scale: pdfScale });
          const nextCanvasIndex = visibleCanvasRef.current === 0 ? 1 : 0;
          backCanvasIndex = nextCanvasIndex;
          const nextCanvas = canvasRefs.current[nextCanvasIndex];
          const previousCanvas = canvasRefs.current[visibleCanvasRef.current];
          if (!nextCanvas || !previousCanvas) return;
          nextCanvas.width = Math.ceil(viewport.width);
          nextCanvas.height = Math.ceil(viewport.height);
          const nextContext = nextCanvas.getContext("2d", { alpha: false });
          if (!nextContext || isCancelled()) return;
          renderTask = pdfPage.render({ canvasContext: nextContext, viewport });
          renderTask.onContinue = (continueRendering) => {
            if (!pdfRenderGenerationIsCurrent(renderController, renderGeneration, isCancelled())) {
              renderTask?.cancel();
              return;
            }
            cancelScheduledContinuation?.();
            const resume = () => {
              cancelScheduledContinuation = null;
              if (!pdfRenderGenerationIsCurrent(renderController, renderGeneration, isCancelled())) {
                renderTask?.cancel();
                return;
              }
              continueRendering();
            };
            if (renderController.scrolling) {
              // PDF.js rendering is useful during a long scroll, but it must
              // not compete with the next compositor frame. A short timer
              // lets native/custom scrolling paint first without cancelling
              // the active page or exposing an empty canvas.
              const timeoutId = window.setTimeout(resume, 32);
              cancelScheduledContinuation = () => window.clearTimeout(timeoutId);
            } else {
              const frameId = requestAnimationFrame(resume);
              cancelScheduledContinuation = () => cancelAnimationFrame(frameId);
            }
          };
          registerCancel(() => {
            cancelScheduledContinuation?.();
            cancelScheduledContinuation = null;
            renderTask?.cancel();
          });
          await renderTask.promise;
          if (!pdfRenderGenerationIsCurrent(renderController, renderGeneration, isCancelled())) return;

          // The existing canvas remains untouched and visible until PDF.js has
          // completely painted the hidden back buffer. Both class changes land
          // in one task, so the browser can never paint an empty intermediate.
          nextCanvas.style.zIndex = "2";
          nextCanvas.classList.add("is-visible");
          previousCanvas.classList.remove("is-visible");
          previousCanvas.style.zIndex = "1";
          nextCanvas.style.zIndex = "1";
          visibleCanvasRef.current = nextCanvasIndex;
          renderedRef.current = { documentProxy, qualityScale };

          // Keep the previous bitmap through the first paint of the completed
          // back buffer, then release its GPU memory. It remains available for
          // the whole render/swap but does not permanently double every page's
          // canvas memory while the user scrolls.
          retiredCanvasRafRef.current = requestAnimationFrame(() => {
            retiredCanvasRafRef.current = requestAnimationFrame(() => {
              retiredCanvasRafRef.current = null;
              if (visibleCanvasRef.current === nextCanvasIndex) {
                previousCanvas.width = 0;
                previousCanvas.height = 0;
              }
            });
          });
          onPageRendered?.(window.performance.now() - renderStarted);
          onPageOutcome?.(pageNumber, false);
        } catch (error) {
          if (!isCancelled() && error?.name !== "RenderingCancelledException") {
            console.error("Could not render PDF page", error);
            // A blank page shell with no explanation looks like missing
            // content. The reader is told, and offered the page again.
            onPageOutcome?.(pageNumber, true);
          }
        } finally {
          cancelScheduledContinuation?.();
          cancelScheduledContinuation = null;
          // A cancelled or stale render may already have allocated its full-size
          // back buffer. Never leave that invisible allocation resident.
          if (backCanvasIndex !== null && visibleCanvasRef.current !== backCanvasIndex) {
            const abandonedCanvas = canvasRefs.current[backCanvasIndex];
            if (abandonedCanvas) {
              abandonedCanvas.width = 0;
              abandonedCanvas.height = 0;
            }
          }
        }
      }
    });

    return cancelQueuedRender;
  }, [documentProxy, onPageGeometry, onPageOutcome, onPageRendered, pageNumber, priority, qualityScale, renderController, renderQueue, renderRevision, shouldRender]);

  useEffect(() => () => {
    renderQueue.cancel(`page:${pageNumber}`);
    if (evictionTimerRef.current) window.clearTimeout(evictionTimerRef.current);
    if (retiredCanvasRafRef.current !== null) cancelAnimationFrame(retiredCanvasRafRef.current);
  }, [pageNumber, renderQueue]);

  return <>
    <canvas ref={(canvas) => { canvasRefs.current[0] = canvas; }} className="workspace-v2-a4-canvas is-visible" width={0} height={0} aria-label={`PDF page ${pageNumber}`} />
    <canvas ref={(canvas) => { canvasRefs.current[1] = canvas; }} className="workspace-v2-a4-canvas" width={0} height={0} aria-hidden="true" />
  </>;
});

/**
 * Continuous PDF reader. Page shells use each PDF page's real aspect ratio,
 * with A4 only as the pre-load fallback. Only visible/overscan pages enter a
 * single prioritized PDF.js render queue.
 * @param {{
 *   pdfUrl: string,
 *   pageCount: number,
 *   visiblePageCount?: number,
 *   zoom: number,
 *   stageRef: import("react").RefObject<HTMLDivElement>,
 *   documentRootRef: import("react").RefObject<HTMLDivElement>,
 *   onPageCount: (count: number) => void,
 *   onDocumentReady?: () => void,
 *   onCurrentPageChange: (pageNumber: number) => void,
 *   renderPageOverlay: (pageNumber: number) => import("react").ReactNode,
 *   onPdfPageRendered?: (duration: number) => void
 * }} props
 */
export function ContinuousA4Pdf({
  pdfUrl,
  pageCount,
  visiblePageCount = pageCount,
  zoom,
  stageRef,
  documentRootRef,
  onPageCount,
  onDocumentReady,
  onCurrentPageChange,
  renderPageOverlay,
  onPdfPageRendered
}) {
  const [documentProxy, setDocumentProxy] = useState(null);
  const [status, setStatus] = useState("Loading PDF…");
  const [pdfError, setPdfError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadStalled, setLoadStalled] = useState(false);
  const [failedPages, setFailedPages] = useState(() => new Set());
  const [nearbyPages, setNearbyPages] = useState(() => new Set([1, 2, 3]));
  const [primaryPage, setPrimaryPage] = useState(1);
  const [renderScale, setRenderScale] = useState(zoom);
  const [renderRevision, setRenderRevision] = useState(0);
  const [defaultPageAspectRatio, setDefaultPageAspectRatio] = useState(A4_PAGE_RATIO);
  const [pageAspectRatios, setPageAspectRatios] = useState(() => new Map());
  const [stageViewport, setStageViewport] = useState(() => ({
    width: Math.max(1, stageRef.current?.clientWidth || window.innerWidth),
    height: Math.max(1, stageRef.current?.clientHeight || window.innerHeight)
  }));
  const pageElementsRef = useRef(new Map());
  const pendingPageGeometryRef = useRef(new Map());
  const pendingNearbyPagesRef = useRef(null);
  const primaryPageRef = useRef(1);
  const renderScaleRef = useRef(zoom);
  const renderTimerRef = useRef(null);
  const renderResumeRafRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const scrollingRef = useRef(false);
  const suspensionRef = useRef({ activity: false, pinch: false, scroll: false, zoom: false });
  const renderControllerRef = useRef({ suspended: false, generation: 0, scrolling: false });
  const renderQueueRef = useRef(null);
  if (!renderQueueRef.current) renderQueueRef.current = new PdfRenderQueue({ concurrency: 1 });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const publishSize = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      setStageViewport((current) => current.width === width && current.height === height ? current : { width, height });
    };
    publishSize();
    const observer = new window.ResizeObserver(publishSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);

  const notePageOutcome = useCallback((pageNumber, failed) => {
    setFailedPages((current) => {
      if (failed === current.has(pageNumber)) return current;
      const next = new Set(current);
      if (failed) next.add(pageNumber);
      else next.delete(pageNumber);
      return next;
    });
  }, []);

  const retryDocument = useCallback(() => {
    setFailedPages(new Set());
    setLoadStalled(false);
    setLoadRevision((revision) => revision + 1);
  }, []);

  /**
   * Re-runs the failed page only. The queue is keyed by page, so an existing
   * job for it is replaced rather than duplicated.
   */
  const retryPage = useCallback((pageNumber) => {
    setFailedPages((current) => {
      if (!current.has(pageNumber)) return current;
      const next = new Set(current);
      next.delete(pageNumber);
      return next;
    });
    setRenderRevision((revision) => revision + 1);
  }, []);

  const applyPageGeometry = useCallback((pageNumber, width, height) => {
    const ratio = pdfPageAspectRatio(width, height);
    if (pageNumber === 1) setDefaultPageAspectRatio((current) => Math.abs(current - ratio) < .0001 ? current : ratio);
    setPageAspectRatios((current) => {
      if (Math.abs((current.get(pageNumber) || 0) - ratio) < .0001) return current;
      const next = new Map(current);
      next.set(pageNumber, ratio);
      return next;
    });
  }, []);

  const commitPageGeometry = useCallback((pageNumber, width, height) => {
    if (renderControllerRef.current.suspended) {
      pendingPageGeometryRef.current.set(pageNumber, { width, height });
      return;
    }
    applyPageGeometry(pageNumber, width, height);
  }, [applyPageGeometry]);

  const flushPageGeometry = useCallback(() => {
    if (!pendingPageGeometryRef.current.size) return;
    const entries = [...pendingPageGeometryRef.current.entries()];
    pendingPageGeometryRef.current.clear();
    entries.forEach(([pageNumber, geometry]) => applyPageGeometry(pageNumber, geometry.width, geometry.height));
  }, [applyPageGeometry]);

  const commitPrimaryPage = useCallback((nextPage) => {
    if (!Number.isFinite(nextPage) || nextPage < 1 || primaryPageRef.current === nextPage) return;
    primaryPageRef.current = nextPage;
    setPrimaryPage(nextPage);
    onCurrentPageChange(nextPage);
  }, [onCurrentPageChange]);

  const commitNearbyPages = useCallback((nextPages) => {
    setNearbyPages((current) => {
      if (current.size === nextPages.size && [...current].every((pageNumber) => nextPages.has(pageNumber))) return current;
      return nextPages;
    });
  }, []);

  const setRenderSuspension = useCallback((reason, value, { renderOnResume = true } = {}) => {
    if (suspensionRef.current[reason] === value) return;
    suspensionRef.current[reason] = value;
    const controller = renderControllerRef.current;
    const next = Object.values(suspensionRef.current).some(Boolean);
    if (controller.suspended === next) return;
    controller.suspended = next;
    if (next) {
      controller.generation += 1;
      renderQueueRef.current?.clear();
      if (renderResumeRafRef.current !== null) cancelAnimationFrame(renderResumeRafRef.current);
      renderResumeRafRef.current = null;
      return;
    }
    renderResumeRafRef.current = requestAnimationFrame(() => {
      renderResumeRafRef.current = null;
      if (renderControllerRef.current.suspended) return;
      if (pendingNearbyPagesRef.current) {
        commitNearbyPages(pendingNearbyPagesRef.current);
        pendingNearbyPagesRef.current = null;
      }
      flushPageGeometry();
      if (renderOnResume) setRenderRevision((revision) => revision + 1);
    });
  }, [commitNearbyPages, flushPageGeometry]);

  useEffect(() => {
    if (Math.abs(renderScaleRef.current - zoom) < .001) {
      setRenderSuspension("zoom", false);
      return undefined;
    }
    let disposed = false;
    setRenderSuspension("zoom", true);
    function commitRenderScale() {
      if (disposed) return;
      const documentRoot = documentRootRef.current;
      if (documentRoot?.classList.contains("is-live-pinching") || documentRoot?.classList.contains("is-zoom-settling")) {
        renderTimerRef.current = window.setTimeout(commitRenderScale, 60);
        return;
      }
      renderScaleRef.current = zoom;
      // Resuming must always invalidate the render pass. Fit-page can change
      // the reader zoom without crossing a canvas quality-scale boundary; in
      // that case renderScale alone does not change A4PdfCanvas' dependencies
      // and every page would remain on its initial empty front buffer.
      setRenderSuspension("zoom", false);
      setRenderScale(zoom);
      renderTimerRef.current = null;
    }
    if (renderTimerRef.current) window.clearTimeout(renderTimerRef.current);
    renderTimerRef.current = window.setTimeout(commitRenderScale, RENDER_SCALE_SETTLE_MS);
    return () => {
      disposed = true;
      if (renderTimerRef.current) window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    };
  }, [documentRootRef, setRenderSuspension, zoom]);

  useEffect(() => () => {
    if (renderResumeRafRef.current !== null) cancelAnimationFrame(renderResumeRafRef.current);
  }, []);

  // React Strict Mode intentionally runs effect cleanup once during the
  // development remount check. Clearing queued work is enough here; destroying
  // the instance would leave the remounted reader with a permanently disabled
  // queue and zero-sized (white) canvases.
  useEffect(() => () => renderQueueRef.current?.clear(), []);

  useEffect(() => {
    const root = documentRootRef.current;
    if (!root) return undefined;
    const suspendRendering = () => setRenderSuspension("pinch", true);
    const resumeRendering = () => setRenderSuspension("pinch", false);
    root.addEventListener("workspace:livezoomstart", suspendRendering);
    root.addEventListener("workspace:livezoomcancel", resumeRendering);
    root.addEventListener("workspace:livezoomcommit", resumeRendering);
    return () => {
      root.removeEventListener("workspace:livezoomstart", suspendRendering);
      root.removeEventListener("workspace:livezoomcancel", resumeRendering);
      root.removeEventListener("workspace:livezoomcommit", resumeRendering);
    };
  }, [documentRootRef, setRenderSuspension]);

  useEffect(() => {
    const stage = stageRef.current;
    const documentRoot = documentRootRef.current;
    if (!stage || !documentRoot) return undefined;
    const renderController = renderControllerRef.current;
    let activityActive = false;
    const scheduleScrollSettle = () => {
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        scrollingRef.current = false;
        renderController.scrolling = false;
        scrollTimerRef.current = null;
      }, SCROLL_SETTLE_MS);
    };
    const handleScroll = () => {
      if (!scrollingRef.current) {
        scrollingRef.current = true;
        renderController.scrolling = true;
      }
      if (!activityActive) scheduleScrollSettle();
    };
    const handleActivityStart = () => {
      activityActive = true;
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
      scrollingRef.current = true;
      renderController.scrolling = true;
    };
    const handleActivityEnd = () => {
      activityActive = false;
      if (scrollingRef.current) scheduleScrollSettle();
    };
    stage.addEventListener("scroll", handleScroll, { passive: true });
    documentRoot.addEventListener("workspace:scrollactivitystart", handleActivityStart);
    documentRoot.addEventListener("workspace:scrollactivityend", handleActivityEnd);
    return () => {
      stage.removeEventListener("scroll", handleScroll);
      documentRoot.removeEventListener("workspace:scrollactivitystart", handleActivityStart);
      documentRoot.removeEventListener("workspace:scrollactivityend", handleActivityEnd);
      if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
      scrollingRef.current = false;
      renderController.scrolling = false;
    };
  }, [documentRootRef, stageRef]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask;
    async function load() {
      try {
        setStatus("Loading PDF…");
        setPdfError("");
        setDocumentProxy(null);
        setFailedPages(new Set());
        setDefaultPageAspectRatio(A4_PAGE_RATIO);
        setPageAspectRatios(new Map());
        const pdfjs = await loadPdfLibrary();
        pdfjs.GlobalWorkerOptions.workerSrc = assetPath("/pdf.worker.min.js");
        loadingTask = pdfjs.getDocument(assetPath(pdfUrl));
        const nextDocument = await loadingTask.promise;
        if (cancelled) return;
        const firstPage = await nextDocument.getPage(1);
        if (cancelled) return;
        const firstViewport = firstPage.getViewport({ scale: 1 });
        commitPageGeometry(1, firstViewport.width, firstViewport.height);
        setDocumentProxy(nextDocument);
        onPageCount(nextDocument.numPages);
        setStatus("");
      } catch (error) {
        if (!cancelled) {
          const message = error.message || "This PDF could not be displayed.";
          setPdfError(message);
          setStatus(message);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      renderQueueRef.current?.clear();
      loadingTask?.destroy();
    };
  }, [commitPageGeometry, loadRevision, onPageCount, pdfUrl]);

  useEffect(() => {
    if (documentProxy || pdfError) {
      setLoadStalled(false);
      return undefined;
    }
    // A very slow network is not an error, but the reader should never be left
    // with a spinner and no way forward.
    const timer = window.setTimeout(() => setLoadStalled(true), SLOW_LOAD_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [documentProxy, loadRevision, pdfError]);

  useEffect(() => {
    if (!documentProxy || !onDocumentReady) return undefined;
    const frame = window.requestAnimationFrame(onDocumentReady);
    return () => window.cancelAnimationFrame(frame);
  }, [documentProxy, onDocumentReady]);

  useEffect(() => {
    const stage = stageRef.current;
    const documentRoot = documentRootRef.current;
    if (!stage || !documentRoot || !pageElementsRef.current.size) return undefined;
    const renderVisibility = new Map();
    const pageRatios = new Map();
    const geometryIsLocked = () => documentRoot.classList.contains("is-live-pinching") || documentRoot.classList.contains("is-zoom-settling");
    const updateCurrentFromGeometry = () => {
      if (geometryIsLocked()) return;
      const stageBounds = stage.getBoundingClientRect();
      let bestPage = primaryPageRef.current;
      let bestVisibleArea = 0;
      pageElementsRef.current.forEach((element, pageNumber) => {
        const bounds = element.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(bounds.bottom, stageBounds.bottom) - Math.max(bounds.top, stageBounds.top));
        const visibleWidth = Math.max(0, Math.min(bounds.right, stageBounds.right) - Math.max(bounds.left, stageBounds.left));
        const visibleArea = visibleHeight * visibleWidth;
        if (visibleArea > bestVisibleArea) {
          bestVisibleArea = visibleArea;
          bestPage = pageNumber;
        }
      });
      if (bestVisibleArea > 0) commitPrimaryPage(bestPage);
    };
    const renderObserver = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => renderVisibility.set(Number(/** @type {HTMLElement} */ (entry.target).dataset.pdfPage), entry.isIntersecting));
      const nextPages = new Set();
      renderVisibility.forEach((isVisible, pageNumber) => {
        if (isVisible) nextPages.add(pageNumber);
      });
      if (!nextPages.size) return;
      if (renderControllerRef.current.suspended) pendingNearbyPagesRef.current = nextPages;
      else commitNearbyPages(nextPages);
    }, { root: stage, rootMargin: "160% 0px", threshold: 0 });
    const pageObserver = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => pageRatios.set(Number(/** @type {HTMLElement} */ (entry.target).dataset.pdfPage), entry.isIntersecting ? entry.intersectionRatio : 0));
      if (geometryIsLocked()) return;
      let currentPage = primaryPageRef.current;
      let currentRatio = 0;
      pageRatios.forEach((ratio, pageNumber) => {
        if (ratio > currentRatio) {
          currentPage = pageNumber;
          currentRatio = ratio;
        }
      });
      if (currentRatio > 0) commitPrimaryPage(currentPage);
    }, { root: stage, threshold: [0, .15, .5, .85] });
    pageElementsRef.current.forEach((element) => {
      renderObserver.observe(element);
      pageObserver.observe(element);
    });
    documentRoot.addEventListener("workspace:zoomgeometrysettled", updateCurrentFromGeometry);
    return () => {
      renderObserver.disconnect();
      pageObserver.disconnect();
      documentRoot.removeEventListener("workspace:zoomgeometrysettled", updateCurrentFromGeometry);
    };
  }, [commitNearbyPages, commitPrimaryPage, documentRootRef, pageCount, stageRef, visiblePageCount]);

  const pages = useMemo(() => Array.from({ length: Math.min(pageCount, visiblePageCount) }, (_, index) => index + 1), [pageCount, visiblePageCount]);
  const pagesToRender = useMemo(() => {
    const next = new Set(nearbyPages);
    for (let offset = -A4_RENDER_OVERSCAN_PAGES; offset <= A4_RENDER_OVERSCAN_PAGES; offset += 1) {
      const pageNumber = primaryPage + offset;
      if (pageNumber >= 1 && pageNumber <= visiblePageCount) next.add(pageNumber);
    }
    return next;
  }, [nearbyPages, visiblePageCount, primaryPage]);
  const baseDocumentHeight = useMemo(() => pages.reduce((total, pageNumber) => (
    total + A4_PAGE_WIDTH * (pageAspectRatios.get(pageNumber) || defaultPageAspectRatio)
  ), Math.max(0, pages.length - 1) * A4_PAGE_GAP), [defaultPageAspectRatio, pageAspectRatios, pages]);
  const scaledDocumentWidth = A4_PAGE_WIDTH * zoom;
  const surfaceStyle = /** @type {import("react").CSSProperties} */ ({
    "--workspace-a4-zoom": zoom,
    width: `${Math.max(scaledDocumentWidth, stageViewport.width)}px`,
    height: `${baseDocumentHeight * zoom + stageViewport.height}px`
  });
  const liveLayerStyle = /** @type {import("react").CSSProperties} */ ({
    left: `${Math.max(0, (stageViewport.width - scaledDocumentWidth) / 2)}px`,
    top: `${stageViewport.height / 2}px`,
    width: `${scaledDocumentWidth}px`,
    height: `${baseDocumentHeight * zoom}px`
  });
  const documentStyle = /** @type {import("react").CSSProperties} */ ({
    "--workspace-a4-zoom": zoom,
    "--workspace-a4-page-gap": `${A4_PAGE_GAP}px`,
    transform: `scale(${zoom})`
  });

  return (
    <div className="workspace-v2-a4-zoom-surface" style={surfaceStyle}>
      <div ref={documentRootRef} className="workspace-v2-a4-live-layer" style={liveLayerStyle} aria-busy={Boolean(status)}>
        <div className="workspace-v2-a4-document" style={documentStyle}>
        {pages.map((pageNumber) => (
          <section
            key={pageNumber}
            ref={(element) => { if (element) pageElementsRef.current.set(pageNumber, element); else pageElementsRef.current.delete(pageNumber); }}
            className="workspace-v2-a4-page"
            data-pdf-page={pageNumber}
            style={{
              width: `${A4_PAGE_WIDTH}px`,
              height: `${A4_PAGE_WIDTH * (pageAspectRatios.get(pageNumber) || defaultPageAspectRatio)}px`
            }}
            aria-label={`PDF page ${pageNumber} of ${pageCount}`}
          >
            <A4PdfCanvas
              documentProxy={documentProxy}
              pageNumber={pageNumber}
              pageAspectRatio={pageAspectRatios.get(pageNumber) || defaultPageAspectRatio}
              renderZoom={renderScale}
              shouldRender={pagesToRender.has(pageNumber)}
              renderRevision={pagesToRender.has(pageNumber) ? renderRevision : 0}
              renderController={renderControllerRef.current}
              priority={pageNumber === primaryPage ? 0 : Math.abs(pageNumber - primaryPage) * 10 + (pageNumber < primaryPage ? 1 : 0)}
              renderQueue={renderQueueRef.current}
              onPageGeometry={commitPageGeometry}
              onPageRendered={onPdfPageRendered}
              onPageOutcome={notePageOutcome}
            />
            {pagesToRender.has(pageNumber) && renderPageOverlay(pageNumber)}
            {!documentProxy && pageNumber === 1 && <div className="workspace-v2-a4-status" role={pdfError ? "alert" : "status"}>
              <p>{pdfError || (loadStalled ? "This PDF is taking longer than usual." : status)}</p>
              {(pdfError || loadStalled) && <button type="button" onClick={retryDocument}>Retry PDF</button>}
            </div>}
            {documentProxy && failedPages.has(pageNumber) && <div className="workspace-v2-a4-status" role="alert">
              <p>Page {pageNumber} could not be drawn.</p>
              <button type="button" onClick={() => retryPage(pageNumber)}>Retry page {pageNumber}</button>
            </div>}
          </section>
        ))}
        </div>
      </div>
    </div>
  );
}
