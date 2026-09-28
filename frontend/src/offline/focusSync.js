import { groupAnnotationsByPage } from "../workspace/storage/workspaceSnapshot.js";
import { createAnnotationStore } from "../workspace/storage/annotationStore.js";
import { enqueueOperation, listOperations, registerOperationHandler, removeOperation, saveOperation } from "./queue.js";

/**
 * Focus Workspace in the shared offline queue.
 *
 * Focus already keeps the device's copy authoritative in its own IndexedDB
 * store and mirrors it to Django with a three-way merge. That persistence is
 * untouched. What the queue adds is durability of the *intent to sync*: a
 * document changed while offline is recorded here, so it reaches the server
 * on the next connection even if the sheet is never opened again. The record
 * carries identifiers only; the marks themselves stay in the Focus store, and
 * device-only content (inserted images, pre-UUID marks) remains device-only,
 * exactly as before.
 */

const OPERATION_TYPE = "focus_document_sync";
const openDocuments = new Map();

/** @param {{ documentId: string, documentVersionId: string, scope: { edition: string, view: string }, workspaceDocumentId: string | null, owner: string, materialSlug: string, sheetSlug: string, pageCount: number }} descriptor */
export function focusEntityId(descriptor) {
  return `${descriptor.documentId}:${descriptor.scope?.edition || "university"}:${descriptor.scope?.view || "study"}`;
}

/** An open workspace syncs its own document; the queue leaves it alone. */
export function registerOpenFocusDocument(descriptor) {
  const id = focusEntityId(descriptor);
  openDocuments.set(id, (openDocuments.get(id) || 0) + 1);
  return () => {
    const count = (openDocuments.get(id) || 1) - 1;
    if (count > 0) openDocuments.set(id, count);
    else openDocuments.delete(id);
  };
}

async function existingOperation(userId, entityId) {
  return (await listOperations(userId)).find((operation) => operation.operation_type === OPERATION_TYPE && operation.entity_id === entityId
    && ["pending", "retry", "syncing"].includes(operation.sync_status));
}

/** Records, once per document, that the device holds changes the server may not. */
export async function markFocusDocumentDirty(userId, descriptor, savedAt = new Date().toISOString()) {
  if (!userId || !descriptor?.documentId || !descriptor?.documentVersionId) return;
  const entityId = focusEntityId(descriptor);
  const existing = await existingOperation(userId, entityId);
  const payload = { ...descriptor, dirty_at: savedAt };
  if (existing) {
    if (existing.payload?.dirty_at >= savedAt && existing.payload?.pageCount === descriptor.pageCount) return;
    await saveOperation(userId, { ...existing, payload });
    return;
  }
  await enqueueOperation(userId, { type: OPERATION_TYPE, entityType: "focus_document", entityId, payload, local: true });
}

/** The server now holds everything saved up to `savedAt`. */
export async function acknowledgeFocusDocument(userId, descriptor, savedAt) {
  if (!userId || !descriptor?.documentId) return;
  const existing = await existingOperation(userId, focusEntityId(descriptor));
  if (existing && String(existing.payload?.dirty_at || "") <= String(savedAt || "")) await removeOperation(userId, existing.operation_id);
}

let store = null;

/**
 * Replays one document without the workspace: read the device copy, merge it
 * with the server's exactly as the workspace does, write any change from
 * another device back, then push.
 */
async function flushDocument(_userId, operation) {
  const descriptor = operation.payload;
  if (openDocuments.has(operation.entity_id)) return "deferred";
  const { createCatalogServerSync } = await import("../workspace/catalog/catalogServerSync.js");
  store ||= createAnnotationStore();
  const local = await store.readDocument({ owner: descriptor.owner, materialSlug: descriptor.materialSlug, sheetSlug: descriptor.sheetSlug });
  if (!local) return "done";
  const sync = createCatalogServerSync({
    documentId: descriptor.documentId,
    documentVersionId: descriptor.documentVersionId,
    scope: descriptor.scope,
    workspaceDocumentId: descriptor.workspaceDocumentId,
    owner: descriptor.owner
  });
  await sync.load({ pageCount: Math.max(1, Number(descriptor.pageCount) || 1) });
  const merged = sync.reconcile({ annotations: local.annotations, notes: local.notes, virtualPages: local.virtualPages });
  if (openDocuments.has(operation.entity_id)) return "deferred";
  const savedAt = new Date().toISOString();
  if (merged.localChanged) {
    const before = new Set(local.annotations.map((item) => item.page));
    const grouped = groupAnnotationsByPage(merged.annotations);
    await store.writeDocument({
      owner: descriptor.owner,
      materialSlug: descriptor.materialSlug,
      sheetSlug: descriptor.sheetSlug,
      view: local.view,
      notes: merged.notes,
      virtualPages: merged.virtualPages,
      pages: grouped,
      removedPages: [...before].filter((page) => !grouped.has(page)),
      savedAt
    });
  }
  const outcome = await sync.push({
    savedAt,
    view: local.view ? { page: local.view.page, zoom: local.view.zoom } : null,
    notes: merged.notes,
    annotations: merged.annotations,
    virtualPages: merged.virtualPages
  });
  if (outcome.status === "offline") throw Object.assign(new Error("Focus sync is waiting for a connection."), { status: 0, code: "network_error" });
  if (outcome.status === "failed") throw outcome.error || new Error("Focus changes could not be synced.");
  return "done";
}

registerOperationHandler(OPERATION_TYPE, { execute: flushDocument });
