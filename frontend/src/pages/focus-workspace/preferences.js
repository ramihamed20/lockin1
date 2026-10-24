/** What the Focus workspace remembers on this device, and annotation copies. */
import { generateIdempotencyKey } from "../../api/pagination.js";
import { catalogWorkspaceStorageKey, parseCatalogWorkspace, selectionBounds, translateAnnotation } from "../../workspace/catalog/catalogWorkspaceState.js";
import { clampSelectionDelta } from "../../workspace/selection/selectionController.js";
import { addSavedColor } from "../../workspace/catalog/toolPalette.js";
import { COLORS, MAX_PALETTE_COLORS, RECENT_COLORS_KEY, TOOL_MEMORY_KEY, WORKSPACE_SETTINGS_KEY } from "./constants.js";

export function loadStoredWorkspace(owner, materialSlug, sheetSlug) {
  try {
    return parseCatalogWorkspace(window.localStorage.getItem(catalogWorkspaceStorageKey(owner, materialSlug, sheetSlug)));
  } catch {
    return null;
  }
}

export function loadToolMemory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TOOL_MEMORY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadRecentColors() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_COLORS_KEY) || "[]");
    return addSavedColor(parsed, null, MAX_PALETTE_COLORS, COLORS);
  } catch {
    return [];
  }
}

export function loadStringList(key, maximum = 8) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string").slice(0, maximum) : [];
  } catch { return []; }
}

export function loadWorkspaceSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WORKSPACE_SETTINGS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function cloneAnnotation(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}

export function copiedAnnotations(items, page, offset) {
  const groups = new Map();
  // The copy moves as one block and steps the other way at the page edge, so
  // it is never squashed against the edge or stacked exactly on its source.
  const bounds = selectionBounds(items);
  const forward = clampSelectionDelta(bounds, offset, offset);
  const backward = clampSelectionDelta(bounds, -offset, -offset);
  const dx = forward.dx || backward.dx;
  const dy = forward.dy || backward.dy;
  return items.map((item) => {
    const copy = cloneAnnotation(item);
    if (copy.groupId) {
      if (!groups.has(copy.groupId)) groups.set(copy.groupId, generateIdempotencyKey());
      copy.groupId = groups.get(copy.groupId);
    }
    return translateAnnotation({ ...copy, id: generateIdempotencyKey(), page, locked: false }, dx, dy);
  });
}
