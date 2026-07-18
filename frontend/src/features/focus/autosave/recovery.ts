import type { FocusAnnotation, FocusRecoveryRecord, FocusToolId } from "../contracts/types";

const DB_NAME = "lockin-focus-recovery";
const STORE_NAME = "workspace-recovery";
const DB_VERSION = 1;
const allowedTools = new Set<FocusToolId>(["pen", "pencil", "highlighter", "eraser", "line", "arrow", "rectangle", "circle", "text", "sticky-note"]);
const persistedTools = new Set<FocusToolId>(["pen", "pencil", "highlighter", "line", "arrow", "rectangle", "circle", "text", "sticky-note"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const colorPattern = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const pointerKinds = new Set(["pen", "touch", "mouse", "unknown"]);

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Focus recovery storage failed."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Focus recovery database could not open."));
  });
}

function recordKey(accountId: string, documentVersionId: string): string {
  return `${accountId}:${documentVersionId}`;
}

function numberIn(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function point(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return numberIn(candidate.x, 0, 1) && numberIn(candidate.y, 0, 1);
}

function pointerSample(value: unknown): boolean {
  if (!point(value)) return false;
  const sample = value as { pointer?: unknown; pressure?: unknown; tiltX?: unknown; tiltY?: unknown; timestamp?: unknown };
  return typeof sample.pointer === "string" && pointerKinds.has(sample.pointer)
    && numberIn(sample.pressure, 0, 1) && numberIn(sample.tiltX, -90, 90)
    && numberIn(sample.tiltY, -90, 90) && numberIn(sample.timestamp, 0, 9_999_999_999_999);
}

function safeAnnotation(value: unknown): value is FocusAnnotation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FocusAnnotation>;
  const bounds = item.bounds;
  if (!item.id || !uuidPattern.test(item.id) || !Number.isInteger(item.pageNumber) || !numberIn(item.pageNumber, 1, 10_000)
    || !item.tool || !persistedTools.has(item.tool) || !item.payload || !bounds
    || !numberIn(bounds.x, 0, 1) || !numberIn(bounds.y, 0, 1) || !numberIn(bounds.width, 0, 1) || !numberIn(bounds.height, 0, 1)
    || bounds.x + bounds.width > 1.001 || bounds.y + bounds.height > 1.001
    || typeof item.color !== "string" || !colorPattern.test(item.color)
    || !numberIn(item.thickness, 0.01, 64) || !numberIn(item.opacity, 0, 1)) return false;
  const payload = item.payload;
  if (payload.kind === "stroke") {
    return ["pen", "pencil", "highlighter"].includes(item.tool) && Array.isArray(payload.samples)
      && payload.samples.length >= 2 && payload.samples.length <= 2048
      && payload.samples.every(pointerSample);
  }
  if (payload.kind === "shape") return ["line", "arrow", "rectangle", "circle"].includes(item.tool) && point(payload.start) && point(payload.end);
  return payload.kind === item.tool && (item.tool === "text" || item.tool === "sticky-note")
    && typeof payload.value === "string" && payload.value.trim().length > 0 && payload.value.length <= 4000;
}

function isSafeRecord(value: unknown, accountId: string, versionId: string): value is FocusRecoveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<FocusRecoveryRecord>;
  const workspace = record.workspace;
  return record.schemaVersion === 1 && record.accountId === accountId && record.documentVersionId === versionId
    && typeof record.clientInstanceId === "string" && !!workspace
    && workspace.documentVersionId === versionId && Number.isInteger(workspace.currentPage)
    && workspace.currentPage >= 1 && workspace.currentPage <= 10_000
    && workspace.zoom >= 0.5 && workspace.zoom <= 4
    && (workspace.activeTool === null || allowedTools.has(workspace.activeTool))
    && Number.isInteger(record.collectionRevision) && numberIn(record.collectionRevision, 0, Number.MAX_SAFE_INTEGER)
    && Array.isArray(record.annotations) && record.annotations.length <= 20_000 && record.annotations.every(safeAnnotation)
    && Array.isArray(record.pendingUpserts) && record.pendingUpserts.length <= 100 && record.pendingUpserts.every(safeAnnotation)
    && Array.isArray(record.pendingDeletes) && record.pendingDeletes.length <= 100 && record.pendingDeletes.every((id) => typeof id === "string" && uuidPattern.test(id));
}

export async function loadFocusRecovery(accountId: string, documentVersionId: string): Promise<FocusRecoveryRecord | null> {
  if (!("indexedDB" in window)) return null;
  const db = await openDatabase();
  try {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(recordKey(accountId, documentVersionId)) as IDBRequest<unknown>;
    const value: unknown = await requestValue(request);
    return isSafeRecord(value, accountId, documentVersionId) ? value : null;
  } finally {
    db.close();
  }
}

export async function saveFocusRecovery(record: FocusRecoveryRecord): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestValue(transaction.objectStore(STORE_NAME).put(record, recordKey(record.accountId, record.documentVersionId)));
  } finally {
    db.close();
  }
}

export async function clearFocusRecovery(accountId: string, documentVersionId: string): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openDatabase();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await requestValue(transaction.objectStore(STORE_NAME).delete(recordKey(accountId, documentVersionId)));
  } finally {
    db.close();
  }
}
