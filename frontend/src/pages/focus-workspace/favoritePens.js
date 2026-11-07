import { PEN_PROFILE } from "../../workspace/ink/strokeModel.js";
import { TRANSIENT_INK_KIND } from "../../workspace/ink/transientInk.js";
import { normalizeToolColor } from "../../workspace/catalog/toolPalette.js";

/**
 * Favorite pens: up to five saved pens (tool, pen type, colour, thickness and
 * opacity) the student switches to with one tap, as in Notability's favorites
 * toolbar. A per-device preference, like recent colours; never sent anywhere.
 */
export const FAVORITE_PENS_KEY = "lock-in.catalog-workspace.favorite-pens.v1";
export const FAVORITE_PENS_CHANGE_EVENT = "lock-in:favorite-pens-changed";
export const MAX_FAVORITE_PENS = 5;
export const FAVORITE_PEN_TOOLS = new Set(["pen", "highlighter"]);
const PROFILES = new Set([...Object.values(PEN_PROFILE), TRANSIENT_INK_KIND.POINTER]);

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

/** A stored favorite, or null when it cannot be trusted. */
export function normalizeFavoritePen(value) {
  if (!value || typeof value !== "object" || !FAVORITE_PEN_TOOLS.has(value.tool)) return null;
  const color = normalizeToolColor(value.color);
  if (!color) return null;
  return {
    tool: value.tool,
    profile: value.tool === "pen" && PROFILES.has(value.profile) ? value.profile : value.tool === "pen" ? PEN_PROFILE.BALL : PEN_PROFILE.HIGHLIGHTER,
    color,
    width: Math.round(clamp(value.width, 1, 12, 4) * 100) / 100,
    opacity: Math.round(clamp(value.opacity, .05, 1, value.tool === "highlighter" ? .34 : 1) * 100) / 100
  };
}

export function normalizeFavoritePens(value) {
  return (Array.isArray(value) ? value : []).map(normalizeFavoritePen).filter(Boolean).slice(0, MAX_FAVORITE_PENS);
}

export function loadFavoritePens() {
  try {
    return normalizeFavoritePens(JSON.parse(window.localStorage.getItem(FAVORITE_PENS_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function saveFavoritePens(favorites, { notify = false } = {}) {
  const normalized = normalizeFavoritePens(favorites);
  try {
    window.localStorage.setItem(FAVORITE_PENS_KEY, JSON.stringify(normalized));
    // Other mounted readers in the same tab don't receive browser storage
    // events, so notify them when the user changes a favorite pen.
    if (notify) window.dispatchEvent(new Event(FAVORITE_PENS_CHANGE_EVENT));
  } catch {
    // Favorites stay usable for this visit when storage is refused.
  }
  return normalized;
}

/** The favorite the current pen already is, or -1. */
export function matchingFavoritePen(favorites, current) {
  return favorites.findIndex((favorite) => favorite.tool === current.tool
    && (favorite.tool !== "pen" || favorite.profile === current.profile)
    && favorite.color.toLowerCase() === String(current.color || "").toLowerCase()
    && Math.abs(favorite.width - Number(current.width)) < .01
    && Math.abs(favorite.opacity - Number(current.opacity)) < .01);
}
