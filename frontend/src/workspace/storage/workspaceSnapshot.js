import { sanitizeCatalogAnnotation, sanitizeCatalogNote } from "../catalog/catalogWorkspaceState.js";

/**
 * Pure snapshot helpers shared by the IndexedDB store and the backup files.
 *
 * Everything that decides *what* is written, *which pages changed*, and
 * *whether an imported file is safe* lives here so it can be tested without a
 * browser. The store module below it only moves already-validated records.
 */

export const WORKSPACE_RECORD_VERSION = 1;
export const WORKSPACE_EXPORT_KIND = "lock-in.focus-workspace.backup";
export const MAX_IMPORT_BYTES = 8_000_000;
export const MAX_IMPORT_ANNOTATIONS = 5_000;
export const MAX_IMPORT_NOTES = 500;

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/i;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Annotations for a signed-out reader stay on the device under their own owner,
 * so signing in never adopts them and signing out never exposes another
 * account's work.
 */
export function ownerStorageKey(user) {
  const id = user?.id;
  if (typeof id === "string" && id.trim()) return `user:${id.trim().slice(0, 120)}`;
  if (typeof id === "number" && Number.isFinite(id)) return `user:${id}`;
  return "device";
}

export function workspaceDocumentId(owner, materialSlug, sheetSlug) {
  return `${owner}::${materialSlug}::${sheetSlug}`;
}

export function workspacePageId(documentId, page) {
  return `${documentId}::${Math.max(1, Math.round(finite(page, 1)))}`;
}

/**
 * Every edit path produces new annotation objects, so object identity is an
 * exact and allocation-free change signal. Comparing ids alone would miss an
 * erase or a transform that keeps the id and replaces the geometry.
 */
export function createAnnotationRevisionIndex() {
  const serials = new WeakMap();
  let nextSerial = 1;
  return {
    serialFor(annotation) {
      if (!annotation || typeof annotation !== "object") return 0;
      const existing = serials.get(annotation);
      if (existing) return existing;
      const serial = nextSerial;
      nextSerial += 1;
      serials.set(annotation, serial);
      return serial;
    }
  };
}

/** @returns {Map<number, any[]>} */
export function groupAnnotationsByPage(annotations) {
  const pages = new Map();
  for (const annotation of annotations || []) {
    const page = Math.max(1, Math.round(finite(annotation?.page, 1)));
    const bucket = pages.get(page);
    if (bucket) bucket.push(annotation);
    else pages.set(page, [annotation]);
  }
  return pages;
}

/** @returns {Map<number, string>} */
export function pageSignatures(annotationsByPage, revisionIndex) {
  const signatures = new Map();
  annotationsByPage.forEach((annotations, page) => {
    let signature = "";
    for (const annotation of annotations) signature += `${revisionIndex.serialFor(annotation)},`;
    signatures.set(page, signature);
  });
  return signatures;
}

/**
 * @param {Map<number, string>} previous
 * @param {Map<number, string>} next
 * @returns {{ changed: number[], removed: number[] }}
 */
export function changedPages(previous, next) {
  const changed = [];
  const removed = [];
  next.forEach((signature, page) => {
    if (previous.get(page) !== signature) changed.push(page);
  });
  previous.forEach((_signature, page) => {
    if (!next.has(page)) removed.push(page);
  });
  return { changed, removed };
}

export function sanitizeViewState(view) {
  return {
    page: Math.max(1, Math.round(finite(view?.page, 1))),
    zoom: Math.min(5, Math.max(0.5, finite(view?.zoom, 1))),
    // The fit-to-width scale the stored zoom was measured against. Without it a
    // zoom saved on a wide screen restores as the same page width on a narrow
    // one, leaving most of the page outside the viewport. Zero means "unknown",
    // which the reader treats as fit-to-width.
    zoomFitBasis: Math.min(5, Math.max(0, finite(view?.zoomFitBasis, 0))),
    scrollLeft: Math.max(0, finite(view?.scrollLeft, 0)),
    scrollTop: Math.max(0, finite(view?.scrollTop, 0)),
    pageOffset: Math.min(1, Math.max(0, finite(view?.pageOffset, 0)))
  };
}

/** Drops records that cannot be trusted instead of failing the whole document. */
export function sanitizeStoredAnnotations(annotations) {
  return (Array.isArray(annotations) ? annotations : [])
    .map((annotation) => {
      try {
        return sanitizeCatalogAnnotation(annotation);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function sanitizeStoredNotes(notes) {
  return (Array.isArray(notes) ? notes : [])
    .map((note) => {
      try {
        return sanitizeCatalogNote(note);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function buildExportPayload({ materialSlug, sheetSlug, materialTitle = "", sheetTitle = "", annotations, notes, view, savedAt = new Date().toISOString() }) {
  return {
    kind: WORKSPACE_EXPORT_KIND,
    version: WORKSPACE_RECORD_VERSION,
    savedAt,
    document: {
      materialSlug: String(materialSlug || ""),
      sheetSlug: String(sheetSlug || ""),
      materialTitle: String(materialTitle || "").slice(0, 200),
      sheetTitle: String(sheetTitle || "").slice(0, 200)
    },
    view: sanitizeViewState(view),
    annotations: sanitizeStoredAnnotations(annotations).slice(-MAX_IMPORT_ANNOTATIONS),
    notes: sanitizeStoredNotes(notes).slice(-MAX_IMPORT_NOTES)
  };
}

export function exportFileName({ materialSlug, sheetSlug, savedAt = new Date().toISOString() }) {
  const stamp = String(savedAt).slice(0, 10);
  const slug = `${materialSlug || "workspace"}-${sheetSlug || "sheet"}`.replace(/[^a-z0-9-]+/gi, "-").slice(0, 80);
  return `lock-in-${slug}-${stamp}.json`;
}

/**
 * Validates a backup file before any of it reaches the workspace.
 * @param {string} text
 * @param {{ materialSlug?: string, sheetSlug?: string }} [expected]
 * @returns {{ ok: boolean, reason?: string, matchesDocument?: boolean, payload?: any }}
 */
export function parseImportPayload(text, expected = {}) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "This file is empty." };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, reason: "This backup is too large to restore." };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "This file is not a Lock-in workspace backup." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "This file is not a Lock-in workspace backup." };
  }
  // Defence in depth: nothing is merged into an existing object, but a payload
  // carrying these keys is never a legitimate backup.
  for (const key of Object.keys(parsed)) {
    if (UNSAFE_KEYS.has(key)) return { ok: false, reason: "This backup contains unsupported fields." };
  }
  if (parsed.kind !== WORKSPACE_EXPORT_KIND) return { ok: false, reason: "This file is not a Lock-in workspace backup." };
  if (parsed.version !== WORKSPACE_RECORD_VERSION) {
    return { ok: false, reason: "This backup was made by a different version of the workspace." };
  }
  const document = parsed.document && typeof parsed.document === "object" ? parsed.document : {};
  const materialSlug = typeof document.materialSlug === "string" ? document.materialSlug : "";
  const sheetSlug = typeof document.sheetSlug === "string" ? document.sheetSlug : "";
  if (!SAFE_SLUG.test(materialSlug) || !SAFE_SLUG.test(sheetSlug)) {
    return { ok: false, reason: "This backup does not name a valid sheet." };
  }
  const annotations = sanitizeStoredAnnotations(parsed.annotations).slice(-MAX_IMPORT_ANNOTATIONS);
  const notes = sanitizeStoredNotes(parsed.notes).slice(-MAX_IMPORT_NOTES);
  if (!annotations.length && !notes.length) return { ok: false, reason: "This backup contains no marks or notes." };
  return {
    ok: true,
    matchesDocument: materialSlug === expected.materialSlug && sheetSlug === expected.sheetSlug,
    payload: {
      materialSlug,
      sheetSlug,
      materialTitle: typeof document.materialTitle === "string" ? document.materialTitle.slice(0, 200) : "",
      sheetTitle: typeof document.sheetTitle === "string" ? document.sheetTitle.slice(0, 200) : "",
      view: sanitizeViewState(parsed.view),
      annotations,
      notes
    }
  };
}

/**
 * Restores without discarding work: anything already present under the same id
 * is kept, and the backup only contributes what is missing.
 */
export function mergeRestoredAnnotations(current, restored) {
  const existing = new Set((current || []).map((annotation) => annotation.id));
  const additions = (restored || []).filter((annotation) => !existing.has(annotation.id));
  return { merged: [...(current || []), ...additions], added: additions.length, skipped: (restored || []).length - additions.length };
}

export function mergeRestoredNotes(current, restored) {
  const existing = new Set((current || []).map((note) => note.id));
  const additions = (restored || []).filter((note) => !existing.has(note.id));
  return { merged: [...(current || []), ...additions], added: additions.length };
}
