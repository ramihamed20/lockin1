const SNAPSHOT_VERSION = 1;
const MAX_ANNOTATIONS = 5000;
const MAX_NOTES = 500;
const annotationBoundsCache = new WeakMap();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safePoint(point) {
  return {
    x: Math.min(1000, Math.max(0, finite(point?.x))),
    y: Math.min(1000, Math.max(0, finite(point?.y))),
    p: Math.min(1, Math.max(0, finite(point?.p))),
    t: Math.max(0, finite(point?.t, Date.now())),
    pointer: ["pen", "touch", "mouse", "unknown"].includes(point?.pointer) ? point.pointer : "unknown",
    pointerId: Math.max(0, Math.round(finite(point?.pointerId))),
    buttons: Math.max(0, Math.round(finite(point?.buttons))),
    pressureAvailable: point?.pressureAvailable === true,
    contactWidth: Math.max(0, finite(point?.contactWidth)),
    contactHeight: Math.max(0, finite(point?.contactHeight)),
    tiltX: Math.min(90, Math.max(-90, finite(point?.tiltX))),
    tiltY: Math.min(90, Math.max(-90, finite(point?.tiltY))),
    altitudeAngle: Number.isFinite(Number(point?.altitudeAngle)) ? finite(point.altitudeAngle) : null,
    azimuthAngle: Number.isFinite(Number(point?.azimuthAngle)) ? finite(point.azimuthAngle) : null,
    twist: Number.isFinite(Number(point?.twist)) ? finite(point.twist) : null,
    tangentialPressure: Number.isFinite(Number(point?.tangentialPressure)) ? finite(point.tangentialPressure) : null
  };
}

export function catalogWorkspaceStorageKey(materialSlug, sheetSlug) {
  return `lock-in.catalog-workspace.v${SNAPSHOT_VERSION}.${materialSlug}.${sheetSlug}`;
}

export function sanitizeCatalogAnnotation(annotation) {
  if (!annotation || typeof annotation !== "object" || typeof annotation.id !== "string") return null;
  if (!["pen", "pencil", "highlighter", "shape", "text", "image"].includes(annotation.type)) return null;
  const base = {
    id: annotation.id,
    page: Math.max(1, Math.round(finite(annotation.page, 1))),
    type: annotation.type,
    color: typeof annotation.color === "string" ? annotation.color.slice(0, 32) : "#8b5cf6",
    width: Math.min(120, Math.max(1, finite(annotation.width, 4))),
    opacity: annotation.type === "pen" ? 1 : Math.min(1, Math.max(0.05, finite(annotation.opacity, 1))),
    profile: ["ball", "fountain", "brush", "pencil", "highlighter"].includes(annotation.profile)
      ? annotation.profile
      : annotation.type === "pencil" ? "pencil" : annotation.type === "highlighter" ? "highlighter" : "ball",
    pressureSensitivity: Math.min(1, Math.max(0, finite(annotation.pressureSensitivity, .55))),
    smoothing: Math.min(1, Math.max(0, finite(annotation.smoothing, .5))),
    createdAt: Number.isFinite(Date.parse(annotation.createdAt)) ? new Date(annotation.createdAt).toISOString() : new Date().toISOString()
  };
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) {
    const points = Array.isArray(annotation.points) ? annotation.points.slice(0, 12000).map(safePoint) : [];
    return points.length ? { ...base, points } : null;
  }
  if (annotation.type === "shape") {
    const shape = ["line", "arrow", "circle", "ellipse", "square", "rectangle", "triangle"].includes(annotation.shape) ? annotation.shape : "rectangle";
    return { ...base, shape, start: safePoint(annotation.start), end: safePoint(annotation.end) };
  }
  if (annotation.type === "text") {
    const text = typeof annotation.text === "string" ? annotation.text.trim().slice(0, 240) : "";
    const align = ["left", "center", "right"].includes(annotation.align) ? annotation.align : "left";
    return text ? { ...base, x: safePoint(annotation).x, y: safePoint(annotation).y, text, align } : null;
  }
  if (annotation.type === "image") {
    const src = typeof annotation.src === "string" && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(annotation.src) ? annotation.src : "";
    if (!src || src.length > 3_000_000) return null;
    return {
      ...base,
      src,
      x: safePoint(annotation).x,
      y: safePoint(annotation).y,
      width: Math.min(900, Math.max(20, finite(annotation.width, 300))),
      height: Math.min(900, Math.max(20, finite(annotation.height, 220)))
    };
  }
  return null;
}

export function sanitizeCatalogNote(note) {
  if (!note || typeof note !== "object" || typeof note.id !== "string") return null;
  const body = typeof note.body === "string" ? note.body.trim().slice(0, 10000) : "";
  if (!body) return null;
  const createdAt = Number.isFinite(Date.parse(note.createdAt)) ? new Date(note.createdAt).toISOString() : new Date().toISOString();
  const updatedAt = Number.isFinite(Date.parse(note.updatedAt)) ? new Date(note.updatedAt).toISOString() : createdAt;
  return {
    id: note.id.slice(0, 80),
    page: Math.max(1, Math.round(finite(note.page, 1))),
    body,
    createdAt,
    updatedAt
  };
}

export function serializeCatalogWorkspace(snapshot) {
  const annotations = (Array.isArray(snapshot?.annotations) ? snapshot.annotations : [])
    .slice(-MAX_ANNOTATIONS)
    .map(sanitizeCatalogAnnotation)
    .filter(Boolean);
  const notes = (Array.isArray(snapshot?.notes) ? snapshot.notes : [])
    .slice(-MAX_NOTES)
    .map(sanitizeCatalogNote)
    .filter(Boolean);
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    page: Math.max(1, Math.round(finite(snapshot?.page, 1))),
    zoom: Math.min(5, Math.max(0.5, finite(snapshot?.zoom, 1))),
    // The fit-to-width scale the zoom was measured against, so reopening the
    // sheet on a narrower device restores the reading size rather than the
    // page width. Zero means unknown, which the reader treats as fit-to-width.
    zoomFitBasis: Math.min(5, Math.max(0, finite(snapshot?.zoomFitBasis, 0))),
    scrollLeft: Math.max(0, finite(snapshot?.scrollLeft, 0)),
    scrollTop: Math.max(0, finite(snapshot?.scrollTop, 0)),
    pageOffset: Math.min(1, Math.max(0, finite(snapshot?.pageOffset, 0))),
    annotations,
    notes
  });
}

export function parseCatalogWorkspace(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const snapshot = JSON.parse(value);
    if (snapshot?.version !== SNAPSHOT_VERSION) return null;
    return {
      page: Math.max(1, Math.round(finite(snapshot.page, 1))),
      zoom: Math.min(5, Math.max(0.5, finite(snapshot.zoom, 1))),
      zoomFitBasis: Math.min(5, Math.max(0, finite(snapshot.zoomFitBasis, 0))),
      scrollLeft: Math.max(0, finite(snapshot.scrollLeft, 0)),
      scrollTop: Math.max(0, finite(snapshot.scrollTop, 0)),
      pageOffset: Math.min(1, Math.max(0, finite(snapshot.pageOffset, 0))),
      annotations: (Array.isArray(snapshot.annotations) ? snapshot.annotations : [])
        .slice(-MAX_ANNOTATIONS)
        .map(sanitizeCatalogAnnotation)
        .filter(Boolean),
      notes: (Array.isArray(snapshot.notes) ? snapshot.notes : [])
        .slice(-MAX_NOTES)
        .map(sanitizeCatalogNote)
        .filter(Boolean)
    };
  } catch {
    return null;
  }
}

function ids(items) {
  return new Set((items || []).map((item) => item.id));
}

export function applyAnnotationCommand(annotations, command, direction = "redo") {
  const current = Array.isArray(annotations) ? annotations : [];
  if (!command || !["redo", "undo"].includes(direction)) return current;
  if (command.type === "add") {
    if (direction === "undo") {
      const removed = ids(command.items);
      return current.filter((item) => !removed.has(item.id));
    }
    const existing = ids(current);
    return [...current, ...(command.items || []).filter((item) => !existing.has(item.id))];
  }
  if (command.type === "remove") {
    if (direction === "undo") {
      const existing = ids(current);
      return [...current, ...(command.items || []).filter((item) => !existing.has(item.id))];
    }
    const removed = ids(command.items);
    return current.filter((item) => !removed.has(item.id));
  }
  if (command.type === "update") {
    const replacements = new Map((direction === "undo" ? command.before : command.after).map((item) => [item.id, item]));
    return current.map((item) => replacements.get(item.id) || item);
  }
  if (command.type === "replace") {
    const removedItems = direction === "undo" ? command.after : command.before;
    const insertedItems = direction === "undo" ? command.before : command.after;
    const removedIds = ids(removedItems);
    const firstIndex = current.findIndex((item) => removedIds.has(item.id));
    const retained = current.filter((item) => !removedIds.has(item.id));
    const existing = ids(retained);
    const additions = (insertedItems || []).filter((item) => !existing.has(item.id));
    retained.splice(firstIndex < 0 ? retained.length : firstIndex, 0, ...additions);
    return retained;
  }
  return current;
}

export function annotationBounds(annotation) {
  if (!annotation) return null;
  const cached = annotationBoundsCache.get(annotation);
  if (cached) return cached;
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) {
    const points = annotation.points || [];
    if (!points.length) return null;
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const bounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    annotationBoundsCache.set(annotation, bounds);
    return bounds;
  }
  if (annotation.type === "shape") {
    return {
      x: Math.min(annotation.start.x, annotation.end.x),
      y: Math.min(annotation.start.y, annotation.end.y),
      width: Math.max(1, Math.abs(annotation.end.x - annotation.start.x)),
      height: Math.max(1, Math.abs(annotation.end.y - annotation.start.y))
    };
  }
  if (annotation.type === "image") return { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height };
  if (annotation.type === "text") {
    const width = Math.max(60, annotation.text.length * annotation.width * 2.7);
    const x = annotation.align === "center" ? annotation.x - width / 2 : annotation.align === "right" ? annotation.x - width : annotation.x;
    return { x, y: annotation.y - annotation.width * 5, width, height: Math.max(24, annotation.width * 6) };
  }
  return null;
}

export function createAnnotationSpatialIndex(annotations, cellSize = 140) {
  const pages = new Map();
  for (const annotation of annotations || []) {
    const bounds = annotationBounds(annotation);
    if (!bounds) continue;
    const padding = ["pen", "pencil", "highlighter"].includes(annotation.type) ? Math.max(.5, finite(annotation.width, 1) / 2) : 0;
    const page = Number(annotation.page) || 1;
    const buckets = pages.get(page) || new Map();
    pages.set(page, buckets);
    const startX = Math.floor((bounds.x - padding) / cellSize);
    const endX = Math.floor((bounds.x + bounds.width + padding) / cellSize);
    const startY = Math.floor((bounds.y - padding) / cellSize);
    const endY = Math.floor((bounds.y + bounds.height + padding) / cellSize);
    for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
      const key = `${x}:${y}`;
      const items = buckets.get(key) || [];
      items.push(annotation);
      buckets.set(key, items);
    }
  }
  return { cellSize, pages };
}

export function queryAnnotationSpatialIndex(index, page, point, radius = 0) {
  const cellSize = Number(index?.cellSize) || 140;
  const buckets = index?.pages?.get(Number(page) || 1);
  if (!buckets) return [];
  const startX = Math.floor((point.x - radius) / cellSize);
  const endX = Math.floor((point.x + radius) / cellSize);
  const startY = Math.floor((point.y - radius) / cellSize);
  const endY = Math.floor((point.y + radius) / cellSize);
  const candidates = new Map();
  for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
    for (const annotation of buckets.get(`${x}:${y}`) || []) candidates.set(annotation.id, annotation);
  }
  return [...candidates.values()];
}

export function queryAnnotationSpatialIndexBounds(index, page, bounds) {
  const cellSize = Number(index?.cellSize) || 140;
  const buckets = index?.pages?.get(Number(page) || 1);
  if (!buckets || !bounds) return [];
  const startX = Math.floor(bounds.x / cellSize);
  const endX = Math.floor((bounds.x + bounds.width) / cellSize);
  const startY = Math.floor(bounds.y / cellSize);
  const endY = Math.floor((bounds.y + bounds.height) / cellSize);
  const candidates = new Map();
  for (let x = startX; x <= endX; x += 1) for (let y = startY; y <= endY; y += 1) {
    for (const annotation of buckets.get(`${x}:${y}`) || []) candidates.set(annotation.id, annotation);
  }
  return [...candidates.values()];
}

export function selectionBounds(annotations) {
  const bounds = (annotations || []).map(annotationBounds).filter(Boolean);
  if (!bounds.length) return null;
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y))
      && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y || 1) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const orientation = (start, end, point) => (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  const onSegment = (point, start, end) => point.x >= Math.min(start.x, end.x) - .001
    && point.x <= Math.max(start.x, end.x) + .001
    && point.y >= Math.min(start.y, end.y) - .001
    && point.y <= Math.max(start.y, end.y) + .001;
  const first = orientation(firstStart, firstEnd, secondStart);
  const second = orientation(firstStart, firstEnd, secondEnd);
  const third = orientation(secondStart, secondEnd, firstStart);
  const fourth = orientation(secondStart, secondEnd, firstEnd);
  if (first * second < 0 && third * fourth < 0) return true;
  if (Math.abs(first) <= .001 && onSegment(secondStart, firstStart, firstEnd)) return true;
  if (Math.abs(second) <= .001 && onSegment(secondEnd, firstStart, firstEnd)) return true;
  if (Math.abs(third) <= .001 && onSegment(firstStart, secondStart, secondEnd)) return true;
  return Math.abs(fourth) <= .001 && onSegment(firstEnd, secondStart, secondEnd);
}

function segmentIntersectsPolygon(start, end, polygon) {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (polygonSegmentsIntersect(start, end, polygon[index], polygon[(index + 1) % polygon.length])) return true;
  }
  return false;
}

function annotationSelectionPolyline(annotation) {
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) return annotation.points || [];
  const bounds = annotationBounds(annotation);
  if (!bounds) return [];
  if (annotation.type === "shape" && annotation.shape === "line") return [annotation.start, annotation.end];
  if (annotation.type === "shape" && annotation.shape === "arrow") return [annotation.start, annotation.end];
  if (annotation.type === "shape" && ["circle", "ellipse"].includes(annotation.shape)) {
    const points = [];
    for (let index = 0; index <= 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      points.push({ x: bounds.x + bounds.width / 2 + Math.cos(angle) * bounds.width / 2, y: bounds.y + bounds.height / 2 + Math.sin(angle) * bounds.height / 2 });
    }
    return points;
  }
  if (annotation.type === "shape" && annotation.shape === "triangle") {
    return [
      { x: bounds.x + bounds.width / 2, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
      { x: bounds.x + bounds.width / 2, y: bounds.y }
    ];
  }
  return [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y }
  ];
}

export function annotationIntersectsPolygon(annotation, polygon) {
  if (!annotation || !Array.isArray(polygon) || polygon.length < 3) return false;
  const polyline = annotationSelectionPolyline(annotation);
  if (!polyline.length) return false;
  if (polyline.some((point) => pointInPolygon(point, polygon))) return true;
  for (let index = 1; index < polyline.length; index += 1) {
    if (segmentIntersectsPolygon(polyline[index - 1], polyline[index], polygon)) return true;
  }
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) return false;
  const bounds = annotationBounds(annotation);
  return Boolean(bounds && polygon.some((point) => point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height));
}

export function translateAnnotation(annotation, dx, dy) {
  const move = (point) => ({ ...point, x: Math.min(1000, Math.max(0, point.x + dx)), y: Math.min(1000, Math.max(0, point.y + dy)) });
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) return { ...annotation, points: annotation.points.map(move) };
  if (annotation.type === "shape") return { ...annotation, start: move(annotation.start), end: move(annotation.end) };
  return { ...annotation, ...move(annotation) };
}

export function resizeAnnotation(annotation, fromBounds, toBounds) {
  const scaleX = toBounds.width / Math.max(1, fromBounds.width);
  const scaleY = toBounds.height / Math.max(1, fromBounds.height);
  const resize = (point) => ({
    ...point,
    x: toBounds.x + (point.x - fromBounds.x) * scaleX,
    y: toBounds.y + (point.y - fromBounds.y) * scaleY
  });
  const scaleWidth = Math.sqrt(Math.max(0.01, scaleX * scaleY));
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) return { ...annotation, width: annotation.width * scaleWidth, points: annotation.points.map(resize) };
  if (annotation.type === "shape") return { ...annotation, width: annotation.width * scaleWidth, start: resize(annotation.start), end: resize(annotation.end) };
  if (annotation.type === "image") return { ...annotation, ...resize(annotation), width: annotation.width * scaleX, height: annotation.height * scaleY };
  return { ...annotation, ...resize(annotation), width: annotation.width * scaleWidth };
}

export function rotateAnnotation(annotation, bounds, radians = Math.PI / 2) {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotate = (point) => ({
    ...point,
    x: Math.min(1000, Math.max(0, center.x + (point.x - center.x) * cosine - (point.y - center.y) * sine)),
    y: Math.min(1000, Math.max(0, center.y + (point.x - center.x) * sine + (point.y - center.y) * cosine))
  });
  if (["pen", "pencil", "highlighter"].includes(annotation.type)) return { ...annotation, points: annotation.points.map(rotate) };
  if (annotation.type === "shape") return { ...annotation, start: rotate(annotation.start), end: rotate(annotation.end) };
  const rotated = rotate(annotation);
  if (annotation.type === "image") return { ...annotation, ...rotated, width: annotation.height, height: annotation.width };
  return { ...annotation, ...rotated };
}
