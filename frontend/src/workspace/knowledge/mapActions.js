import { addMapNode, newId } from "./model.js";

export function linkIdeas(map, from, to, label = "", style = "solid") {
  if (from === to || map.edges.length >= 600 || !map.nodes.some(node => node.id === from) || !map.nodes.some(node => node.id === to) || map.edges.some(edge => edge.from === from && edge.to === to)) return map;
  return { ...map, edges: [...map.edges, { id: newId(), from, to, label, style }] };
}

export function addIdea(map, text, parentId = "", centerX = 60) {
  if (!text.trim() || map.nodes.length >= 300 || (parentId && map.edges.length >= 600)) return map;
  const parent = map.nodes.find(node => node.id === parentId);
  if (parentId && !parent) return map;
  const next = addMapNode(map, text.trim());
  const node = next.nodes.at(-1), anchor = parent || map.nodes.at(-1);
  node.width = 190; node.height = 64;
  node.x = anchor ? Math.min(9000, anchor.x + (parent ? 28 : 0)) : Math.max(0, Math.min(9000, centerX));
  node.y = anchor ? Math.min(9000, anchor.y + anchor.height + 70) : 60;
  if (parent) node.color = parent.color;
  while (map.nodes.some(other => node.x < other.x + other.width + 24 && node.x + node.width + 24 > other.x && node.y < other.y + other.height + 24 && node.y + node.height + 24 > other.y)) {
    if (node.y + node.height + 70 <= 9000) node.y += node.height + 70;
    else if (node.x + node.width + 60 <= 9000) { node.x += node.width + 60; node.y = 60; }
    else return map;
  }
  return parent ? linkIdeas(next, parent.id, node.id) : next;
}

export function curvedConnection(from, to) {
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const b = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const vertical = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x);
  const sign = (vertical ? b.y >= a.y : b.x >= a.x) ? 1 : -1;
  if (vertical) { a.y += from.height / 2 * sign; b.y -= to.height / 2 * sign; }
  else { a.x += from.width / 2 * sign; b.x -= to.width / 2 * sign; }
  const bend = Math.max(32, Math.abs(vertical ? b.y - a.y : b.x - a.x) / 2);
  const c = vertical ? { x: a.x, y: a.y + bend * sign } : { x: a.x + bend * sign, y: a.y };
  const d = vertical ? { x: b.x, y: b.y - bend * sign } : { x: b.x - bend * sign, y: b.y };
  return { path: `M ${a.x} ${a.y} C ${c.x} ${c.y}, ${d.x} ${d.y}, ${b.x} ${b.y}`, to: b, label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

export function fitIdeas(nodes, width, height) {
  if (!nodes.length) return { x: 0, y: 0, zoom: 1 };
  const left = Math.min(...nodes.map(n => n.x)), right = Math.max(...nodes.map(n => n.x + n.width));
  const top = Math.min(...nodes.map(n => n.y)), bottom = Math.max(...nodes.map(n => n.y + n.height));
  const zoom = Math.max(.25, Math.min(1, (width - 48) / (right - left), (height - 48) / (bottom - top)));
  return { zoom, x: Math.max(0, (left + right) * zoom / 2 - width / 2), y: Math.max(0, (top + bottom) * zoom / 2 - height / 2) };
}
