import { inkCanvasOutputScale } from "../catalog/renderBudget.js";

/** Bound the bitmap to the visible page, keeping page-space coordinates intact. */
export function inkCanvasViewport(width, height, page, viewport, devicePixelRatio = 1) {
  const scale = page.width / width || 1;
  const margin = 8 / scale;
  const x = Math.max(0, Math.min(width - 1, (viewport.left - page.left) / scale - margin));
  const y = Math.max(0, Math.min(height - 1, (viewport.top - page.top) / scale - margin));
  const right = Math.min(width, Math.max(x + 1, (viewport.right - page.left) / scale + margin));
  const bottom = Math.min(height, Math.max(y + 1, (viewport.bottom - page.top) / scale + margin));
  const surfaceWidth = right - x;
  const surfaceHeight = bottom - y;
  const ratio = inkCanvasOutputScale(surfaceWidth, surfaceHeight, devicePixelRatio, scale);
  const screenRatio = scale * Math.max(.01, Number(devicePixelRatio) || 1);
  if (Math.abs(ratio - screenRatio) > 1e-6) {
    return { width, height, x, y, surfaceWidth, surfaceHeight, ratio,
      pixelWidth: Math.max(1, Math.floor(surfaceWidth * ratio)),
      pixelHeight: Math.max(1, Math.floor(surfaceHeight * ratio)) };
  }
  // One bitmap pixel per screen pixel, starting on a screen pixel: anything
  // else makes the compositor resample the ink, which softens every edge.
  const dpr = screenRatio / scale;
  const snap = (start, offset) => Math.max(0, (Math.floor((offset + start * scale) * dpr) / dpr - offset) / scale);
  const snappedX = snap(x, page.left);
  const snappedY = snap(y, page.top);
  const pixelWidth = Math.max(1, Math.floor((right - snappedX) * ratio));
  const pixelHeight = Math.max(1, Math.floor((bottom - snappedY) * ratio));
  return { width, height, x: snappedX, y: snappedY, surfaceWidth: pixelWidth / ratio, surfaceHeight: pixelHeight / ratio, ratio, pixelWidth, pixelHeight };
}

/** Measure only on a new gesture or after layout/scroll/zoom invalidates it. */
export function measureInkCanvas(canvas) {
  const page = canvas.parentElement;
  const bounds = page.getBoundingClientRect();
  // clientWidth/clientHeight round away fractional page sizes. At high zoom
  // that rounding shifts live ink away from the committed SVG geometry.
  const layout = window.getComputedStyle(page);
  const width = Math.max(1, Number.parseFloat(layout.width) || page.clientWidth);
  const height = Math.max(1, bounds.height * width / Math.max(.01, bounds.width));
  const stage = canvas.closest(".workspace-v2-document-stage");
  const viewport = stage?.getBoundingClientRect() || bounds;
  return inkCanvasViewport(width, height, bounds, viewport, window.devicePixelRatio);
}

export function sizeInkCanvas(canvas, size) {
  const { x, y, surfaceWidth, surfaceHeight, pixelWidth, pixelHeight } = size;
  canvas.style.left = `${x}px`;
  canvas.style.top = `${y}px`;
  canvas.style.width = `${surfaceWidth}px`;
  canvas.style.height = `${surfaceHeight}px`;
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
}

/** The crop can move even when the page's untransformed layout size is unchanged. */
export function observeInkCanvas(canvas, invalidate) {
  const stage = canvas.closest(".workspace-v2-document-stage");
  const documentElement = canvas.closest(".workspace-v2-a4-document") || canvas.parentElement;
  const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(invalidate) : null;
  // A CSS scale changes screen density without changing the layout size seen
  // by ResizeObserver. Watch only the document style, never pointer-time DOM.
  const zoomObserver = new window.MutationObserver(invalidate);
  zoomObserver.observe(documentElement, { attributes: true, attributeFilter: ["style"] });
  observer?.observe(canvas.parentElement);
  if (stage) observer?.observe(stage);
  stage?.addEventListener("scroll", invalidate, { passive: true });
  window.addEventListener("resize", invalidate, { passive: true });
  return () => {
    observer?.disconnect();
    zoomObserver.disconnect();
    stage?.removeEventListener("scroll", invalidate);
    window.removeEventListener("resize", invalidate);
  };
}
