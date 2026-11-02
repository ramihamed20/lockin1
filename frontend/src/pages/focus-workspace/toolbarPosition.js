export const DOCK_EDGES = ['top', 'bottom', 'left', 'right', 'float'];
export const DEFAULT_DOCK = Object.freeze({ edge: 'top', x: .5, y: .25 });
export function readDock(value) {
  if (!value || !DOCK_EDGES.includes(value.edge)) return { ...DEFAULT_DOCK };
  return { edge: value.edge, x: Number.isFinite(value.x) ? Math.max(0, Math.min(1, value.x)) : .5, y: Number.isFinite(value.y) ? Math.max(0, Math.min(1, value.y)) : .25 };
}
export function clampDock(point, bounds, size) {
  return { x: Math.max(bounds.left, Math.min(bounds.right - size.width, point.x)), y: Math.max(bounds.top, Math.min(bounds.bottom - size.height, point.y)) };
}
export function snapDock(point, bounds, threshold = 24) {
  const candidates = [['top', Math.max(0, point.y - bounds.top)], ['bottom', Math.max(0, bounds.bottom - point.y)], ['left', Math.max(0, point.x - bounds.left)], ['right', Math.max(0, bounds.right - point.x)]];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][1] <= threshold ? candidates[0][0] : 'float';
}
