/**
 * The Focus workspace's floating YouTube player is mounted once, beside the
 * kept readers, so a video keeps playing while the student moves between tabs.
 * Any reader's "+" menu asks for it through this one event.
 */

export const FOCUS_VIDEO_EVENT = "lock-in:focus-video";

export function requestFocusVideo() {
  if (globalThis.CustomEvent) globalThis.dispatchEvent?.(new globalThis.CustomEvent(FOCUS_VIDEO_EVENT));
}

export const VIDEO_RATIO = 16 / 9;
export const MIN_VIDEO_WIDTH = 220;

/**
 * The panel after dragging one of its edges or corners. The video keeps its
 * 16:9 shape, so any edge sets the width (a top or bottom edge through the
 * height it implies); a corner follows whichever direction moved further. The
 * opposite edge stays where it was, and the panel never leaves the screen.
 * @param {{ edge: string, dx: number, dy: number, start: { x: number, y: number, width: number, height: number }, viewport: { width: number, height: number }, margin?: number, minWidth?: number }} input
 */
export function resizePanel({ edge, dx, dy, start, viewport, margin = 8, minWidth = MIN_VIDEO_WIDTH }) {
  const fromX = edge.includes("e") ? dx : edge.includes("w") ? -dx : null;
  const fromY = edge.includes("s") ? dy * VIDEO_RATIO : edge.includes("n") ? -dy * VIDEO_RATIO : null;
  const change = fromX === null ? fromY ?? 0 : fromY === null ? fromX : Math.abs(fromX) >= Math.abs(fromY) ? fromX : fromY;
  const extra = start.height - start.width / VIDEO_RATIO;
  // Room to grow towards the moving edges only: the opposite edges stay put.
  // (A bottom edge alone grows the width to the right, its left side pinned.)
  const roomX = edge.includes("w") ? start.x + start.width - margin : viewport.width - margin - start.x;
  const roomY = edge.includes("n") ? start.y + start.height - margin : viewport.height - margin - start.y;
  const maxWidth = Math.max(minWidth, Math.min(roomX, (roomY - extra) * VIDEO_RATIO));
  const width = Math.round(Math.min(maxWidth, Math.max(minWidth, start.width + change)));
  const height = width / VIDEO_RATIO + extra;
  return {
    width,
    x: Math.round(edge.includes("w") ? start.x + start.width - width : start.x),
    y: Math.round(edge.includes("n") ? start.y + start.height - height : start.y)
  };
}

/** Keeps a floating panel of `width` x `height` inside a viewport, with a margin. */
export function clampPanelPosition({ x, y }, { width, height }, viewport, margin = 8) {
  const maxX = Math.max(margin, viewport.width - width - margin);
  const maxY = Math.max(margin, viewport.height - height - margin);
  return {
    x: Math.round(Math.min(maxX, Math.max(margin, x))),
    y: Math.round(Math.min(maxY, Math.max(margin, y)))
  };
}
