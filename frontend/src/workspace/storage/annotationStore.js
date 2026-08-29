import {
  WORKSPACE_RECORD_VERSION,
  groupAnnotationsByPage,
  sanitizeStoredAnnotations,
  sanitizeStoredNotes,
  sanitizeViewState,
  workspaceDocumentId,
  workspacePageId
} from "./workspaceSnapshot.js";

/**
 * Annotation persistence.
 *
 * localStorage held the whole document in one synchronous 5 MB slot: a long
 * study session could hit quota and lose everything, and every save serialized
 * the entire sheet on the main thread. IndexedDB gives per-page records, far
 * more headroom, structured-clone writes off the parse path, and per-owner
 * isolation so two accounts on one device never see each other's marks.
 *
 * Reads and writes are transactional. A page whose record is unreadable is
 * dropped rather than failing the document.
 */

export const WORKSPACE_DB_NAME = "lock-in-workspace";
export const WORKSPACE_DB_VERSION = 1;
export const DOCUMENT_STORE = "documents";
export const PAGE_STORE = "pages";

/** @typedef {{ page: number, zoom: number, zoomFitBasis?: number, scrollLeft: number, scrollTop: number, pageOffset: number }} WorkspaceView */

export class WorkspaceStorageError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = "WorkspaceStorageError";
    this.code = code;
  }
}

function isQuotaError(error) {
  const name = String(error?.name || "");
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionSettled(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
  });
}

/**
 * @param {{ indexedDB?: IDBFactory, localStorage?: Storage }} [environment]
 */
export function createAnnotationStore(environment = {}) {
  const factory = environment.indexedDB ?? (typeof globalThis !== "undefined" ? globalThis.indexedDB : null);
  const local = environment.localStorage ?? (typeof globalThis !== "undefined" ? globalThis.localStorage : null);
  /** @type {Promise<IDBDatabase>|null} */
  let connection = null;

  function open() {
    if (!factory) return Promise.reject(new WorkspaceStorageError("Local storage is unavailable in this browser.", "unsupported"));
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      const request = factory.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENT_STORE)) database.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
        if (!database.objectStoreNames.contains(PAGE_STORE)) {
          const pages = database.createObjectStore(PAGE_STORE, { keyPath: "id" });
          pages.createIndex("documentId", "documentId", { unique: false });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        // A newer tab upgrading the schema must not leave this one holding a
        // stale connection that blocks it.
        database.onversionchange = () => {
          database.close();
          connection = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened"));
      request.onblocked = () => reject(new WorkspaceStorageError("Another tab is upgrading local storage.", "blocked"));
    }).catch((error) => {
      connection = null;
      throw error;
    });
    return connection;
  }

  async function readDocument({ owner, materialSlug, sheetSlug }) {
    const database = await open();
    const id = workspaceDocumentId(owner, materialSlug, sheetSlug);
    const transaction = database.transaction([DOCUMENT_STORE, PAGE_STORE], "readonly");
    const documentRecord = await requestResult(transaction.objectStore(DOCUMENT_STORE).get(id));
    if (!documentRecord) {
      await transactionSettled(transaction).catch(() => {});
      return null;
    }
    const pageRecords = await requestResult(transaction.objectStore(PAGE_STORE).index("documentId").getAll(id));
    await transactionSettled(transaction).catch(() => {});
    const annotations = [];
    for (const record of pageRecords || []) {
      // One corrupt page must not cost the reader the rest of the sheet.
      annotations.push(...sanitizeStoredAnnotations(record?.annotations));
    }
    annotations.sort((first, second) => (first.page - second.page) || String(first.createdAt).localeCompare(String(second.createdAt)));
    return {
      view: sanitizeViewState(documentRecord.view),
      notes: sanitizeStoredNotes(documentRecord.notes),
      annotations,
      savedAt: typeof documentRecord.savedAt === "string" ? documentRecord.savedAt : null
    };
  }

  /**
   * @param {{ owner: string, materialSlug: string, sheetSlug: string, view: WorkspaceView,
   *   notes: any[], pages: Map<number, any[]>, removedPages?: number[], savedAt?: string }} snapshot
   */
  async function writeDocument({ owner, materialSlug, sheetSlug, view, notes, pages, removedPages = [], savedAt = new Date().toISOString() }) {
    const database = await open();
    const id = workspaceDocumentId(owner, materialSlug, sheetSlug);
    try {
      const transaction = database.transaction([DOCUMENT_STORE, PAGE_STORE], "readwrite");
      const documents = transaction.objectStore(DOCUMENT_STORE);
      const pageStore = transaction.objectStore(PAGE_STORE);
      documents.put({
        id,
        owner,
        materialSlug,
        sheetSlug,
        version: WORKSPACE_RECORD_VERSION,
        savedAt,
        view: sanitizeViewState(view),
        notes: sanitizeStoredNotes(notes)
      });
      pages.forEach((annotations, page) => {
        const pageKey = workspacePageId(id, page);
        if (!annotations.length) pageStore.delete(pageKey);
        else pageStore.put({ id: pageKey, documentId: id, page, annotations });
      });
      for (const page of removedPages) pageStore.delete(workspacePageId(id, page));
      await transactionSettled(transaction);
      return { savedAt };
    } catch (error) {
      if (isQuotaError(error)) throw new WorkspaceStorageError("This device is out of space for saved marks.", "quota");
      throw new WorkspaceStorageError("Marks could not be saved on this device.", "write_failed");
    }
  }

  async function deleteDocument({ owner, materialSlug, sheetSlug }) {
    const database = await open();
    const id = workspaceDocumentId(owner, materialSlug, sheetSlug);
    const transaction = database.transaction([DOCUMENT_STORE, PAGE_STORE], "readwrite");
    transaction.objectStore(DOCUMENT_STORE).delete(id);
    const keys = await requestResult(transaction.objectStore(PAGE_STORE).index("documentId").getAllKeys(id));
    for (const key of keys || []) transaction.objectStore(PAGE_STORE).delete(key);
    await transactionSettled(transaction);
  }

  /**
   * Moves a legacy localStorage snapshot into IndexedDB exactly once.
   *
   * The old key is removed only after the migrated document reads back, so an
   * interrupted migration retries instead of losing work, and a second run
   * finds an IndexedDB record and does nothing.
   * @param {{ owner: string, materialSlug: string, sheetSlug: string, legacyKey: string, parse: (raw: string) => any }} options
   */
  async function migrateLegacyDocument({ owner, materialSlug, sheetSlug, legacyKey, parse }) {
    if (!local) return { migrated: false, reason: "unavailable" };
    let raw = null;
    try {
      raw = local.getItem(legacyKey);
    } catch {
      return { migrated: false, reason: "unavailable" };
    }
    if (!raw) return { migrated: false, reason: "absent" };
    const existing = await readDocument({ owner, materialSlug, sheetSlug });
    if (existing) {
      // IndexedDB already owns this document; the legacy copy is stale.
      try { local.removeItem(legacyKey); } catch { /* Best effort. */ }
      return { migrated: false, reason: "already-migrated" };
    }
    const snapshot = parse(raw);
    if (!snapshot) {
      try { local.removeItem(legacyKey); } catch { /* Best effort. */ }
      return { migrated: false, reason: "corrupt" };
    }
    const annotations = sanitizeStoredAnnotations(snapshot.annotations);
    await writeDocument({
      owner,
      materialSlug,
      sheetSlug,
      view: sanitizeViewState(snapshot),
      notes: sanitizeStoredNotes(snapshot.notes),
      pages: groupAnnotationsByPage(annotations)
    });
    const verified = await readDocument({ owner, materialSlug, sheetSlug });
    if (!verified || verified.annotations.length !== annotations.length) {
      return { migrated: false, reason: "verification-failed" };
    }
    try { local.removeItem(legacyKey); } catch { /* The next load will find the migrated record and skip. */ }
    return { migrated: true, annotations: annotations.length, notes: verified.notes.length };
  }

  return { open, readDocument, writeDocument, deleteDocument, migrateLegacyDocument };
}
