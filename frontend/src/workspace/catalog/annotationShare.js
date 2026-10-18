import { createAnnotationStore } from "../storage/annotationStore.js";
import { groupAnnotationsByPage } from "../storage/workspaceSnapshot.js";
import { catalogWorkspaceStorageKey, serializeCatalogWorkspace } from "./catalogWorkspaceState.js";
import { isVirtualPageKey, sanitizeVirtualPages } from "./virtualPages.js";

/** The device-store key of a sheet's copied marks, apart from the student's own. */
export function marksStorageSlug(sheetSlug, marksId) {
  return marksId ? `${sheetSlug}--marks-${marksId}` : sheetSlug;
}

/**
 * What the reader shows right now, in the shape a share carries: every kind of
 * mark (ink, text, pictures, stickers), the notes and the added pages. It goes
 * through the same sanitizer the device store uses, so a share holds nothing the
 * reader would refuse to load.
 * @param {{ annotations: any[], notes: any[], virtualPages: any[] }} reader
 */
export function snapshotFromReader({ annotations, notes, virtualPages }) {
  const parsed = JSON.parse(serializeCatalogWorkspace({ annotations, notes, virtualPages }));
  return { annotations: parsed.annotations, notes: parsed.notes, virtualPages: parsed.virtualPages };
}

/**
 * The pages a share carries, in reading order. Added pages are listed even when
 * empty, because the page itself is part of what is shared.
 * @returns {{ pages: { key: number, kind: "pdf" | "added", page: number, marks: number, background?: string }[], marks: number }}
 */
export function summarizeSnapshot(snapshot) {
  const counts = new Map();
  for (const item of [...snapshot.annotations, ...snapshot.notes]) counts.set(item.page, (counts.get(item.page) || 0) + 1);
  /** @type {{ key: number, kind: "pdf" | "added", page: number, marks: number, background?: string }[]} */
  const pages = [];
  for (const [key, marks] of counts) if (!isVirtualPageKey(key)) pages.push({ key, kind: "pdf", page: key, marks });
  for (const item of sanitizeVirtualPages(snapshot.virtualPages)) {
    pages.push({ key: item.id, kind: "added", page: item.afterPage, marks: counts.get(item.id) || 0, background: item.background });
  }
  pages.sort((first, second) => (first.page - second.page) || Number(first.kind === "added") - Number(second.kind === "added"));
  let marks = 0;
  for (const value of counts.values()) marks += value;
  return { pages, marks };
}

/** The snapshot without the pages the person left out. */
export function withoutPages(snapshot, excluded) {
  if (!excluded.size) return snapshot;
  const virtualPages = snapshot.virtualPages.filter((item) => !excluded.has(item.id));
  const kept = new Set(virtualPages.map((item) => item.id));
  const keep = (item) => (isVirtualPageKey(item.page) ? kept.has(item.page) : !excluded.has(item.page));
  return { annotations: snapshot.annotations.filter(keep), notes: snapshot.notes.filter(keep), virtualPages };
}

export function snapshotBytes(snapshot) {
  return new Blob([JSON.stringify(snapshot)]).size;
}

export function snapshotFile(snapshot) {
  return new File([JSON.stringify(snapshot)], "marks.json", { type: "application/json" });
}

export function isEmptySnapshot(snapshot) {
  return !snapshot.annotations.length && !snapshot.notes.length && !snapshot.virtualPages.length;
}

/**
 * Stores a copy's starting marks in the reader's own device store, which is the
 * place the reader loads from. The first server sync then uploads them like any
 * other local work. Falls back to localStorage where IndexedDB is refused.
 */
export async function seedDeviceStore({ owner, materialSlug, sheetSlug, seed }) {
  const snapshot = {
    annotations: Array.isArray(seed?.annotations) ? seed.annotations : [],
    notes: Array.isArray(seed?.notes) ? seed.notes : [],
    virtualPages: sanitizeVirtualPages(seed?.virtualPages)
  };
  const view = { page: 1, zoom: 1, zoomFitBasis: 0, scrollLeft: 0, scrollTop: 0, pageOffset: 0 };
  const store = createAnnotationStore();
  try {
    await store.open();
    const existing = await store.readDocument({ owner, materialSlug, sheetSlug });
    // Marks already on this device mean an earlier open stored the seed.
    if (existing && (existing.annotations.length || existing.notes.length || existing.virtualPages.length)) return true;
    await store.writeDocument({
      owner, materialSlug, sheetSlug, view,
      notes: snapshot.notes,
      virtualPages: snapshot.virtualPages,
      pages: groupAnnotationsByPage(snapshot.annotations),
      removedPages: []
    });
    return true;
  } catch {
    try {
      window.localStorage.setItem(
        catalogWorkspaceStorageKey(owner, materialSlug, sheetSlug),
        serializeCatalogWorkspace({ ...snapshot, ...view })
      );
      return true;
    } catch {
      return false;
    }
  } finally {
    store.close?.();
  }
}
