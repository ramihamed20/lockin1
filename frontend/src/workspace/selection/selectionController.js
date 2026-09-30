import { annotationBounds, selectionBounds } from "../catalog/catalogWorkspaceState.js";

/**
 * The Select tool's decisions, kept free of React and the DOM so every rule
 * can be tested on its own. Annotations stay in the workspace's own model:
 * page space runs 0-1000 on both axes, so a page's x and y units differ in
 * screen size by the page's aspect ratio (height / width). Distances here are
 * measured in x units after stretching y by that ratio, which makes a hit
 * tolerance mean the same number of screen pixels in both directions.
 */

export const INK_TYPES = new Set(["pen", "pencil", "highlighter"]);
export const EDITABLE_TYPES = new Set(["text", "card"]);

/** CSS pixels a contact may travel before a press on a selection becomes a move. */
export const MOVE_THRESHOLD_PX = { mouse: 3, pen: 5, touch: 8 };
/** Two taps on the same item within this window edit it instead of reselecting. */
export const DOUBLE_TAP_MS = 380;
export const DOUBLE_TAP_DISTANCE_PX = 24;
/** Where pasted and duplicated copies land relative to their source, in page units. */
export const COPY_OFFSET = 24;

function distanceToSegment(point, start, end, aspect) {
  const px = point.x;
  const py = point.y * aspect;
  const ax = start.x;
  const ay = start.y * aspect;
  const bx = end.x;
  const by = end.y * aspect;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToPolyline(point, points, aspect) {
  if (!points?.length) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, (point.y - points[0].y) * aspect);
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    nearest = Math.min(nearest, distanceToSegment(point, points[index - 1], points[index], aspect));
  }
  return nearest;
}

function withinBounds(point, bounds, tolerance, aspect) {
  if (!bounds) return false;
  const toleranceY = tolerance / Math.max(.01, aspect);
  return point.x >= bounds.x - tolerance
    && point.x <= bounds.x + bounds.width + tolerance
    && point.y >= bounds.y - toleranceY
    && point.y <= bounds.y + bounds.height + toleranceY;
}

/** Whether a point lands on an annotation, allowing `tolerance` x units of slack. */
export function annotationHit(annotation, point, { tolerance = 6, aspect = 1 } = {}) {
  if (!annotation || !point) return false;
  if (INK_TYPES.has(annotation.type)) {
    // Pressure can widen ink to about 2.25x its nominal width.
    const reach = Math.max(1, Number(annotation.width) || 1) * (annotation.type === "highlighter" ? .6 : 1.1) + tolerance;
    return distanceToPolyline(point, annotation.points, aspect) <= reach;
  }
  if (annotation.type === "shape" && ["line", "arrow"].includes(annotation.shape)) {
    const reach = Math.max(1, Number(annotation.width) || 1) / 2 + tolerance;
    return distanceToSegment(point, annotation.start, annotation.end, aspect) <= reach;
  }
  // Shapes, text, images and cards are picked by their box, which is what a
  // student sees as "the object".
  return withinBounds(point, annotationBounds(annotation), tolerance, aspect);
}

/**
 * Items in the order they are painted, bottom first. Highlighters are drawn as
 * a blended layer beneath everything else; the rest follow zOrder, then the
 * order they were added.
 */
export function paintOrder(annotations) {
  const indexed = (annotations || []).map((item, index) => ({ item, index }));
  const layer = (entry) => entry.item.type === "highlighter" ? 0 : 1;
  indexed.sort((first, second) => layer(first) - layer(second)
    || (first.item.zOrder || 0) - (second.item.zOrder || 0)
    || first.index - second.index);
  return indexed.map((entry) => entry.item);
}

/** The topmost annotation under a point, or null. */
export function hitTestAnnotations(annotations, point, options = {}) {
  const ordered = paintOrder(annotations);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (annotationHit(ordered[index], point, options)) return ordered[index];
  }
  return null;
}

/** Selecting one member of a group selects the whole group on that page. */
export function expandSelectionGroups(ids, annotations) {
  const chosen = new Set(ids);
  const groups = new Set((annotations || []).filter((item) => chosen.has(item.id) && item.groupId).map((item) => item.groupId));
  for (const item of annotations || []) if (item.groupId && groups.has(item.groupId)) chosen.add(item.id);
  return (annotations || []).filter((item) => chosen.has(item.id)).map((item) => item.id);
}

/**
 * The movement a selection may actually make. The whole selection moves as
 * one and stops at the page edge; clamping each point on its own squashed a
 * drawing that was dragged against the edge.
 */
export function clampSelectionDelta(bounds, dx, dy, limit = 1000) {
  if (!bounds) return { dx: 0, dy: 0 };
  const minDx = -bounds.x;
  const maxDx = limit - (bounds.x + bounds.width);
  const minDy = -bounds.y;
  const maxDy = limit - (bounds.y + bounds.height);
  return {
    dx: Math.min(Math.max(dx, Math.min(0, minDx)), Math.max(0, maxDx)),
    dy: Math.min(Math.max(dy, Math.min(0, minDy)), Math.max(0, maxDy))
  };
}

/** Bounds of the items that can be moved, used to clamp a drag. */
export function movableBounds(items) {
  return selectionBounds((items || []).filter((item) => !item.locked));
}

/**
 * Moves the selected items one step up or down the painting order of their
 * page and returns only the items whose zOrder changed, as before/after
 * pairs for one undoable update. Every item on the page is renumbered to its
 * position, because most items share zOrder 0 and a single item could not
 * otherwise step past just one neighbour.
 */
export function reorderSelection(pageAnnotations, selectedIds, direction) {
  const selected = new Set(selectedIds);
  const ordered = paintOrder(pageAnnotations).filter((item) => item.type !== "highlighter");
  if (!ordered.some((item) => selected.has(item.id))) return { before: [], after: [] };
  const next = [...ordered];
  if (direction === "forward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index].id) && !selected.has(next[index + 1].id)) [next[index], next[index + 1]] = [next[index + 1], next[index]];
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index].id) && !selected.has(next[index - 1].id)) [next[index], next[index - 1]] = [next[index - 1], next[index]];
    }
  }
  const before = [];
  const after = [];
  next.forEach((item, position) => {
    if ((item.zOrder || 0) === position) return;
    before.push(item);
    after.push({ ...item, zOrder: position });
  });
  return { before, after };
}

/** Whether a completed press counts as a second tap on the same item. */
export function isDoubleTap(previous, current) {
  return Boolean(previous && current
    && previous.id === current.id
    && current.time - previous.time <= DOUBLE_TAP_MS
    && Math.hypot(current.x - previous.x, current.y - previous.y) <= DOUBLE_TAP_DISTANCE_PX);
}

/** The single item a double tap would edit, if the selection is one text or card. */
export function editableTarget(items) {
  return items?.length === 1 && EDITABLE_TYPES.has(items[0].type) && !items[0].locked ? items[0] : null;
}

/**
 * Where the context toolbar sits, in the reader's own pixels. It prefers the
 * space above the selection, drops below when there is no room, and never
 * leaves the reader.
 */
export function contextToolbarPosition({ selection, toolbar, reader, gap = 10, margin = 8, topInset = 0 }) {
  const centre = selection.left + selection.width / 2;
  const left = Math.min(Math.max(margin, centre - toolbar.width / 2), Math.max(margin, reader.width - toolbar.width - margin));
  const above = selection.top - gap - toolbar.height;
  const below = selection.top + selection.height + gap;
  const fitsAbove = above >= topInset + margin;
  const fitsBelow = below + toolbar.height <= reader.height - margin;
  const top = fitsAbove || !fitsBelow ? Math.max(topInset + margin, Math.min(above, reader.height - toolbar.height - margin)) : below;
  return { left: Math.round(left), top: Math.round(top), placement: fitsAbove || !fitsBelow ? "above" : "below" };
}
