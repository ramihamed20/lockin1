const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeToolColor(color) {
  return typeof color === "string" && HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

export function normalizeSavedPalette(colors, limit = 5) {
  const palette = [];
  const seen = new Set();
  for (const color of Array.isArray(colors) ? colors : []) {
    const normalized = normalizeToolColor(color);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    palette.push(normalized);
    if (palette.length >= limit) break;
  }
  return palette;
}

export function addSavedColor(colors, color, limit = 5, reservedColors = []) {
  const normalized = normalizeToolColor(color);
  const reserved = new Set(normalizeSavedPalette(reservedColors, limit));
  const customLimit = Math.max(0, limit - reserved.size);
  const current = normalizeSavedPalette(colors, Math.max(1, Array.isArray(colors) ? colors.length : 0)).filter((item) => !reserved.has(item)).slice(0, customLimit);
  if (!normalized || reserved.has(normalized)) return current;
  if (!current.includes(normalized) && current.length >= customLimit) return current;
  return normalizeSavedPalette([normalized, ...current], customLimit);
}

export function removeSavedColor(colors, color, limit = 5, reservedColors = []) {
  const normalized = normalizeToolColor(color);
  const reserved = new Set(normalizeSavedPalette(reservedColors, limit));
  const customLimit = Math.max(0, limit - reserved.size);
  return normalizeSavedPalette(colors, Math.max(1, Array.isArray(colors) ? colors.length : 0)).filter((item) => item !== normalized && !reserved.has(item)).slice(0, customLimit);
}
