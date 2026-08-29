import assert from "node:assert/strict";
import test from "node:test";

import {
  boundedOutputScale,
  clampWorkspaceZoom,
  continuousPinchScale,
  constrainPinchTranslation,
  documentAnchorFromClient,
  fitPageZoom,
  livePinchTransform,
  pagePointFromClient,
  pdfPageAspectRatio,
  scrollForDocumentAnchor,
  scrollForElementAnchor,
  visibleDocumentScrollBounds,
  zoomScrollForAnchor
} from "../src/workspace/document/coordinateTransforms.js";
import {
  DRAWING_INPUT,
  GESTURE_DIRECTION,
  INTERACTION_STATE,
  classifyGestureDirection,
  interactionStateForDirection,
  lockedGestureDelta,
  lockedGestureVelocity,
  pointerCanDraw,
  suspiciousPalmContact,
  transitionInteraction
} from "../src/workspace/input/gestureStateMachine.js";
import {
  ERASER_MODE,
  PEN_PROFILE,
  createStrokeSpatialIndex,
  eraseStrokeWithPolyline,
  eraseStrokeWithPath,
  pageRadiusForScreenRadius,
  predictedSamplesFromPointerEvent,
  queryStrokeSpatialIndex,
  samplesFromPointerEvent,
  simplifyStrokePoints,
  smoothStrokePoints,
  strokeEraseCoverage,
  strokeRenderGeometry,
  strokeSampleForServer,
  strokeWidthAtPoint
} from "../src/workspace/ink/strokeModel.js";
import {
  analyzeClosedGesture,
  analyzeScribbleGesture,
  recognizeHeldStroke,
  recognizedShapeAnnotation,
  rectangleLassoPolygon
} from "../src/workspace/ink/inkGestureRecognition.js";
import { PdfRenderQueue, pdfRenderGenerationIsCurrent } from "../src/workspace/catalog/pdfRenderQueue.js";
import { catalogCanvasPixelBudget, inkCanvasOutputScale } from "../src/workspace/catalog/renderBudget.js";
import {
  advanceMomentumFrame,
  appendRecentPointerSamples,
  estimateReleaseScrollVelocity,
  momentumConfig,
  momentumVelocityForIntent
} from "../src/workspace/input/scrollMomentum.js";
import {
  addSpringImpulse,
  advanceSpring,
  elasticScale,
  elasticScrollPosition,
  resistedDistance,
  unresistedDistance
} from "../src/workspace/input/elasticGesture.js";
import {
  annotationBounds,
  annotationIntersectsPolygon,
  applyAnnotationCommand,
  createAnnotationSpatialIndex,
  parseCatalogWorkspace,
  resizeAnnotation,
  queryAnnotationSpatialIndex,
  queryAnnotationSpatialIndexBounds,
  rotateAnnotation,
  selectionBounds,
  serializeCatalogWorkspace,
  translateAnnotation
} from "../src/workspace/catalog/catalogWorkspaceState.js";
import { createInkInputController } from "../src/workspace/ink/inkInputController.js";
import { createEraserSession } from "../src/workspace/ink/eraserSession.js";

test("elastic zoom preserves legal bounds while displaying a resisted temporary overshoot", () => {
  const maximum = elasticScale(2.8, .5, 2, .2);
  assert.equal(maximum.legal, 2);
  assert.ok(maximum.display > 2 && maximum.display < 2.2);
  const minimum = elasticScale(.1, .5, 2, .08);
  assert.equal(minimum.legal, .5);
  assert.ok(minimum.display < .5 && minimum.display > .42);
});

test("elastic panning commits only legal scroll coordinates and springs to rest", () => {
  const edge = elasticScrollPosition(-160, 0, 900, 42);
  assert.equal(edge.legal, 0);
  assert.ok(edge.overshoot < 0 && edge.overshoot > -42);
  let state = { value: edge.overshoot, velocity: 0 };
  for (let frame = 0; frame < 120; frame += 1) state = advanceSpring(state, 16);
  assert.equal(state.value, 0);
  assert.equal(state.velocity, 0);
});

test("repeated elastic input preserves the in-flight physical position and velocity", () => {
  const visualOffset = resistedDistance(-42, 60);
  assert.ok(Math.abs(resistedDistance(unresistedDistance(visualOffset, 60), 60) - visualOffset) < .001);
  let axis = addSpringImpulse({ velocity: 260 }, { position: visualOffset, impulse: -420, maxPosition: 60, maxVelocity: 1_000 });
  assert.equal(axis.value, visualOffset);
  assert.equal(axis.velocity, -160);
  axis = { ...advanceSpring(axis, 16), target: 0 };
  const beforeSecondSwipe = axis.value;
  const stacked = addSpringImpulse(axis, { position: axis.value - 12, impulse: -220, maxPosition: 60, maxVelocity: 1_000 });
  assert.ok(stacked.value < beforeSecondSwipe, "the second swipe starts from the in-flight displacement, not zero");
  assert.ok(stacked.velocity < axis.velocity, "the second swipe adds impulse to the current velocity");
});

test("page coordinates remain stable when the same PDF page is visually zoomed", () => {
  const logicalSize = { width: 612, height: 792 };
  const atOneX = pagePointFromClient(356, 446, { left: 50, top: 50, width: 612, height: 792 }, logicalSize.width, logicalSize.height);
  const atTwoX = pagePointFromClient(662, 842, { left: 50, top: 50, width: 1224, height: 1584 }, logicalSize.width, logicalSize.height);
  assert.deepEqual(atOneX, { x: 306, y: 396 });
  assert.deepEqual(atTwoX, atOneX);
});

test("pinch zoom keeps the document point under the gesture midpoint", () => {
  const result = zoomScrollForAnchor({
    scrollLeft: 300,
    scrollTop: 500,
    viewportLeft: 20,
    viewportTop: 40,
    clientX: 220,
    clientY: 240,
    fromScale: 1,
    toScale: 2
  });
  assert.equal(result.zoom, 2);
  assert.equal(result.scrollLeft, 800);
  assert.equal(result.scrollTop, 1200);
});

test("pinch scale preserves arbitrary continuous values and clamps only at real limits", () => {
  const initialScale = 1;
  const initialDistance = 100;
  for (const target of [0.613, 0.937, 1.084, 1.372, 1.836, 2.478, 3.14159, 4.873]) {
    const scale = continuousPinchScale({ initialScale, initialDistance, currentDistance: initialDistance * target, minimum: 0.5, maximum: 5 });
    assert.ok(Math.abs(scale - target) < 1e-12, `${target} must not be quantized`);
  }
  assert.equal(continuousPinchScale({ initialScale, initialDistance, currentDistance: 10, minimum: 0.5, maximum: 5 }), 0.5);
  assert.equal(continuousPinchScale({ initialScale, initialDistance, currentDistance: 700, minimum: 0.5, maximum: 5 }), 5);
});

test("document-wide pinch anchors preserve all focal locations and simultaneous 2D movement", () => {
  const initialScale = 1.084;
  const finalScale = 2.478;
  const startingScrollLeft = 420;
  const startingScrollTop = 610;
  const documentRect = { left: 130, top: 90, width: 645, height: 4_800 };
  const positions = [
    [0.05, 0.03, "top-left"], [0.5, 0.03, "top-center"], [0.95, 0.03, "top-right"],
    [0.05, 0.5, "center-left"], [0.5, 0.5, "center"], [0.95, 0.5, "center-right"],
    [0.05, 0.97, "bottom-left"], [0.5, 0.97, "bottom-center"], [0.95, 0.97, "bottom-right"],
    [0.5, 842 / documentRect.height, "between-pages"], [-0.04, 0.2, "page-margin"]
  ];

  for (const [xRatio, yRatio, label] of positions) {
    const initialFocal = {
      x: documentRect.left + documentRect.width * xRatio,
      y: documentRect.top + documentRect.height * yRatio
    };
    const currentFocal = { x: initialFocal.x + 80, y: initialFocal.y - 37 };
    const anchor = documentAnchorFromClient(initialFocal.x, initialFocal.y, documentRect, initialScale);
    const next = scrollForDocumentAnchor({
      currentScrollLeft: startingScrollLeft,
      currentScrollTop: startingScrollTop,
      documentLeft: documentRect.left,
      documentTop: documentRect.top,
      documentAnchorX: anchor.x,
      documentAnchorY: anchor.y,
      scale: finalScale,
      focalClientX: currentFocal.x,
      focalClientY: currentFocal.y
    });
    const actualX = documentRect.left - (next.scrollLeft - startingScrollLeft) + anchor.x * finalScale;
    const actualY = documentRect.top - (next.scrollTop - startingScrollTop) + anchor.y * finalScale;
    assert.ok(Math.abs(actualX - currentFocal.x) < 1e-9, `${label} x focal drifted`);
    assert.ok(Math.abs(actualY - currentFocal.y) < 1e-9, `${label} y focal drifted`);
  }
});

test("live pinch transform keeps the focal content beneath moving fingers without layout", () => {
  const result = livePinchTransform({
    originX: 120,
    originY: 240,
    startCenter: { x: 180, y: 300 },
    currentCenter: { x: 195, y: 280 },
    fromScale: 1.25,
    toScale: 2
  });
  assert.equal(result.ratio, 1.6);
  assert.ok(Math.abs(result.translateX + 57) < 1e-9);
  assert.ok(Math.abs(result.translateY + 164) < 1e-9);
  assert.equal(result.translateX + 120 * result.ratio, 135);
  assert.ok(Math.abs(result.translateY + 240 * result.ratio - 220) < 1e-9);
});

test("pinch reconciliation preserves both focal zoom and midpoint translation", () => {
  const result = scrollForElementAnchor({
    scrollLeft: 280,
    scrollTop: 640,
    anchorLeft: 40,
    anchorTop: -120,
    anchorX: 260,
    anchorY: 360,
    scale: 2,
    clientX: 430,
    clientY: 300
  });
  assert.deepEqual(result, { scrollLeft: 410, scrollTop: 940 });

  const translatedOnly = scrollForElementAnchor({
    scrollLeft: 410,
    scrollTop: 940,
    anchorLeft: 20,
    anchorTop: -80,
    anchorX: 260,
    anchorY: 360,
    scale: 2,
    clientX: 470,
    clientY: 340
  });
  assert.deepEqual(translatedOnly, { scrollLeft: 480, scrollTop: 1240 });
});

test("zoom and render scales are bounded for interaction and tablet memory safety", () => {
  assert.equal(clampWorkspaceZoom(0.1), 0.5);
  assert.equal(clampWorkspaceZoom(8), 5);
  assert.equal(fitPageZoom(1000, 800, 600, 1200, 40), 0.6333333333333333);
  const outputScale = boundedOutputScale(1200, 1600, 3, 5, 4_000_000);
  assert.ok(outputScale <= Math.sqrt(4_000_000 / (1200 * 1600)));
});

test("touch devices use bounded PDF raster budgets while desktop keeps full quality", () => {
  assert.equal(catalogCanvasPixelBudget(390, true), 2_000_000);
  assert.equal(catalogCanvasPixelBudget(834, true), 3_000_000);
  assert.equal(catalogCanvasPixelBudget(1_440, false), 5_000_000);
});

test("high-DPR handwriting canvases stay inside the shared GPU memory budget", () => {
  const tabletScale = inkCanvasOutputScale(834, 1180, 3);
  assert.ok(834 * 1180 * tabletScale ** 2 <= 3_500_000 + 1);
  assert.ok(tabletScale < 3);
  assert.equal(inkCanvasOutputScale(390, 560, 2.75), 2.75);
});

test("PDF page geometry follows the page viewport while retaining an A4 fallback", () => {
  assert.equal(pdfPageAspectRatio(595, 842), 842 / 595);
  assert.equal(pdfPageAspectRatio(842, 595), 595 / 842);
  assert.equal(pdfPageAspectRatio(0, 0), 297 / 210);
  assert.equal(pdfPageAspectRatio(1, 20), 297 / 210);
});

test("the interaction state machine prevents drawing and panning from running together", () => {
  assert.equal(transitionInteraction(INTERACTION_STATE.IDLE, INTERACTION_STATE.DRAWING), INTERACTION_STATE.DRAWING);
  assert.equal(transitionInteraction(INTERACTION_STATE.IDLE, INTERACTION_STATE.NATIVE_SCROLL), INTERACTION_STATE.NATIVE_SCROLL);
  assert.equal(transitionInteraction(INTERACTION_STATE.NATIVE_SCROLL, INTERACTION_STATE.PINCHING), INTERACTION_STATE.PINCHING);
  assert.equal(transitionInteraction(INTERACTION_STATE.DRAWING, INTERACTION_STATE.PANNING), INTERACTION_STATE.DRAWING);
  assert.equal(transitionInteraction(INTERACTION_STATE.DRAWING, INTERACTION_STATE.PINCHING), INTERACTION_STATE.PINCHING);
  assert.equal(transitionInteraction(INTERACTION_STATE.PANNING, INTERACTION_STATE.MOMENTUM), INTERACTION_STATE.MOMENTUM);
  assert.equal(transitionInteraction(INTERACTION_STATE.MOMENTUM, INTERACTION_STATE.PINCHING), INTERACTION_STATE.PINCHING);
  assert.equal(transitionInteraction(INTERACTION_STATE.PINCHING, INTERACTION_STATE.PANNING), INTERACTION_STATE.PINCHING);
  assert.equal(transitionInteraction(INTERACTION_STATE.PINCHING, INTERACTION_STATE.SETTLING), INTERACTION_STATE.SETTLING);
  assert.equal(transitionInteraction(INTERACTION_STATE.PINCHING, INTERACTION_STATE.SPRING_BACK), INTERACTION_STATE.SPRING_BACK);
  assert.equal(transitionInteraction(INTERACTION_STATE.SPRING_BACK, INTERACTION_STATE.PANNING), INTERACTION_STATE.PANNING);
  assert.equal(transitionInteraction(INTERACTION_STATE.SETTLING, INTERACTION_STATE.PANNING), INTERACTION_STATE.SETTLING);
  assert.equal(transitionInteraction(INTERACTION_STATE.SETTLING, INTERACTION_STATE.IDLE), INTERACTION_STATE.IDLE);
});

test("single-finger PDF intent waits for a threshold and then preserves free-angle motion", () => {
  assert.equal(classifyGestureDirection(4, 5), GESTURE_DIRECTION.PENDING);
  assert.equal(classifyGestureDirection(7, 36, { allowFreePan: true }), GESTURE_DIRECTION.FREE);
  assert.equal(classifyGestureDirection(40, 8, { allowFreePan: true }), GESTURE_DIRECTION.FREE);
  assert.equal(classifyGestureDirection(24, 22, { allowFreePan: false }), GESTURE_DIRECTION.VERTICAL);
  assert.equal(interactionStateForDirection(GESTURE_DIRECTION.VERTICAL), INTERACTION_STATE.VERTICAL_SCROLL);
  assert.equal(interactionStateForDirection(GESTURE_DIRECTION.HORIZONTAL), INTERACTION_STATE.HORIZONTAL_PAN);
  assert.equal(interactionStateForDirection(GESTURE_DIRECTION.FREE), INTERACTION_STATE.FREE_PAN);
});

test("free-angle panning preserves both translation and momentum components", () => {
  assert.deepEqual(lockedGestureDelta(GESTURE_DIRECTION.VERTICAL, 9, -84), { x: 0, y: -84 });
  assert.deepEqual(lockedGestureDelta(GESTURE_DIRECTION.HORIZONTAL, 92, -7), { x: 92, y: 0 });
  assert.deepEqual(lockedGestureDelta(GESTURE_DIRECTION.FREE, 32, -28), { x: 32, y: -28 });
  assert.deepEqual(lockedGestureDelta(GESTURE_DIRECTION.PENDING, 6, -7), { x: 0, y: 0 });
  assert.deepEqual(lockedGestureVelocity(GESTURE_DIRECTION.VERTICAL, { x: 0.42, y: 3.5 }), { x: 0, y: 3.5, speed: 3.5 });
  assert.deepEqual(lockedGestureVelocity(GESTURE_DIRECTION.VERTICAL, { x: -8.2, y: 3.5 }), { x: 0, y: 3.5, speed: 3.5 });
  assert.deepEqual(lockedGestureVelocity(GESTURE_DIRECTION.HORIZONTAL, { x: -2.25, y: 0.38 }), { x: -2.25, y: 0, speed: 2.25 });
  assert.deepEqual(lockedGestureVelocity(GESTURE_DIRECTION.FREE, { x: -2.25, y: 3.5 }), { x: -2.25, y: 3.5, speed: Math.hypot(2.25, 3.5) });
});

test("pinch translation uses current scaled geometry and bounds elastic overflow", () => {
  const large = constrainPinchTranslation({
    translateX: 900,
    translateY: -900,
    ratio: 0.75,
    contentLeft: 100,
    contentTop: 80,
    contentWidth: 1200,
    contentHeight: 1600,
    viewportLeft: 0,
    viewportTop: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    horizontalEdgeReveal: 0,
    verticalEdgeReveal: 20
  });
  assert.equal(large.translateX, -100);
  assert.equal(large.translateY, -700);
  assert.equal(large.overflowX, 1000);
  assert.equal(large.overflowY, -200);

  const small = constrainPinchTranslation({
    translateX: 500,
    translateY: -500,
    ratio: 0.5,
    contentLeft: 100,
    contentTop: 100,
    contentWidth: 600,
    contentHeight: 800,
    viewportLeft: 0,
    viewportTop: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    horizontalEdgeReveal: 0,
    verticalEdgeReveal: 20
  });
  assert.equal(small.translateX, 150);
  assert.equal(small.translateY, 0);
  assert.equal(small.overflowX, 350);
  assert.equal(small.overflowY, -500);
});

test("release velocity uses recent weighted pointer samples and ignores an old gesture start", () => {
  const samples = [{ x: 100, y: 600, time: 0 }, { x: 100, y: 590, time: 140 }];
  appendRecentPointerSamples(samples, [
    { x: 100, y: 570, time: 150 },
    { x: 100, y: 540, time: 160 },
    { x: 100, y: 500, time: 170 }
  ]);
  const velocity = estimateReleaseScrollVelocity(samples, 178);
  assert.ok(velocity.y > 2.5);
  assert.equal(velocity.x, 0);
  assert.deepEqual(estimateReleaseScrollVelocity(samples, 260), { x: 0, y: 0, speed: 0 });
});

test("scroll intent keeps slow drags precise while fast flicks cross multiple A4 pages", () => {
  const config = momentumConfig({ viewportWidth: 390 });
  const slow = momentumVelocityForIntent({ x: 0, y: 0.2 }, config);
  const medium = momentumVelocityForIntent({ x: 0, y: 1.22 }, config);
  const fast = momentumVelocityForIntent({ x: 0, y: 3.71 }, config);
  const veryFast = momentumVelocityForIntent({ x: 0, y: 12 }, config);
  const reduced = momentumVelocityForIntent({ x: 0, y: 4 }, momentumConfig({ viewportWidth: 390, reducedMotion: true }));
  assert.equal(slow.band, "precise");
  assert.equal(slow.speed, 0);
  assert.equal(medium.band, "medium");
  assert.equal(fast.band, "high");
  assert.equal(veryFast.speed, config.maxVelocity);
  assert.equal(reduced.speed, 0);

  function projectedDistance(velocity) {
    let state = { scrollLeft: 0, scrollTop: 0, velocityX: velocity.x, velocityY: velocity.y };
    for (let frame = 0; state.active !== false && frame < 500; frame += 1) {
      state = advanceMomentumFrame(state, 16, config, { maxScrollLeft: 0, maxScrollTop: 20_000 });
    }
    return state.scrollTop;
  }
  assert.ok(projectedDistance(medium) > 600 && projectedDistance(medium) < 900);
  assert.ok(projectedDistance(fast) > 3_500);
  assert.ok(projectedDistance(veryFast) > 6_000 && projectedDistance(veryFast) < 7_000);
});

test("momentum clamps at document bounds and stops that axis", () => {
  const config = momentumConfig({ viewportWidth: 820 });
  const next = advanceMomentumFrame({ scrollLeft: 0, scrollTop: 995, velocityX: 0, velocityY: 4 }, 16, config, { maxScrollLeft: 0, maxScrollTop: 1000 });
  assert.equal(next.scrollTop, 1000);
  assert.equal(next.velocityY, 0);
  assert.equal(next.active, false);
});

test("reader bounds stop at physical horizontal edges while preserving vertical reveal", () => {
  const bounds = visibleDocumentScrollBounds({
    contentStartX: 400,
    contentStartY: 300,
    contentWidth: 1200,
    contentHeight: 2400,
    viewportWidth: 800,
    viewportHeight: 600,
    scrollWidth: 2000,
    scrollHeight: 3000,
    horizontalEdgeReveal: 0,
    verticalEdgeReveal: 20,
    preserveCurrent: false
  });
  assert.deepEqual(bounds, { minScrollLeft: 400, maxScrollLeft: 800, minScrollTop: 280, maxScrollTop: 2120 });
});

test("reader bounds keep a small PDF centered and preserve an exact pinch position", () => {
  const centered = visibleDocumentScrollBounds({
    contentStartX: 400,
    contentStartY: 300,
    contentWidth: 300,
    contentHeight: 400,
    viewportWidth: 800,
    viewportHeight: 600,
    scrollWidth: 1100,
    scrollHeight: 1000,
    horizontalEdgeReveal: 0,
    verticalEdgeReveal: 20,
    preserveCurrent: false
  });
  assert.deepEqual(centered, { minScrollLeft: 150, maxScrollLeft: 150, minScrollTop: 200, maxScrollTop: 200 });
  const preserved = visibleDocumentScrollBounds({
    contentStartX: 400,
    contentStartY: 300,
    contentWidth: 300,
    contentHeight: 400,
    viewportWidth: 800,
    viewportHeight: 600,
    scrollWidth: 1100,
    scrollHeight: 1000,
    currentScrollLeft: 90,
    currentScrollTop: 260,
    horizontalEdgeReveal: 0,
    verticalEdgeReveal: 20
  });
  assert.deepEqual(preserved, { minScrollLeft: 90, maxScrollLeft: 150, minScrollTop: 200, maxScrollTop: 260 });
});

test("momentum respects non-zero reader minimum bounds", () => {
  const config = momentumConfig({ viewportWidth: 820 });
  const next = advanceMomentumFrame({ scrollLeft: 205, scrollTop: 305, velocityX: -4, velocityY: -4 }, 16, config, {
    minScrollLeft: 200,
    maxScrollLeft: 800,
    minScrollTop: 300,
    maxScrollTop: 1200
  });
  assert.equal(next.scrollLeft, 200);
  assert.equal(next.scrollTop, 300);
  assert.equal(next.active, false);
});

test("PDF render work is prioritized and serialized", async () => {
  const queue = new PdfRenderQueue({ concurrency: 1 });
  const order = [];
  let active = 0;
  let maxActive = 0;
  const run = (pageNumber) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(pageNumber);
    await Promise.resolve();
    active -= 1;
  };
  queue.enqueue({ key: "page:4", priority: 10, run: run(4) });
  queue.enqueue({ key: "page:3", priority: 0, run: run(3) });
  queue.enqueue({ key: "page:2", priority: 11, run: run(2) });
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.deepEqual(order, [3, 4, 2]);
  assert.equal(maxActive, 1);
  queue.destroy();
});

test("replacing a queued PDF render cancels the stale job", async () => {
  const queue = new PdfRenderQueue({ concurrency: 1 });
  let staleRan = false;
  let latestRan = false;
  queue.enqueue({ key: "page:3", priority: 5, run: async () => { staleRan = true; } });
  queue.enqueue({ key: "page:3", priority: 0, run: async () => { latestRan = true; } });
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(staleRan, false);
  assert.equal(latestRan, true);
  queue.destroy();
});

test("a suspended or superseded PDF render can never replace the visible canvas", () => {
  const controller = { suspended: false, generation: 7 };
  assert.equal(pdfRenderGenerationIsCurrent(controller, 7), true);
  controller.suspended = true;
  assert.equal(pdfRenderGenerationIsCurrent(controller, 7), false);
  controller.suspended = false;
  controller.generation = 8;
  assert.equal(pdfRenderGenerationIsCurrent(controller, 7), false);
  assert.equal(pdfRenderGenerationIsCurrent(controller, 8, true), false);
});

test("drawing input defaults separate stylus and finger intent", () => {
  assert.equal(pointerCanDraw("pen", DRAWING_INPUT.STYLUS_ONLY), true);
  assert.equal(pointerCanDraw("mouse", DRAWING_INPUT.STYLUS_ONLY), true);
  assert.equal(pointerCanDraw("touch", DRAWING_INPUT.STYLUS_ONLY), false);
  assert.equal(pointerCanDraw("touch", DRAWING_INPUT.STYLUS_AND_FINGER), true);
});

test("palm filtering rejects a nearby broad contact but preserves a second intentional touch", () => {
  const broadContact = { pointerType: "touch", width: 32, height: 18, clientX: 130, clientY: 120 };
  assert.equal(suspiciousPalmContact({
    event: broadContact,
    activePenCount: 0,
    lastPenAt: 900,
    lastPenPosition: { x: 100, y: 100 },
    now: 1000,
    activeTouchCount: 0
  }), true);
  assert.equal(suspiciousPalmContact({
    event: broadContact,
    activePenCount: 1,
    lastPenAt: 900,
    lastPenPosition: { x: 100, y: 100 },
    now: 1000,
    activeTouchCount: 1
  }), false);
  assert.equal(suspiciousPalmContact({
    event: { pointerType: "touch", width: 8, height: 8, clientX: 320, clientY: 320 },
    activePenCount: 1,
    lastPenAt: 990,
    lastPenPosition: { x: 100, y: 100 },
    now: 1000,
    activeTouchCount: 0
  }), false);
});

test("coalesced samples retain progressive stylus data and serialize to the backend contract", () => {
  const event = {
    pointerType: "pen",
    getCoalescedEvents: () => [{
      clientX: 125,
      clientY: 250,
      timeStamp: 42,
      pressure: 0.7,
      tiltX: 12,
      tiltY: -8,
      altitudeAngle: 0.8,
      azimuthAngle: 1.2,
      twist: 30,
      tangentialPressure: 0.1,
      width: 3.5,
      height: 2.5,
      isPrimary: true,
      pointerType: "pen"
    }]
  };
  const [sample] = samplesFromPointerEvent(event, (x, y) => ({ x, y }));
  assert.equal(sample.pressure, undefined);
  assert.equal(sample.p, 0.7);
  assert.equal(sample.pressureAvailable, true);
  assert.equal(sample.contactWidth, 3.5);
  assert.equal(sample.contactHeight, 2.5);
  assert.equal(sample.tiltX, 12);
  assert.equal(sample.altitudeAngle, 0.8);
  assert.deepEqual(strokeSampleForServer(sample, 500, 1000), {
    x: 0.25,
    y: 0.25,
    pointer: "pen",
    pressure: 0.7,
    tiltX: 12,
    tiltY: -8,
    timestamp: 42
  });
});

test("predicted pointer samples stay in a separate display-only stream", () => {
  const event = {
    pointerType: "pen",
    pointerId: 9,
    getPredictedEvents: () => [{ clientX: 80, clientY: 90, timeStamp: 50, pressure: .6, pointerType: "pen" }]
  };
  const predicted = predictedSamplesFromPointerEvent(event, (x, y) => ({ x, y }));
  assert.equal(predicted.length, 1);
  assert.equal(predicted[0].x, 80);
  assert.equal(predicted[0].p, .6);
  assert.deepEqual(predictedSamplesFromPointerEvent({ pointerType: "pen" }, (x, y) => ({ x, y })), []);
});

function inkPointer({ x, y, time, pressure = .5, buttons = 1, pointerId = 7, pointerType = "pen", coalesced = null, predicted = null }) {
  return {
    clientX: x,
    clientY: y,
    timeStamp: time,
    pressure,
    buttons,
    pointerId,
    pointerType,
    width: 2,
    height: 2,
    isPrimary: true,
    getCoalescedEvents: coalesced ? () => coalesced : undefined,
    getPredictedEvents: predicted ? () => predicted : undefined
  };
}

test("ink session appends the final pointerup sample, rejects invalid data, and interpolates large gaps", () => {
  const controller = createInkInputController();
  const mapCalls = [];
  const first = inkPointer({ x: 0, y: 0, time: 1, pressure: .4 });
  const begun = controller.begin(first, {
    page: 3,
    pageUnitsPerCssPixel: 1,
    mapClientPoint: (x, y, page) => { mapCalls.push(page); return { x, y }; },
    debug: true,
    captured: true
  });
  const move = inkPointer({
    x: 30,
    y: 0,
    time: 10,
    pressure: 0,
    coalesced: [
      inkPointer({ x: Number.NaN, y: 0, time: 5, pressure: .5 }),
      inkPointer({ x: 30, y: 0, time: 10, pressure: 0 })
    ]
  });
  controller.append(move);
  const finished = controller.finish(inkPointer({ x: 36, y: 2, time: 12, pressure: 0, buttons: 0 }));
  assert.equal(begun.points.at(-1).x, 36, "the controller-owned draft buffer is updated in place");
  assert.equal(finished.points.at(-1).x, 36);
  assert.equal(finished.points.at(-1).y, 2);
  assert.ok(finished.points.length >= 7, "the large gap is filled before rendering");
  assert.ok(finished.points.every((point) => Number.isFinite(point.x) && point.page === 3));
  assert.ok(finished.points.every((point) => Math.abs(point.p - .4) < .001), "transient and lift-time zero pressure retain the last reliable value");
  assert.ok(mapCalls.every((page) => page === 3), "the gesture remains pinned to its starting page");
  assert.equal(controller.getDiagnostics().reason, "pointerup");
  assert.equal(controller.finish(inkPointer({ x: 40, y: 2, time: 13, pointerId: 7 })), null, "a session cannot finish twice");
});

test("lost pointer capture finalizes once and predicted samples never enter committed ink", () => {
  const controller = createInkInputController();
  controller.begin(inkPointer({ x: 4, y: 5, time: 1, pointerId: 9, pointerType: "mouse" }), {
    page: 2,
    mapClientPoint: (x, y) => ({ x, y })
  });
  const predictionEvent = inkPointer({
    x: 8,
    y: 5,
    time: 2,
    pointerId: 9,
    pointerType: "mouse",
    predicted: [inkPointer({ x: 80, y: 50, time: 3, pointerId: 9, pointerType: "mouse" })]
  });
  assert.equal(controller.predicted(predictionEvent)[0].x, 80);
  const finished = controller.lostCapture(inkPointer({ x: 12, y: 5, time: 4, pointerId: 9, pointerType: "mouse", buttons: 0 }));
  assert.equal(finished.reason, "lostpointercapture");
  assert.equal(finished.points.at(-1).x, 12);
  assert.equal(finished.points.some((point) => point.x === 80), false);
  assert.equal(controller.lostCapture(inkPointer({ x: 14, y: 5, time: 5, pointerId: 9, pointerType: "mouse" })), null);
});

test("stroke geometry uses connected round subpaths and stays identical between preview and commit", () => {
  const points = [
    { x: 10, y: 10, t: 0, p: .3, pointer: "pen", pressureAvailable: true },
    { x: 40, y: 10, t: 8, p: .7, pointer: "pen", pressureAvailable: true },
    { x: 40, y: 44, t: 16, p: .45, pointer: "pen", pressureAvailable: true },
    { x: 18, y: 46, t: 24, p: .6, pointer: "pen", pressureAvailable: true }
  ];
  const preview = { id: "preview", page: 1, type: "pen", profile: PEN_PROFILE.FOUNTAIN, color: "#111", width: 8, opacity: 1, points };
  const committed = { ...preview, points: points.map((point) => ({ ...point })) };
  const liveGeometry = strokeRenderGeometry(preview);
  const committedGeometry = strokeRenderGeometry(committed);
  assert.equal(liveGeometry.kind, "outline");
  assert.equal(liveGeometry.path, committedGeometry.path);
  assert.ok((liveGeometry.path.match(/ A/g) || []).length >= points.length * 2, "every join has a round disc in the compound fill");
  assert.equal(/NaN|Infinity/.test(liveGeometry.path), false);
});

test("scribble coverage rejects one incidental crossing but accepts repeated intersections", () => {
  const target = {
    id: "target",
    page: 1,
    type: "pen",
    profile: PEN_PROFILE.BALL,
    color: "#111",
    width: 4,
    opacity: 1,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
  };
  const incidental = strokeEraseCoverage(target, [{ x: 50, y: -12 }, { x: 50, y: 12 }], 2);
  const repeated = strokeEraseCoverage(target, [{ x: 35, y: -12 }, { x: 35, y: 12 }, { x: 70, y: 12 }, { x: 70, y: -12 }], 2);
  assert.equal(incidental.intersectionRuns, 1);
  assert.ok(incidental.coverage < .12);
  assert.ok(repeated.intersectionRuns >= 2);
});

test("eraser session previews fragments and commits one atomic replace command", () => {
  let nextId = 0;
  const original = {
    id: "stroke-1",
    page: 1,
    type: "pen",
    profile: PEN_PROFILE.BALL,
    color: "#7650ed",
    width: 4,
    opacity: 1,
    points: Array.from({ length: 21 }, (_, index) => ({ x: index * 5, y: 50, t: index, p: .5 }))
  };
  const session = createEraserSession({ idFactory: () => `fragment-${++nextId}` });
  session.begin({ x: 50, y: 35 }, 1);
  const appended = session.append({ x: 50, y: 65 }, { annotationPage: 1, candidates: [original], radius: 5, mode: ERASER_MODE.PRECISION });
  const preview = session.getPreview();
  assert.equal(appended.changed, true);
  assert.deepEqual(preview.hiddenIds, [original.id]);
  assert.equal(preview.annotations.length, 2);
  const { command, replacements } = session.finish();
  assert.equal(command.type, "replace");
  assert.equal(command.before.length, 1);
  assert.equal(command.after.length, 2);
  assert.deepEqual(command.after.map((fragment) => fragment.color), [original.color, original.color]);
  assert.deepEqual(replacements.get(original.id).map((fragment) => fragment.id), command.after.map((fragment) => fragment.id));
  const redone = applyAnnotationCommand([original], command, "redo");
  assert.deepEqual(applyAnnotationCommand(redone, command, "undo"), [original]);
});

test("a long eraser drag is clipped once from the immutable stroke without fragment growth", () => {
  const original = {
    id: "long-stroke",
    page: 1,
    type: "pencil",
    profile: PEN_PROFILE.PENCIL,
    color: "#8b5cf6",
    width: 5,
    opacity: 1,
    points: Array.from({ length: 501 }, (_, index) => ({ x: index * 2, y: 300, t: index, p: .5 }))
  };
  const path = Array.from({ length: 181 }, (_, index) => ({ x: 500 + Math.sin(index * .3) * 2, y: 220 + index * .9 }));
  const clipped = eraseStrokeWithPolyline(original, path, 7, ERASER_MODE.PRECISION, () => "right-fragment");
  assert.equal(clipped.changed, true);
  assert.equal(clipped.fragments.length, 2);
  assert.ok(clipped.fragments.reduce((count, fragment) => count + fragment.points.length, 0) < 700);

  const session = createEraserSession({ idFactory: () => "session-right" });
  session.begin(path[0], 1);
  for (let index = 1; index < path.length; index += 1) {
    session.append(path[index], { annotationPage: 1, candidates: [original], radius: 7, mode: ERASER_MODE.PRECISION });
  }
  const preview = session.getPreview();
  assert.equal(preview.annotations.length, 2);
  assert.ok(preview.annotations.reduce((count, fragment) => count + fragment.points.length, 0) < 700);
  assert.equal(session.getDiagnostics().pathPointCount, path.length);
});

test("opaque pen geometry keeps one stable color while translucent tools stay isolated", () => {
  const points = [
    { x: 100, y: 200, p: .2, t: 0, pointer: "pen", pressureAvailable: true },
    { x: 500, y: 200, p: .8, t: 20, pointer: "pen", pressureAvailable: true }
  ];
  const pen = { id: "blue", type: "pen", profile: PEN_PROFILE.BALL, color: "#239ed1", width: 8, opacity: .2, pressureSensitivity: .6, points };
  const first = strokeRenderGeometry(pen);
  assert.equal(first.kind, "outline");
  assert.equal(first.opacity, 1);
  assert.equal(first.composite, "source-over");
  for (let repeat = 0; repeat < 10; repeat += 1) assert.deepEqual(strokeRenderGeometry({ ...pen }), first);

  const highlighter = strokeRenderGeometry({ ...pen, type: "highlighter", profile: PEN_PROFILE.HIGHLIGHTER, opacity: .34 });
  assert.equal(highlighter.kind, "centerline");
  assert.equal(highlighter.opacity, .34);
  assert.equal(highlighter.composite, "multiply");
});

test("stroke smoothing reaches the last real sample and adapts without delayed catch-up", () => {
  const points = [
    { x: 10, y: 10, t: 0 },
    { x: 20, y: 12, t: 10 },
    { x: 55, y: 40, t: 18 },
    { x: 90, y: 45, t: 24 }
  ];
  const smoothed = smoothStrokePoints(points);
  assert.deepEqual(smoothed[0], points[0]);
  assert.deepEqual(smoothed.at(-1), points.at(-1));
  assert.notDeepEqual(smoothed[1], points[1]);
});

test("pen profiles produce different pressure and taper while pencil stays single-pass", () => {
  const previous = { x: 0, y: 0, p: .2, t: 0, pointer: "pen", pressureAvailable: true };
  const point = { x: 30, y: 2, p: .92, t: 8, pointer: "pen", pressureAvailable: true, tiltX: 48, tiltY: 12 };
  const next = { x: 75, y: 3, p: .92, t: 14, pointer: "pen", pressureAvailable: true };
  const context = { previous, next, index: 4, count: 10 };
  const ballWidth = strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.BALL, width: 8, pressureSensitivity: 1 }, point, context);
  const fountainWidth = strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.FOUNTAIN, width: 8, pressureSensitivity: 1 }, point, context);
  const brushWidth = strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.BRUSH, width: 8, pressureSensitivity: 1 }, point, context);
  assert.ok(fountainWidth > ballWidth);
  assert.ok(brushWidth > fountainWidth);
  const brushEnd = strokeWidthAtPoint({ type: "pen", profile: PEN_PROFILE.BRUSH, width: 8, pressureSensitivity: 1 }, point, { ...context, index: 9 });
  assert.ok(brushEnd < brushWidth * .6);
  const pencil = strokeRenderGeometry({ type: "pencil", profile: PEN_PROFILE.PENCIL, width: 8, opacity: 1, points: [previous, point, next] });
  assert.equal(pencil.texture, undefined);
  assert.equal(pencil.opacity, 1);
  assert.equal(pencil.composite, "source-over");
});

test("scribble recognition uses multiple signals and rejects fast repeated handwriting", () => {
  const scribble = Array.from({ length: 72 }, (_, index) => ({
    x: 120 + Math.sin(index * 1.47) * 82,
    y: 110 + Math.sin(index * 2.31) * 48,
    t: index * 5
  }));
  const recognized = analyzeScribbleGesture(scribble);
  assert.equal(recognized.recognized, true);
  assert.ok(recognized.signals.intersections >= 3);
  assert.ok(recognized.signals.changes >= 7);

  const handwriting = Array.from({ length: 42 }, (_, index) => ({
    x: 20 + index * 6,
    y: 100 + Math.abs(Math.sin(index * Math.PI / 4)) * 28,
    t: index * 4
  }));
  assert.equal(analyzeScribbleGesture(handwriting).recognized, false);
});

test("draw-and-hold recognizes a rough line and closed ellipse without changing ordinary curved writing", () => {
  const roughLine = Array.from({ length: 18 }, (_, index) => ({ x: 40 + index * 18, y: 220 + Math.sin(index * .8) * 2.2, t: index * 12 }));
  const line = recognizeHeldStroke(roughLine);
  assert.equal(line.kind, "line");
  const raw = { id: "held", page: 1, type: "pen", profile: PEN_PROFILE.FOUNTAIN, color: "#239ed1", width: 6, opacity: 1, points: roughLine };
  const shape = recognizedShapeAnnotation(raw, line);
  assert.equal(shape.type, "shape");
  assert.equal(shape.shape, "line");
  const replacement = { type: "replace", before: [raw], after: [shape] };
  assert.deepEqual(applyAnnotationCommand([], replacement, "redo"), [shape]);
  assert.deepEqual(applyAnnotationCommand([shape], replacement, "undo"), [raw]);

  const ellipse = Array.from({ length: 33 }, (_, index) => {
    const angle = index / 32 * Math.PI * 2;
    return { x: 300 + Math.cos(angle) * 90, y: 340 + Math.sin(angle) * 55, t: index * 12 };
  });
  assert.equal(analyzeClosedGesture(ellipse).recognized, true);
  assert.equal(recognizeHeldStroke(ellipse).kind, "ellipse");
  const arrow = [
    ...Array.from({ length: 8 }, (_, index) => ({ x: 30 + index * 24, y: 520 + Math.sin(index) * .7, t: index * 12 })),
    { x: 174, y: 500, t: 100 },
    { x: 198, y: 520, t: 112 },
    { x: 174, y: 540, t: 124 }
  ];
  assert.equal(recognizeHeldStroke(arrow).kind, "arrow");
  const rectangle = [
    ...Array.from({ length: 7 }, (_, index) => ({ x: 400 + index * 20, y: 100 })),
    ...Array.from({ length: 5 }, (_, index) => ({ x: 520, y: 100 + index * 20 })),
    ...Array.from({ length: 7 }, (_, index) => ({ x: 520 - index * 20, y: 180 })),
    ...Array.from({ length: 5 }, (_, index) => ({ x: 400, y: 180 - index * 20 }))
  ];
  assert.equal(recognizeHeldStroke(rectangle).kind, "rectangle");
  const triangle = [
    ...Array.from({ length: 7 }, (_, index) => ({ x: 620 + index * 12, y: 220 - index * 18 })),
    ...Array.from({ length: 7 }, (_, index) => ({ x: 692 + index * 12, y: 112 + index * 18 })),
    ...Array.from({ length: 9 }, (_, index) => ({ x: 764 - index * 18, y: 220 }))
  ];
  assert.equal(recognizeHeldStroke(triangle).kind, "triangle");
  const curvedWord = Array.from({ length: 16 }, (_, index) => ({ x: 30 + index * 10, y: 70 + Math.sin(index * .9) * 24, t: index * 10 }));
  assert.equal(recognizeHeldStroke(curvedWord), null);
});

test("hold and circle recognition use CSS-space thresholds at high zoom", () => {
  const unitsPerCssPixel = .2;
  const shortPageLine = Array.from({ length: 8 }, (_, index) => ({ x: 10 + index * 2, y: 20 + Math.sin(index) * .1, t: index * 12 }));
  assert.equal(recognizeHeldStroke(shortPageLine), null);
  assert.equal(recognizeHeldStroke(shortPageLine, { unitsPerCssPixel }).kind, "line");

  const compactCircle = Array.from({ length: 25 }, (_, index) => {
    const angle = index / 24 * Math.PI * 2;
    return { x: 40 + Math.cos(angle) * 5, y: 60 + Math.sin(angle) * 5, t: index * 12 };
  });
  assert.equal(analyzeClosedGesture(compactCircle).recognized, false);
  assert.equal(analyzeClosedGesture(compactCircle, { unitsPerCssPixel }).recognized, true);
  assert.equal(recognizeHeldStroke(compactCircle, { unitsPerCssPixel }).kind, "circle");
});

test("freeform and rectangle lasso use real segment geometry and bounded spatial candidates", () => {
  const inside = { id: "inside", page: 1, type: "pen", width: 5, points: [{ x: 80, y: 120 }, { x: 220, y: 120 }] };
  const crossing = { id: "crossing", page: 1, type: "pen", width: 5, points: [{ x: 20, y: 160 }, { x: 180, y: 160 }] };
  const outside = { id: "outside", page: 1, type: "pen", width: 5, points: [{ x: 700, y: 700 }, { x: 820, y: 820 }] };
  const polygon = rectangleLassoPolygon({ x: 60, y: 80 }, { x: 260, y: 200 });
  assert.equal(annotationIntersectsPolygon(inside, polygon), true);
  assert.equal(annotationIntersectsPolygon(crossing, polygon), true);
  assert.equal(annotationIntersectsPolygon(outside, polygon), false);
  const index = createAnnotationSpatialIndex([inside, crossing, outside], 80);
  assert.deepEqual(queryAnnotationSpatialIndexBounds(index, 1, { x: 60, y: 80, width: 200, height: 120 }).map((item) => item.id).sort(), ["crossing", "inside"]);
  const rotated = rotateAnnotation(inside, selectionBounds([inside]), Math.PI / 2);
  assert.ok(Math.abs(rotated.points[0].x - rotated.points[1].x) < .001);
});

test("precision eraser splits only intersected ink and replace history restores exact geometry", () => {
  let split = 0;
  const stroke = {
    id: "stroke-1",
    page: 1,
    type: "pen",
    profile: PEN_PROFILE.BALL,
    color: "#239ed1",
    width: 8,
    opacity: 1,
    pressureSensitivity: .5,
    points: Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: 50, p: .5, t: index * 8, pointer: "pen", pressureAvailable: true }))
  };
  const erased = eraseStrokeWithPath(stroke, { x: 50, y: 35 }, { x: 50, y: 65 }, 4, ERASER_MODE.PRECISION, () => `split-${++split}`);
  assert.equal(erased.changed, true);
  assert.equal(erased.fragments.length, 2);
  assert.ok(Math.max(...erased.fragments[0].points.map((point) => point.x)) < 43);
  assert.ok(Math.min(...erased.fragments[1].points.map((point) => point.x)) > 57);
  assert.ok(erased.fragments.every((fragment) => fragment.color === stroke.color && fragment.profile === stroke.profile));

  const command = { type: "replace", before: [stroke], after: erased.fragments };
  const redone = applyAnnotationCommand([stroke], command, "redo");
  assert.deepEqual(redone, erased.fragments);
  assert.deepEqual(applyAnnotationCommand(redone, command, "undo"), [stroke]);
});

test("segment and stroke erasers remain distinct atomic modes", () => {
  let split = 0;
  const stroke = {
    id: "stroke-2",
    page: 1,
    type: "fountain",
    profile: PEN_PROFILE.FOUNTAIN,
    width: 6,
    points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 0 }]
  };
  const segment = eraseStrokeWithPath({ ...stroke, type: "pen" }, { x: 60, y: -10 }, { x: 60, y: 10 }, 3, ERASER_MODE.SEGMENT, () => `segment-${++split}`);
  assert.equal(segment.changed, true);
  assert.ok(segment.fragments.length >= 1);
  const whole = eraseStrokeWithPath({ ...stroke, type: "pen" }, { x: 60, y: -10 }, { x: 60, y: 10 }, 3, ERASER_MODE.STROKE);
  assert.deepEqual(whole.fragments, []);
});

test("eraser radius becomes more precise at high zoom and spatial lookup stays local with thousands of strokes", () => {
  assert.equal(pageRadiusForScreenRadius(12, 1000), 12);
  assert.equal(pageRadiusForScreenRadius(12, 3000), 4);
  const marks = Array.from({ length: 3000 }, (_, index) => {
    const x = (index % 50) * 20;
    const y = Math.floor(index / 50) * 15;
    return { id: `stress-${index}`, page: 1, type: "pen", width: 4, points: [{ x, y }, { x: x + 8, y: y + 4 }] };
  });
  const index = createAnnotationSpatialIndex(marks, 40);
  const nearby = queryAnnotationSpatialIndex(index, 1, { x: 505, y: 305 }, 8);
  assert.ok(nearby.length > 0);
  assert.ok(nearby.length < 30);
});

test("stroke finalization reduces duplicate samples and the eraser index limits candidates", () => {
  const raw = [
    { x: 0, y: 0 }, { x: .1, y: .1 }, { x: .2, y: .2 }, { x: 30, y: 30 }, { x: 30.1, y: 30.1 }, { x: 80, y: 10 }
  ];
  assert.ok(simplifyStrokePoints(raw, 1).length < raw.length);
  const marks = [
    { id: "near", page: 1, type: "pen", width: 4, points: [{ x: 100, y: 100 }, { x: 130, y: 130 }] },
    { id: "far", page: 1, type: "pen", width: 4, points: [{ x: 800, y: 800 }, { x: 900, y: 900 }] }
  ];
  const index = createAnnotationSpatialIndex(marks);
  assert.deepEqual(queryAnnotationSpatialIndex(index, 1, { x: 110, y: 110 }, 20).map((item) => item.id), ["near"]);
});

test("legacy canvas erasing indexes local and normalized strokes in page space", () => {
  const strokes = [
    { tool: "pen", points: [{ x: 80, y: 90 }, { x: 130, y: 140 }] },
    { tool: "pen", normalized: true, points: [{ x: .75, y: .75 }, { x: .85, y: .85 }] },
    { tool: "pen", points: [{ x: 420, y: 460 }, { x: 470, y: 510 }] }
  ];
  const index = createStrokeSpatialIndex(strokes, 96, 600, 800);
  assert.deepEqual(queryStrokeSpatialIndex(index, { x: 105, y: 115 }, 20), [0]);
  assert.deepEqual(queryStrokeSpatialIndex(index, { x: 480, y: 640 }, 24), [1]);
  assert.deepEqual(queryStrokeSpatialIndex(index, { x: 445, y: 480 }, 18), [2]);
});

test("catalog annotations use reversible commands without snapshot history", () => {
  const mark = { id: "mark-1", page: 52, type: "pen", color: "#8b5cf6", width: 8, opacity: 1, points: [{ x: 20, y: 30, p: 0.5, t: 1, pointer: "pen", tiltX: 0, tiltY: 0 }] };
  const added = applyAnnotationCommand([], { type: "add", items: [mark] }, "redo");
  assert.equal(added.length, 1);
  assert.deepEqual(applyAnnotationCommand(added, { type: "add", items: [mark] }, "undo"), []);
  assert.deepEqual(applyAnnotationCommand([], { type: "remove", items: [mark] }, "undo"), [mark]);
});

test("catalog workspace snapshots are versioned, sanitized, and page scoped", () => {
  const raw = serializeCatalogWorkspace({
    page: 52,
    zoom: 2,
    scrollLeft: 84,
    scrollTop: 3120,
    pageOffset: .37,
    annotations: [{ id: "mark-1", page: 52, type: "pencil", color: "#8b5cf6", width: 8, opacity: 0.7, points: [{ x: 120, y: 240, p: 0.8, t: 12, pointer: "pen", tiltX: 4, tiltY: -2 }] }],
    notes: [{ id: "note-1", page: 3, body: "Third-page note", createdAt: "2026-08-15T10:00:00.000Z", updatedAt: "2026-08-15T10:00:00.000Z" }]
  });
  const restored = parseCatalogWorkspace(raw);
  assert.equal(restored.page, 52);
  assert.equal(restored.zoom, 2);
  assert.equal(restored.scrollLeft, 84);
  assert.equal(restored.scrollTop, 3120);
  assert.equal(restored.pageOffset, .37);
  assert.equal(restored.annotations[0].page, 52);
  assert.equal(restored.annotations[0].points[0].p, 0.8);
  assert.deepEqual(restored.notes[0], { id: "note-1", page: 3, body: "Third-page note", createdAt: "2026-08-15T10:00:00.000Z", updatedAt: "2026-08-15T10:00:00.000Z" });
});

test("text annotations preserve page coordinates, alignment, movement, and resizing", () => {
  const text = { id: "text-1", page: 7, type: "text", color: "#8b5cf6", width: 6, opacity: .8, x: 500, y: 320, text: "Stable label", align: "center" };
  const restored = parseCatalogWorkspace(serializeCatalogWorkspace({ page: 7, zoom: 2.4, annotations: [text], notes: [] })).annotations[0];
  assert.equal(restored.page, 7);
  assert.equal(restored.align, "center");
  const bounds = annotationBounds(restored);
  assert.equal(bounds.x + bounds.width / 2, 500);
  const moved = translateAnnotation(restored, 40, 25);
  assert.deepEqual({ x: moved.x, y: moved.y }, { x: 540, y: 345 });
  const resized = resizeAnnotation(restored, bounds, { ...bounds, width: bounds.width * 1.5, height: bounds.height * 1.5 });
  assert.ok(resized.width > restored.width);
});

test("lasso selection transforms preserve annotation coordinate space", () => {
  const mark = { id: "mark-1", type: "pen", width: 4, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] };
  assert.deepEqual(selectionBounds([mark]), { x: 10, y: 20, width: 20, height: 20 });
  assert.deepEqual(translateAnnotation(mark, 5, -5).points.map(({ x, y }) => ({ x, y })), [{ x: 15, y: 15 }, { x: 35, y: 35 }]);
  const resized = resizeAnnotation(mark, { x: 10, y: 20, width: 20, height: 20 }, { x: 10, y: 20, width: 40, height: 40 });
  assert.deepEqual(resized.points.map(({ x, y }) => ({ x, y })), [{ x: 10, y: 20 }, { x: 50, y: 60 }]);
  assert.equal(resized.width, 8);
});
