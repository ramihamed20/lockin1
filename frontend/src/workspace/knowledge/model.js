export const newId = () => globalThis.crypto.randomUUID();
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const STUDY_TOOLS_ENABLED = import.meta.env?.VITE_KNOWLEDGE_ENABLED === "true";

export function createArtifact(kind, source, page = 1) {
  return {
    id: newId(), ...source, kind, title: "",
    page_start: Math.max(1, page), page_end: Math.max(1, page), revision: 0, deleted: false,
    content: kind === "summary"
      ? { text: "", paper: "ruled", strokes: [], suggestions: [], concept_ids: [] }
      : { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, concept_ids: [] },
  };
}

export function addMapNode(map, text, conceptId = "") {
  if (map.nodes.length >= 300) throw new Error("map_limit");
  const index = map.nodes.length;
  const node = {
    id: newId(), text: [...text].slice(0, 2000).join(""), x: 60 + index % 6 * 220,
    y: 60 + Math.floor(index / 6) * 140, width: 180, height: 90,
    shape: "rectangle", color: "#8067ca", group: "", concept_id: conceptId,
  };
  return { ...map, nodes: [...map.nodes, node] };
}

export function connectionGeometry(from, to) {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const dx = b.x - a.x, dy = b.y - a.y;
  function boundary(node, center, direction) {
    if (!dx && !dy) return center;
    const scale = node.shape === "circle"
      ? 1 / Math.sqrt((dx / (node.width / 2)) ** 2 + (dy / (node.height / 2)) ** 2)
      : Math.min(dx ? node.width / 2 / Math.abs(dx) : Infinity, dy ? node.height / 2 / Math.abs(dy) : Infinity);
    return { x: center.x + dx * scale * direction, y: center.y + dy * scale * direction };
  }
  return { from: boundary(from, a, 1), to: boundary(to, b, -1) };
}

export function copyMapSelection(map, ids) {
  return { nodes: map.nodes.filter((node) => ids.includes(node.id)).map((node) => ({ ...node })),
    edges: map.edges.filter((edge) => ids.includes(edge.from) && ids.includes(edge.to)).map((edge) => ({ ...edge })) };
}

export function pasteMapSelection(map, clipboard) {
  const ids = clipboard.nodes.map((node) => node.id);
  const pasted = cloneMapSelection({ ...map, nodes: clipboard.nodes, edges: clipboard.edges }, ids);
  const newNodes = pasted.nodes.slice(clipboard.nodes.length);
  const newEdges = pasted.edges.slice(clipboard.edges.length);
  if (map.nodes.length + newNodes.length > 300 || map.edges.length + newEdges.length > 600) throw new Error("map_limit");
  return { ...map, nodes: [...map.nodes, ...newNodes], edges: [...map.edges, ...newEdges] };
}

export function removeMapNodes(map, ids) {
  return { ...map, nodes: map.nodes.filter((node) => !ids.includes(node.id)),
    edges: map.edges.filter((edge) => !ids.includes(edge.from) && !ids.includes(edge.to)) };
}

export function cloneMapSelection(map, ids) {
  const selected = map.nodes.filter((node) => ids.includes(node.id));
  const replacements = new Map(selected.map((node) => [node.id, newId()]));
  if (map.nodes.length + selected.length > 300) throw new Error("map_limit");
  const edges = map.edges.filter((edge) => replacements.has(edge.from) && replacements.has(edge.to))
    .map((edge) => ({ ...edge, id: newId(), from: replacements.get(edge.from), to: replacements.get(edge.to) }));
  if (map.edges.length + edges.length > 600) throw new Error("map_limit");
  return { ...map,
    nodes: [...map.nodes, ...selected.map((node) => ({ ...node, id: replacements.get(node.id), x: node.x + 30, y: node.y + 30 }))],
    edges: [...map.edges, ...edges] };
}

export function arrangeMap(map) {
  return { ...map, nodes: map.nodes.map((node, index) => ({
    ...node, x: 60 + index % 8 * 240, y: 60 + Math.floor(index / 8) * 160,
  })) };
}

export function formatNotebookText(text, selectionStart, selectionEnd, type) {
  const selected = text.slice(selectionStart, selectionEnd);
  const prefix = { heading: "# ", bullet: "- ", numbered: "1. " }[type];
  const formatted = prefix ? selected.split("\n").map((line) => prefix + line).join("\n")
    : type === "bold" ? `**${selected}**` : `_${selected}_`;
  return text.slice(0, selectionStart) + formatted + text.slice(selectionEnd);
}

export function documentSize(record) {
  return new globalThis.TextEncoder().encode(JSON.stringify(record.content)).length;
}

/** Bootstrap is newest-first; local pending answers append without a server timestamp. */
export function latestExplainAttempt(attempts) {
  return attempts.reduce((latest, attempt) => {
    if (!latest) return attempt;
    const nextTime = Date.parse(attempt.created_at);
    const currentTime = Date.parse(latest.created_at);
    if (!Number.isFinite(nextTime)) return attempt;
    if (!Number.isFinite(currentTime)) return latest;
    return nextTime >= currentTime ? attempt : latest;
  }, null);
}
