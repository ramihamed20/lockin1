import { WORKSPACE_RENDER } from "../config.js";

/** Keeps full-page PDF back buffers within mobile and tablet memory limits. */
export function catalogCanvasPixelBudget(viewportWidth, coarsePointer = false) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  if (!coarsePointer) return WORKSPACE_RENDER.maximumCatalogCanvasPixels;
  if (width <= 600) return WORKSPACE_RENDER.maximumPhoneCanvasPixels;
  if (width <= 1_200) return WORKSPACE_RENDER.maximumTabletCanvasPixels;
  return WORKSPACE_RENDER.maximumCatalogCanvasPixels;
}

/** Caps the transient handwriting canvas without reducing ordinary 1x output. */
export function inkCanvasOutputScale(cssWidth, cssHeight, devicePixelRatio = 1) {
  const width = Math.max(1, Number(cssWidth) || 1);
  const height = Math.max(1, Number(cssHeight) || 1);
  const desired = Math.min(3, Math.max(1, Number(devicePixelRatio) || 1));
  const budget = Math.sqrt(WORKSPACE_RENDER.maximumInkCanvasPixels / (width * height));
  return Math.max(1, Math.min(desired, budget));
}
