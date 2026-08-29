import { WORKSPACE_ZOOM } from "../config.js";

export const MIN_WORKSPACE_ZOOM = WORKSPACE_ZOOM.minimum;
export const MAX_WORKSPACE_ZOOM = WORKSPACE_ZOOM.maximum;

export function clampWorkspaceZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_WORKSPACE_ZOOM, Math.max(MIN_WORKSPACE_ZOOM, zoom));
}

function visibleAxisScrollBounds({ contentStart, contentSize, viewportSize, scrollSize, currentScroll, edgeReveal, preserveCurrent }) {
  const viewport = Math.max(1, Number(viewportSize) || 1);
  const content = Math.max(0, Number(contentSize) || 0);
  const maximumScroll = Math.max(0, (Number(scrollSize) || 0) - viewport);
  const edge = Math.max(0, Number(edgeReveal) || 0);
  let minimum;
  let maximum;
  if (content + edge * 2 <= viewport) {
    const centered = (Number(contentStart) || 0) + content / 2 - viewport / 2;
    minimum = centered;
    maximum = centered;
  } else {
    minimum = (Number(contentStart) || 0) - edge;
    maximum = (Number(contentStart) || 0) + content - viewport + edge;
  }
  minimum = Math.min(maximumScroll, Math.max(0, minimum));
  maximum = Math.min(maximumScroll, Math.max(minimum, maximum));
  if (preserveCurrent) {
    const current = Math.min(maximumScroll, Math.max(0, Number(currentScroll) || 0));
    minimum = Math.min(minimum, current);
    maximum = Math.max(maximum, current);
  }
  return { minimum, maximum };
}

function visibleContentStartBounds({ viewportStart, viewportSize, contentSize, edgeReveal }) {
  const start = Number(viewportStart) || 0;
  const viewport = Math.max(1, Number(viewportSize) || 1);
  const content = Math.max(0, Number(contentSize) || 0);
  const edge = Math.max(0, Number(edgeReveal) || 0);
  if (content + edge * 2 <= viewport) {
    const centered = start + (viewport - content) / 2;
    return { minimum: centered, maximum: centered };
  }
  return {
    minimum: start + viewport - content - edge,
    maximum: start + edge
  };
}

/**
 * Constrains the compositor-only pinch translation against geometry at the
 * current scale. Overflow is returned separately so the caller can display a
 * small resisted edge without ever committing it to scroll state.
 */
export function constrainPinchTranslation({
  translateX,
  translateY,
  ratio,
  contentLeft,
  contentTop,
  contentWidth,
  contentHeight,
  viewportLeft,
  viewportTop,
  viewportWidth,
  viewportHeight,
  horizontalEdgeReveal = 0,
  verticalEdgeReveal = 20
}) {
  const scaleRatio = Math.max(0.001, Number(ratio) || 1);
  const rawX = Number(translateX) || 0;
  const rawY = Number(translateY) || 0;
  const left = Number(contentLeft) || 0;
  const top = Number(contentTop) || 0;
  const horizontal = visibleContentStartBounds({
    viewportStart: viewportLeft,
    viewportSize: viewportWidth,
    contentSize: (Number(contentWidth) || 0) * scaleRatio,
    edgeReveal: horizontalEdgeReveal
  });
  const vertical = visibleContentStartBounds({
    viewportStart: viewportTop,
    viewportSize: viewportHeight,
    contentSize: (Number(contentHeight) || 0) * scaleRatio,
    edgeReveal: verticalEdgeReveal
  });
  const rawLeft = left + rawX;
  const rawTop = top + rawY;
  const legalLeft = Math.min(horizontal.maximum, Math.max(horizontal.minimum, rawLeft));
  const legalTop = Math.min(vertical.maximum, Math.max(vertical.minimum, rawTop));
  return {
    translateX: legalLeft - left,
    translateY: legalTop - top,
    overflowX: rawLeft - legalLeft,
    overflowY: rawTop - legalTop,
    scaledWidth: (Number(contentWidth) || 0) * scaleRatio,
    scaledHeight: (Number(contentHeight) || 0) * scaleRatio
  };
}

/**
 * Restricts reader navigation to the document plus a small visible edge.
 * `preserveCurrent` keeps an exact focal-point pinch position from jumping,
 * while still preventing the next pan/wheel gesture from moving farther out.
 */
export function visibleDocumentScrollBounds({
  contentStartX,
  contentStartY,
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  scrollWidth,
  scrollHeight,
  currentScrollLeft = 0,
  currentScrollTop = 0,
  horizontalEdgeReveal = 0,
  verticalEdgeReveal = 20,
  preserveCurrent = true
}) {
  const horizontal = visibleAxisScrollBounds({
    contentStart: contentStartX,
    contentSize: contentWidth,
    viewportSize: viewportWidth,
    scrollSize: scrollWidth,
    currentScroll: currentScrollLeft,
    edgeReveal: horizontalEdgeReveal,
    preserveCurrent
  });
  const vertical = visibleAxisScrollBounds({
    contentStart: contentStartY,
    contentSize: contentHeight,
    viewportSize: viewportHeight,
    scrollSize: scrollHeight,
    currentScroll: currentScrollTop,
    edgeReveal: verticalEdgeReveal,
    preserveCurrent
  });
  return {
    minScrollLeft: horizontal.minimum,
    maxScrollLeft: horizontal.maximum,
    minScrollTop: vertical.minimum,
    maxScrollTop: vertical.maximum
  };
}

export function pagePointFromClient(clientX, clientY, rect, pageWidth, pageHeight) {
  const renderedWidth = Math.max(Number(rect?.width) || 0, 1);
  const renderedHeight = Math.max(Number(rect?.height) || 0, 1);
  return {
    x: Math.min(pageWidth, Math.max(0, (clientX - rect.left) * (pageWidth / renderedWidth))),
    y: Math.min(pageHeight, Math.max(0, (clientY - rect.top) * (pageHeight / renderedHeight)))
  };
}

export function normalizePagePoint(point, pageWidth, pageHeight) {
  return {
    ...point,
    x: Math.min(1, Math.max(0, Number(point.x) / Math.max(Number(pageWidth) || 0, 1))),
    y: Math.min(1, Math.max(0, Number(point.y) / Math.max(Number(pageHeight) || 0, 1)))
  };
}

export function denormalizePagePoint(point, pageWidth, pageHeight) {
  return {
    ...point,
    x: Number(point.x) * Math.max(Number(pageWidth) || 0, 1),
    y: Number(point.y) * Math.max(Number(pageHeight) || 0, 1)
  };
}

export function zoomScrollForAnchor({
  scrollLeft,
  scrollTop,
  viewportLeft,
  viewportTop,
  clientX,
  clientY,
  fromScale,
  toScale
}) {
  const startScale = Math.max(Number(fromScale) || 1, 0.001);
  const nextScale = clampWorkspaceZoom(toScale);
  const localX = clientX - viewportLeft;
  const localY = clientY - viewportTop;
  const contentX = (scrollLeft + localX) / startScale;
  const contentY = (scrollTop + localY) / startScale;
  return {
    zoom: nextScale,
    scrollLeft: Math.max(0, contentX * nextScale - localX),
    scrollTop: Math.max(0, contentY * nextScale - localY)
  };
}

export function fitWidthZoom(containerWidth, pageWidth, horizontalPadding = 32) {
  return clampWorkspaceZoom((Math.max(1, containerWidth - horizontalPadding)) / Math.max(1, pageWidth));
}

export function fitPageZoom(containerWidth, containerHeight, pageWidth, pageHeight, padding = 32) {
  const widthScale = (Math.max(1, containerWidth - padding)) / Math.max(1, pageWidth);
  const heightScale = (Math.max(1, containerHeight - padding)) / Math.max(1, pageHeight);
  return clampWorkspaceZoom(Math.min(widthScale, heightScale));
}

/**
 * @param {{ initialScale: number, initialDistance: number, currentDistance: number, minimum?: number, maximum?: number }} options
 */
export function continuousPinchScale({ initialScale, initialDistance, currentDistance, minimum = MIN_WORKSPACE_ZOOM, maximum = MAX_WORKSPACE_ZOOM }) {
  const startScale = Math.max(0.001, Number(initialScale) || 1);
  const startDistance = Math.max(0.001, Number(initialDistance) || 1);
  const distance = Math.max(0.001, Number(currentDistance) || startDistance);
  return Math.min(Number(maximum), Math.max(Number(minimum), startScale * (distance / startDistance)));
}

/** Returns the fixed, unscaled document-space point under a client focal point. */
export function documentAnchorFromClient(clientX, clientY, documentRect, scale) {
  const currentScale = Math.max(0.001, Number(scale) || 1);
  return {
    x: (Number(clientX) - Number(documentRect?.left || 0)) / currentScale,
    y: (Number(clientY) - Number(documentRect?.top || 0)) / currentScale
  };
}

/**
 * Reconciles compositor pinch geometry with the scroll container. The document
 * bounds must be measured after the final layout scale is applied but before
 * changing scrollLeft/scrollTop.
 */
export function scrollForDocumentAnchor({
  currentScrollLeft,
  currentScrollTop,
  documentLeft,
  documentTop,
  documentAnchorX,
  documentAnchorY,
  scale,
  focalClientX,
  focalClientY
}) {
  const finalScale = Math.max(0.001, Number(scale) || 1);
  return {
    scrollLeft: Math.max(0, (Number(currentScrollLeft) || 0) + Number(documentLeft || 0) + Number(documentAnchorX || 0) * finalScale - Number(focalClientX || 0)),
    scrollTop: Math.max(0, (Number(currentScrollTop) || 0) + Number(documentTop || 0) + Number(documentAnchorY || 0) * finalScale - Number(focalClientY || 0))
  };
}

export function pdfPageAspectRatio(width, height, fallback = 297 / 210) {
  const ratio = Number(height) / Number(width);
  return Number.isFinite(ratio) && ratio >= .25 && ratio <= 4 ? ratio : fallback;
}

export function midpoint(first, second) {
  return {
    x: (first.currentX + second.currentX) / 2,
    y: (first.currentY + second.currentY) / 2
  };
}

export function pointerDistance(first, second) {
  return Math.hypot(first.currentX - second.currentX, first.currentY - second.currentY);
}

export function livePinchTransform({ originX, originY, startCenter, currentCenter, fromScale, toScale }) {
  const startScale = Math.max(Number(fromScale) || 1, 0.001);
  // This transform is visual-only. Bounds belong to the gesture owner so it
  // can show a temporary elastic overshoot without changing committed zoom.
  const ratio = Math.max(Number(toScale) || startScale, 0.001) / startScale;
  return {
    ratio,
    translateX: currentCenter.x - startCenter.x + originX * (1 - ratio),
    translateY: currentCenter.y - startCenter.y + originY * (1 - ratio)
  };
}

/**
 * Reconcile a live pinch transform with scroll-based document geometry.
 * `anchorX`/`anchorY` are coordinates inside the anchor element at scale 1,
 * while the element bounds are measured after the final layout scale is set.
 */
export function scrollForElementAnchor({
  scrollLeft,
  scrollTop,
  anchorLeft,
  anchorTop,
  anchorX,
  anchorY,
  scale,
  clientX,
  clientY
}) {
  const finalScale = Math.max(Number(scale) || 1, 0.001);
  return {
    scrollLeft: Math.max(0, (Number(scrollLeft) || 0) + anchorLeft + anchorX * finalScale - clientX),
    scrollTop: Math.max(0, (Number(scrollTop) || 0) + anchorTop + anchorY * finalScale - clientY)
  };
}

export function boundedOutputScale(pageWidth, pageHeight, devicePixelRatio, renderZoom, maxPixels = 16_000_000) {
  const desired = Math.min(3, Math.max(1, Number(devicePixelRatio) || 1) * Math.max(1, Number(renderZoom) || 1));
  const pixelLimitScale = Math.sqrt(maxPixels / Math.max(1, pageWidth * pageHeight));
  return Math.max(1, Math.min(desired, pixelLimitScale));
}
