import { eraseStrokeWithPolyline, strokeIntersectsEraserPath } from "./strokeModel.js";
import { shapeIntersectsEraserPath } from "./shapeHitTesting.js";
import { annotationBounds } from "../catalog/catalogWorkspaceState.js";

/**
 * @typedef {Object} AnnotationCommand
 * @property {"replace"} type
 * @property {any[]} before
 * @property {any[]} after
 */

/** A deep copy with exactly the original's keys, so undo restores an identical mark. */
function cloneAnnotation(annotation) {
  return {
    ...annotation,
    ...(Array.isArray(annotation?.points) ? { points: annotation.points.map((point) => ({ ...point })) } : {}),
    ...(annotation?.start ? { start: { ...annotation.start } } : {}),
    ...(annotation?.end ? { end: { ...annotation.end } } : {}),
    ...(Array.isArray(annotation?.erasures) ? { erasures: annotation.erasures.map((erasure) => ({ radius: erasure.radius, points: erasure.points.map((point) => ({ ...point })) })) } : {})
  };
}

/**
 * Owns one eraser drag outside React. All edits stay provisional until
 * `finish`, which returns one atomic replace command for undo/redo.
 */
/** @param {{ idFactory?: () => string }} [options] */
export function createEraserSession({ idFactory = () => String(globalThis.crypto.randomUUID()) } = {}) {
  let active = false;
  let page = null;
  let lastPoint = null;
  let path = [];
  let eraserRadius = 0;
  let eraserMode;
  let eraserScale = { x: 1, y: 1 };
  let revision = 0;
  let materializedRevision = -1;
  let candidateCount = 0;
  const before = new Map();
  const working = new Map();

  function reset() {
    active = false;
    page = null;
    lastPoint = null;
    path = [];
    eraserRadius = 0;
    eraserMode = undefined;
    eraserScale = { x: 1, y: 1 };
    revision = 0;
    materializedRevision = -1;
    candidateCount = 0;
    before.clear();
    working.clear();
  }

  function begin(point, annotationPage) {
    reset();
    active = true;
    page = annotationPage;
    lastPoint = point;
    path = [point];
  }

  function materialize() {
    if (materializedRevision === revision) return;
    working.clear();
    for (const original of before.values()) {
      // Vector shapes have no partial form, so a touched shape is removed whole.
      const result = eraserMode === "object" || original.type === "shape"
        ? { fragments: [] }
        : eraseStrokeWithPolyline(original, path, eraserRadius, eraserMode, idFactory, eraserScale);
      working.set(original.id, result.fragments);
    }
    materializedRevision = revision;
  }

  return {
    begin,
    append(point, { annotationPage = page, candidates = [], radius: nextRadius = 0, mode: nextMode = undefined, scale: nextScale = undefined } = {}) {
      if (!active || annotationPage !== page) begin(point, annotationPage);
      const previous = lastPoint || point;
      const newlyChangedIds = [];
      eraserRadius = Math.max(0, Number(nextRadius) || 0);
      eraserMode = nextMode;
      if (nextScale && Number(nextScale.x) > 0 && Number(nextScale.y) > 0) eraserScale = { x: Number(nextScale.x), y: Number(nextScale.y) };
      candidateCount += candidates.length;
      for (const original of candidates) {
        if (original?.locked) continue;
        if (before.has(original.id)) continue;
        const ink = ["pen", "pencil", "highlighter"].includes(original?.type);
        const shape = original?.type === "shape";
        if (!ink && !shape && eraserMode !== "object") continue;
        const bounds = annotationBounds(original);
        const hitsObject = eraserMode === "object" && bounds && [previous, point].some((sample) => sample.x >= bounds.x - eraserRadius && sample.x <= bounds.x + bounds.width + eraserRadius && sample.y >= bounds.y - eraserRadius && sample.y <= bounds.y + bounds.height + eraserRadius);
        // Every mode measures against the painted ink, including its width: a
        // tip that visibly covers the edge of a thick highlighter touches it.
        const hitsInk = ink && strokeIntersectsEraserPath(original, previous, point, eraserRadius, true, eraserScale);
        const hitsShape = shape && shapeIntersectsEraserPath(original, previous, point, eraserRadius, eraserScale);
        if (hitsObject || hitsInk || hitsShape) {
          before.set(original.id, cloneAnnotation(original));
          newlyChangedIds.push(original.id);
        }
      }
      if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) > .05) path.push(point);
      lastPoint = point;
      revision += 1;
      return {
        changed: before.size > 0,
        newlyChangedIds,
        hiddenIds: [...before.keys()],
        candidateCount
      };
    },
    finish() {
      if (!before.size) {
        const result = { command: null, replacements: new Map(), candidateCount };
        reset();
        return result;
      }
      materialize();
      const replacements = new Map([...working.entries()].map(([id, fragments]) => [id, [...fragments]]));
      /** @type {AnnotationCommand} */
      const command = {
        type: "replace",
        before: [...before.values()],
        after: [...working.values()].flat()
      };
      const result = { command, replacements, candidateCount };
      reset();
      return result;
    },
    cancel() {
      const hiddenIds = [...before.keys()];
      reset();
      return hiddenIds;
    },
    getPreview() {
      materialize();
      return {
        hiddenIds: [...before.keys()],
        annotations: [...working.values()].flat()
      };
    },
    getHiddenIds() {
      return [...before.keys()];
    },
    getLastPoint() {
      return lastPoint;
    },
    getDiagnostics() {
      return { active, page, changedCount: before.size, candidateCount, pathPointCount: path.length };
    }
  };
}
