function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

/**
 * Values are rounded to what the server stores, so an annotation read back
 * converts to exactly the mutation that wrote it and is not re-sent.
 */
function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const POINTER_KINDS = new Set(["pen", "touch", "mouse"]);

function toFocusPoint(value = {}) {
  return { x: round(clamp(value.x / 1000, 0, 1), 6), y: round(clamp(value.y / 1000, 0, 1), 6) };
}

function fromFocusPoint(value = {}) {
  return { x: clamp(value.x, 0, 1) * 1000, y: clamp(value.y, 0, 1) * 1000 };
}

function focusBounds(item) {
  // A fresh array, so the anchor pushed below never mutates the annotation.
  const points = item.points?.length ? item.points : [item.start, item.end].filter(Boolean);
  // A text annotation is anchored at a single point.
  if (!points.length && Number.isFinite(Number(item.x))) points.push({ x: item.x, y: item.y });
  const normalized = points.map(toFocusPoint);
  const xs = normalized.map((point) => point.x);
  const ys = normalized.map((point) => point.y);
  const x = xs.length ? Math.min(...xs) : 0;
  const y = ys.length ? Math.min(...ys) : 0;
  return {
    x, y,
    width: round(Math.max(0.001, (xs.length ? Math.max(...xs) : x) - x), 6),
    height: round(Math.max(0.001, (ys.length ? Math.max(...ys) : y) - y), 6)
  };
}

export function catalogAnnotationToFocus(item) {
  if (!item?.id || !["pen", "pencil", "highlighter", "shape", "text"].includes(item.type)) return null;
  const base = {
    id: item.id, page_number: item.page, layer_key: "personal", bounds: focusBounds(item),
    color: HEX_COLOR.test(item.color || "") ? item.color : "#8b5cf6",
    thickness: round(clamp(item.width || 4, 0.01, 64), 2),
    opacity: round(clamp(item.opacity ?? 1, 0, 1), 3)
  };
  if (["pen", "pencil", "highlighter"].includes(item.type)) {
    const samples = (item.points || []).slice(0, 2048).map((sample) => ({
      ...toFocusPoint(sample), pointer: POINTER_KINDS.has(sample.pointer) ? sample.pointer : "unknown",
      pressure: round(clamp(sample.p, 0, 1), 4), tiltX: round(clamp(sample.tiltX, -90, 90), 2),
      tiltY: round(clamp(sample.tiltY, -90, 90), 2), timestamp: Math.max(0, Math.round(Number(sample.t) || 0))
    }));
    return samples.length >= 2 ? { ...base, tool: item.type, payload: { kind: "stroke", samples } } : null;
  }
  if (item.type === "shape") {
    const tool = ({ square: "rectangle", ellipse: "circle" })[item.shape] || item.shape;
    if (!["line", "arrow", "rectangle", "circle"].includes(tool)) return null;
    return { ...base, tool, payload: { kind: "shape", start: toFocusPoint(item.start), end: toFocusPoint(item.end) } };
  }
  const value = String(item.text || "").trim();
  return value ? { ...base, tool: "text", payload: { kind: "text", value } } : null;
}

export function focusAnnotationToCatalog(item) {
  const base = {
    id: String(item.id), page: Number(item.page_number), color: item.color,
    width: Number(item.thickness), opacity: Number(item.opacity),
    createdAt: item.created_at || new Date().toISOString()
  };
  if (["pen", "pencil", "highlighter"].includes(item.tool) && item.payload?.kind === "stroke") {
    return {
      ...base, type: item.tool, profile: item.tool,
      points: item.payload.samples.map((sample) => ({
        ...fromFocusPoint(sample), p: sample.pressure, t: sample.timestamp,
        pointer: sample.pointer, tiltX: sample.tiltX, tiltY: sample.tiltY
      }))
    };
  }
  if (["line", "arrow", "rectangle", "circle"].includes(item.tool) && item.payload?.kind === "shape") {
    return { ...base, type: "shape", shape: item.tool, start: fromFocusPoint(item.payload.start), end: fromFocusPoint(item.payload.end) };
  }
  if (item.tool === "text" && item.payload?.kind === "text") {
    const origin = fromFocusPoint(item.bounds || {});
    return { ...base, type: "text", text: item.payload.value, x: origin.x, y: origin.y, align: "left" };
  }
  return null;
}

/**
 * Whether the server can hold this annotation. Images, triangles and
 * annotations with pre-UUID identifiers stay on this device only.
 */
export function isServerSyncableAnnotation(item) {
  return UUID_PATTERN.test(String(item?.id || "")) && catalogAnnotationToFocus(item) !== null;
}

/** The server-visible content of an annotation; equal signatures need no upload. */
export function focusAnnotationSignature(item) {
  const wire = catalogAnnotationToFocus(item);
  return wire ? JSON.stringify(wire) : "";
}
