/** Shared Focus Workspace interaction and rendering limits. */
export const WORKSPACE_ZOOM = Object.freeze({
  minimum: 0.5,
  maximum: 5,
  catalogMaximum: 5,
  wheelSensitivity: 0.00075,
  wheelSettleMs: 150
});

export const WORKSPACE_GESTURE = Object.freeze({
  horizontalEdgeReveal: 0,
  verticalEdgeReveal: 20,
  pinchElasticLimit: 28,
  intentDistance: 8,
  axisLockRatio: 1.25,
  doubleTapDelayMs: 310,
  doubleTapDistance: 34,
  panSampleWindowMs: 90,
  maximumPanSamples: 18
});

export const WORKSPACE_RENDER = Object.freeze({
  renderScaleSettleMs: 140,
  scrollSettleMs: 120,
  pageOverscanPixels: 900,
  catalogOverscanPages: 2,
  catalogCanvasEvictionMs: 4_000,
  maximumCatalogCanvasPixels: 5_000_000,
  maximumPhoneCanvasPixels: 2_000_000,
  maximumTabletCanvasPixels: 3_000_000,
  maximumCatalogCanvasEdge: 3200,
  maximumStudyCanvasPixels: 10_000_000,
  maximumInkCanvasPixels: 3_500_000
});
