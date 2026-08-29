import { eraseStrokeWithPolyline, strokeIntersectsEraserPath } from "./strokeModel.js";

/**
 * @typedef {Object} AnnotationCommand
 * @property {"replace"} type
 * @property {any[]} before
 * @property {any[]} after
 */

function cloneAnnotation(annotation) {
  return {
    ...annotation,
    points: Array.isArray(annotation?.points) ? annotation.points.map((point) => ({ ...point })) : annotation?.points
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
      const result = eraseStrokeWithPolyline(original, path, eraserRadius, eraserMode, idFactory);
      working.set(original.id, result.fragments);
    }
    materializedRevision = revision;
  }

  return {
    begin,
    append(point, { annotationPage = page, candidates = [], radius: nextRadius = 0, mode: nextMode = undefined } = {}) {
      if (!active || annotationPage !== page) begin(point, annotationPage);
      const previous = lastPoint || point;
      const newlyChangedIds = [];
      eraserRadius = Math.max(0, Number(nextRadius) || 0);
      eraserMode = nextMode;
      candidateCount += candidates.length;
      for (const original of candidates) {
        if (!["pen", "pencil", "highlighter"].includes(original?.type)) continue;
        if (!before.has(original.id) && strokeIntersectsEraserPath(original, previous, point, eraserRadius)) {
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
