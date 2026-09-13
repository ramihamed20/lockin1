import { catalogWorkspaceApi } from "../../api/catalogWorkspace.js";
import { focusApi } from "../../api/focus.js";
import { generateIdempotencyKey } from "../../api/pagination.js";
import {
  catalogAnnotationToFocus,
  focusAnnotationSignature,
  focusAnnotationToCatalog,
  isServerSyncableAnnotation
} from "./focusAnnotationAdapter.js";

/**
 * Server sync for one catalog sheet, owned by one signed-in reader.
 *
 * The backend keeps two records, each revisioned and idempotent:
 * - the reader state (page, zoom, notes) in CatalogWorkspaceSnapshot, and
 * - the ink in the Focus annotation collection of the sheet's document version.
 *
 * The device's own store stays the source of truth for editing; this mirrors
 * it. Every request carries an idempotency key that is kept for as long as its
 * payload is unchanged, so a request whose response was lost to a dropped
 * connection is replayed by the server rather than applied twice.
 *
 * Merging is three-way, by id, against the baseline this device last agreed
 * with the server. That is what tells "deleted here" apart from "added on
 * another device" without trusting any clock, and it never touches annotations
 * the server cannot hold (images, triangles, pre-UUID ids).
 */

const MAX_SYNC_MUTATIONS = 100;
const PAGES_PER_READ = 10;
const TRANSIENT_CODES = new Set(["network_error", "offline", "timeout"]);
const BASELINE_PREFIX = "lock-in.catalog-sync.v1";

/** A failure worth retrying once the connection returns. */
export function isTransientSyncError(error) {
  if (error?.code === "invalid_response") return false;
  const status = Number(error?.status);
  return TRANSIENT_CODES.has(error?.code) || status === 429 || status >= 500;
}

/** The server no longer lets this reader write here; stop trying. */
function isAccessError(error) {
  return [401, 403, 404].includes(Number(error?.status));
}

function unavailable(message) {
  return Object.assign(new Error(message), { code: "invalid_response" });
}

/** cyrb53: a compact, stable fingerprint so the baseline stays small. */
export function fingerprint(value) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const annotationPrint = (item) => fingerprint(focusAnnotationSignature(item));
const notePrint = (note) => fingerprint(JSON.stringify(note));

/**
 * Three-way merge by id. `base` holds the fingerprints both sides agreed on at
 * the last sync; an id missing from it is new on whichever side holds it.
 * Where both sides changed the same item, this device wins: it is the one in
 * use, and the other change is still on the other device to re-apply.
 * @template {{ id: string }} T
 * @param {{ local: T[], remote: T[], base: Map<string, string>, print: (item: T) => string }} input
 * @returns {{ items: T[], localChanged: boolean }}
 */
export function mergeById({ local, remote, base, print }) {
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const localIds = new Set(local.map((item) => item.id));
  const items = [];
  let localChanged = false;
  for (const item of local) {
    const other = remoteById.get(item.id);
    const mine = print(item);
    const known = base.get(item.id);
    if (other) {
      const theirs = print(other);
      // Only the other side changed it: take theirs. Equal prints keep this
      // device's richer object (the server drops smoothing, text size, ...).
      if (mine !== theirs && mine === known) { items.push(other); localChanged = true; } else items.push(item);
    } else if (known !== undefined && mine === known) {
      localChanged = true; // Deleted on another device and untouched here.
    } else {
      items.push(item); // New here, or edited here after another device deleted it.
    }
  }
  for (const item of remote) {
    if (localIds.has(item.id)) continue;
    const known = base.get(item.id);
    // Deleted here since the last sync, and not edited elsewhere since: stays deleted.
    if (known !== undefined && known === print(item)) continue;
    items.push(item);
    localChanged = true;
  }
  return { items, localChanged };
}

function readBaseline(storage, key) {
  try {
    const stored = JSON.parse(storage?.getItem(key) || "null");
    return {
      annotations: new Map(Object.entries(stored?.annotations || {})),
      notes: new Map(Object.entries(stored?.notes || {}))
    };
  } catch {
    return { annotations: new Map(), notes: new Map() };
  }
}

/**
 * @param {{ documentId: string, documentVersionId: string, owner: string, storage?: Storage | null, catalog?: any, focus?: any, idFactory?: () => string }} options
 */
export function createCatalogServerSync({
  documentId,
  documentVersionId,
  owner,
  storage = globalThis.localStorage ?? null,
  catalog = catalogWorkspaceApi,
  focus = focusApi,
  idFactory = generateIdempotencyKey
}) {
  const baselineKey = `${BASELINE_PREFIX}.${String(owner || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_")}.${documentId}`;
  let workspaceRevision = null;
  let collectionRevision = 0;
  let remote = null;
  /** @type {Map<string, string>} annotation id -> fingerprint the server holds */
  const syncedAnnotations = new Map();
  /** @type {Map<string, string>} note id -> fingerprint the server holds */
  let syncedNotes = new Map();
  let syncedView = null;
  const workspaceSyncKey = { current: null };
  const annotationSyncKey = { current: null };
  let disabled = false;
  let latest = null;
  let inFlight = null;
  let pending = false;

  function keyFor(slot, payload) {
    const digest = JSON.stringify(payload);
    if (slot.current?.digest !== digest) slot.current = { digest, key: idFactory() };
    return slot.current.key;
  }

  function saveBaseline() {
    try {
      storage?.setItem(baselineKey, JSON.stringify({
        annotations: Object.fromEntries(syncedAnnotations),
        notes: Object.fromEntries(syncedNotes)
      }));
    } catch {
      // Without a baseline the next merge treats both sides as additions, which
      // keeps everything; nothing is lost, a deletion may simply return.
    }
  }

  async function readCollection(pageCount) {
    const annotations = [];
    let revision = 0;
    for (let first = 1; first <= pageCount; first += PAGES_PER_READ) {
      const pages = Array.from({ length: Math.min(PAGES_PER_READ, pageCount - first + 1) }, (_, index) => first + index);
      for (let page = 1; ; page += 1) {
        const result = await focus.getAnnotations(documentVersionId, { pages, page, pageSize: 250 });
        revision = Math.max(revision, result.collection_revision);
        annotations.push(...result.results);
        if (!result.next) break;
      }
    }
    return { revision, annotations };
  }

  /**
   * Reads what the server holds for this sheet.
   * @param {{ pageCount: number }} options
   */
  async function load({ pageCount }) {
    const workspace = await catalog.get(documentId);
    if (!workspace || typeof workspace.revision !== "number" || !workspace.state || typeof workspace.state !== "object") {
      throw unavailable("The catalog workspace response was incomplete.");
    }
    const collection = await readCollection(Math.max(1, Math.floor(pageCount) || 1));
    const annotations = collection.annotations.map(focusAnnotationToCatalog).filter(Boolean);
    const notes = Array.isArray(workspace.state.notes) ? workspace.state.notes.filter((note) => typeof note?.id === "string") : [];
    workspaceRevision = workspace.revision;
    collectionRevision = collection.revision;
    syncedAnnotations.clear();
    for (const item of annotations) syncedAnnotations.set(item.id, annotationPrint(item));
    syncedNotes = new Map(notes.map((note) => [note.id, notePrint(note)]));
    syncedView = JSON.stringify(workspace.state.view ?? null);
    remote = { annotations, notes };
  }

  /**
   * Merges this device's content with the server's copy read by `load`.
   * @param {{ annotations: any[], notes: any[] }} local
   * @returns {{ annotations: any[], notes: any[], localChanged: boolean }}
   */
  function reconcile(local) {
    if (!remote) return { annotations: local.annotations, notes: local.notes, localChanged: false };
    const base = readBaseline(storage, baselineKey);
    const deviceOnly = local.annotations.filter((item) => !isServerSyncableAnnotation(item));
    const annotations = mergeById({
      local: local.annotations.filter(isServerSyncableAnnotation),
      remote: remote.annotations,
      base: base.annotations,
      print: annotationPrint
    });
    const notes = mergeById({ local: local.notes, remote: remote.notes, base: base.notes, print: notePrint });
    remote = null;
    return {
      annotations: [...annotations.items, ...deviceOnly],
      notes: notes.items,
      localChanged: annotations.localChanged || notes.localChanged
    };
  }

  async function sendAnnotations(annotations, deletedIds) {
    const expected = collectionRevision;
    const idempotencyKey = keyFor(annotationSyncKey, { expected, annotations, deletedIds });
    const result = await focus.syncAnnotations(documentVersionId, {
      expectedCollectionRevision: expected,
      idempotencyKey,
      annotations,
      deletedIds
    });
    if (typeof result?.collection_revision !== "number") throw unavailable("The annotation sync response was incomplete.");
    annotationSyncKey.current = null;
    collectionRevision = result.collection_revision;
  }

  async function pushAnnotations(annotations) {
    const current = new Map();
    for (const item of annotations || []) if (isServerSyncableAnnotation(item)) current.set(item.id, item);
    const mutations = [];
    for (const [id, item] of current) {
      const print = annotationPrint(item);
      if (syncedAnnotations.get(id) !== print) mutations.push({ id, print, wire: catalogAnnotationToFocus(item) });
    }
    for (const id of syncedAnnotations.keys()) if (!current.has(id)) mutations.push({ id, print: null, wire: null });
    for (let start = 0; start < mutations.length; start += MAX_SYNC_MUTATIONS) {
      const batch = mutations.slice(start, start + MAX_SYNC_MUTATIONS);
      await sendAnnotations(
        batch.filter((item) => item.wire).map((item) => item.wire),
        batch.filter((item) => !item.wire).map((item) => item.id)
      );
      for (const item of batch) {
        if (item.wire) syncedAnnotations.set(item.id, item.print);
        else syncedAnnotations.delete(item.id);
      }
      saveBaseline();
    }
    // Also when nothing was sent: the merged content now matches the server,
    // and that agreement is the baseline the next merge needs. This only runs
    // from `push`, after the caller has applied the merge locally.
    saveBaseline();
  }

  async function pushReaderState(snapshot) {
    const notes = Array.isArray(snapshot.notes) ? snapshot.notes : [];
    const view = snapshot.view ? { page: Number(snapshot.view.page) || 1, zoom: Number(snapshot.view.zoom) || 1 } : null;
    const notePrints = new Map(notes.map((note) => [note.id, notePrint(note)]));
    const notesChanged = notePrints.size !== syncedNotes.size || [...notePrints].some(([id, print]) => syncedNotes.get(id) !== print);
    if (!notesChanged && JSON.stringify(view) === syncedView) return;
    const state = { savedAt: snapshot.savedAt, view, notes };
    const expected = workspaceRevision;
    const idempotencyKey = keyFor(workspaceSyncKey, { expected, state });
    const result = await catalog.save(documentId, expected, state, idempotencyKey);
    if (typeof result?.revision !== "number") throw unavailable("The catalog workspace response was incomplete.");
    workspaceSyncKey.current = null;
    workspaceRevision = result.revision;
    syncedNotes = notePrints;
    syncedView = JSON.stringify(view);
    saveBaseline();
  }

  async function drain() {
    while (latest) {
      const snapshot = latest;
      latest = null;
      try {
        await pushAnnotations(snapshot.annotations);
        await pushReaderState(snapshot);
      } catch (error) {
        // Keep the newest unsent snapshot for the next attempt.
        latest = latest || snapshot;
        if (isAccessError(error)) disabled = true;
        return { status: isTransientSyncError(error) ? "offline" : "failed", error };
      }
    }
    pending = false;
    return { status: "synced" };
  }

  /**
   * Mirrors a local snapshot. Calls made while a sync runs are coalesced into
   * one follow-up push of the newest snapshot.
   * @param {{ savedAt: string, view: any, notes: any[], annotations: any[] }} snapshot
   */
  function push(snapshot) {
    if (disabled || workspaceRevision === null) return Promise.resolve({ status: "unavailable" });
    latest = snapshot;
    pending = true;
    if (!inFlight) inFlight = drain().finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Re-sends the newest unsent snapshot, for example when the connection returns. */
  function retry() {
    return latest && !inFlight ? push(latest) : Promise.resolve({ status: pending ? "offline" : "synced" });
  }

  /** Check revisions cheaply, downloading full state only when they moved. */
  async function refresh({ pageCount, local }) {
    if (disabled || workspaceRevision === null) return { changed: false, unavailable: true };
    const result = await catalog.probe(documentId);
    if (
      typeof result?.revision !== "number"
      || typeof result?.collection_revision !== "number"
      || typeof result?.document_version_id !== "string"
    ) throw unavailable("The catalog workspace probe was incomplete.");
    if (result.document_version_id !== documentVersionId) {
      return { changed: false, documentChanged: true };
    }
    if (
      result.revision === workspaceRevision
      && result.collection_revision === collectionRevision
    ) return { changed: false };
    await load({ pageCount });
    return { changed: true, ...reconcile(local) };
  }

  return {
    load,
    reconcile,
    push,
    retry,
    refresh,
    hasPending: () => pending,
    isLoaded: () => workspaceRevision !== null && !disabled
  };
}
