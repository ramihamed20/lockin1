function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function toFocusPoint(value = {}) {
  return { x: clamp(value.x / 1000, 0, 1), y: clamp(value.y / 1000, 0, 1) };
}

function fromFocusPoint(value = {}) {
  return { x: clamp(value.x, 0, 1) * 1000, y: clamp(value.y, 0, 1) * 1000 };
}

function focusBounds(item) {
  const points = item.points || [item.start, item.end].filter(Boolean);
  const normalized = points.map(toFocusPoint);
  const xs = normalized.map((point) => point.x);
  const ys = normalized.map((point) => point.y);
  const x = xs.length ? Math.min(...xs) : 0;
  const y = ys.length ? Math.min(...ys) : 0;
  return {
    x, y,
    width: Math.max(0.001, (xs.length ? Math.max(...xs) : x) - x),
    height: Math.max(0.001, (ys.length ? Math.max(...ys) : y) - y)
  };
}

export function catalogAnnotationToFocus(item) {
  if (!item?.id || !["pen", "pencil", "highlighter", "shape", "text"].includes(item.type)) return null;
  const base = {
    id: item.id, page_number: item.page, layer_key: "personal", bounds: focusBounds(item),
    color: item.color || "#8b5cf6", thickness: clamp(item.width || 4, 0.01, 64),
    opacity: clamp(item.opacity ?? 1, 0, 1)
  };
  if (["pen", "pencil", "highlighter"].includes(item.type)) {
    const samples = (item.points || []).slice(0, 2048).map((sample) => ({
      ...toFocusPoint(sample), pointer: sample.pointer || "unknown",
      pressure: clamp(sample.p, 0, 1), tiltX: clamp(sample.tiltX, -90, 90),
      tiltY: clamp(sample.tiltY, -90, 90), timestamp: Math.max(0, Number(sample.t) || Date.now())
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

export function reconcileCatalogWorkspace(remoteState, localState, focusAnnotations) {
  const remote = remoteState && typeof remoteState === "object" ? remoteState : null;
  const local = localState && typeof localState === "object" ? localState : null;
  const remoteTime = Date.parse(remote?.savedAt || "") || 0;
  const localTime = Date.parse(local?.savedAt || "") || 0;
  if (local && localTime > remoteTime) return { ...local, pending: true };
  const canonical = (focusAnnotations || []).map(focusAnnotationToCatalog).filter(Boolean);
  const remoteView = remote?.view || (remote ? {
    page: remote.page,
    zoom: remote.zoom,
    zoomFitBasis: remote.zoomFitBasis,
    scrollLeft: remote.scrollLeft,
    scrollTop: remote.scrollTop,
    pageOffset: remote.pageOffset
  } : null);
  return {
    ...(remote || local || {}),
    view: remoteView || local?.view,
    annotations: remote?.annotations?.length ? remote.annotations : canonical,
    notes: remote?.notes || [],
    pending: false
  };
}
