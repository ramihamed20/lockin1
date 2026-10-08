// Keep a bulk action bounded, without cutting an answer between its lines.
export const MAX_COVERS_PER_ACTION = 1000;

export function coverRectangle(rectangle) {
  const width = Math.min(1000, Math.max(6, Number(rectangle.width) || 6));
  const height = Math.min(1000, Math.max(6, Number(rectangle.height) || 6));
  return {
    width, height,
    x: Math.min(1000 - width, Math.max(0, Number(rectangle.x) || 0)),
    y: Math.min(1000 - height, Math.max(0, Number(rectangle.y) || 0))
  };
}

function rectangleKey(page, rectangle) {
  const bounds = coverRectangle(rectangle);
  return [page, bounds.x, bounds.y, bounds.width, bounds.height].map((value) => typeof value === "number" ? Math.round(value * 100) / 100 : value).join(":");
}

export function coveredSearchMatchIds(matches, annotations) {
  const covered = new Set(annotations.filter((item) => item.type === "cover").map((item) => rectangleKey(item.page, item)));
  return new Set(matches.filter((match) => match.rectangles.length && match.rectangles.every((rectangle) => covered.has(rectangleKey(match.page, rectangle)))).map((match) => match.id));
}

export function searchCoverEntries(matches, annotations, createId) {
  const covered = new Map(annotations.filter((item) => item.type === "cover").map((item) => [rectangleKey(item.page, item), item]));
  return matches.flatMap((match) => {
    const missing = match.rectangles.filter((rectangle) => !covered.has(rectangleKey(match.page, rectangle)));
    if (!missing.length) return [];
    // Restore a removed line to its answer's existing group, without stacking
    // another solid cover over the lines that are already hidden.
    const existingGroup = match.rectangles.map((rectangle) => covered.get(rectangleKey(match.page, rectangle))?.groupId).find(Boolean);
    const groupId = match.rectangles.length > 1 ? existingGroup || createId() : "";
    return missing.map((rectangle) => {
      const entry = { page: match.page, kind: "text", label: match.snippet.match, groupId, ...coverRectangle(rectangle) };
      covered.set(rectangleKey(match.page, rectangle), entry);
      return entry;
    });
  });
}
