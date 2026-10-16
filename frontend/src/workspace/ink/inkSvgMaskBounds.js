export function inkSvgMaskBounds(annotation) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const point of annotation.points || []) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
            continue;
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    }
    if (!Number.isFinite(left))
        return { x: 0, y: 0, width: 1000, height: 1000 };
    const radius = Math.max(.6, Number(annotation.width || 4) * 2.25 / 2) + 8;
    const dx = radius + (annotation.type === "highlighter" ? (right - left) * .165 : 0);
    const dy = radius + (annotation.type === "highlighter" ? (bottom - top) * .165 : 0);
    const x = Math.max(0, left - dx), y = Math.max(0, top - dy);
    return { x, y, width: Math.max(.01, Math.min(1000, right + dx) - x), height: Math.max(.01, Math.min(1000, bottom + dy) - y) };
}
