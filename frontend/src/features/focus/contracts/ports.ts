import type { FocusAnnotation, FocusDocument, FocusRecoveryRecord, FocusSession, FocusWorkspaceState } from "./types";

export interface FocusDocumentRenderer {
  load(url: string): Promise<{ pageCount: number }>;
  renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale: number): Promise<{ width: number; height: number; text: string }>;
  releasePage(pageNumber: number): void;
  destroy(): Promise<void>;
}

export interface FocusRecoveryStore {
  load(accountId: string, documentVersionId: string): Promise<FocusRecoveryRecord | null>;
  save(record: FocusRecoveryRecord): Promise<void>;
  clear(accountId: string, documentVersionId: string): Promise<void>;
}

export interface FocusGateway {
  getDocument(documentVersionId: string, signal?: AbortSignal): Promise<{ document: FocusDocument; latestWorkspace: FocusWorkspaceState | null; annotationRevision: number }>;
  startSession(documentVersionId: string, clientInstanceId: string, signal?: AbortSignal): Promise<FocusSession>;
  saveWorkspace(sessionId: string, state: FocusWorkspaceState, signal?: AbortSignal): Promise<FocusWorkspaceState>;
  loadAnnotations(documentVersionId: string, pages: readonly number[], signal?: AbortSignal): Promise<{ collectionRevision: number; annotations: readonly FocusAnnotation[] }>;
  syncAnnotations(documentVersionId: string, expectedRevision: number, upserts: readonly FocusAnnotation[], deletedIds: readonly string[], idempotencyKey: string, signal?: AbortSignal): Promise<{ collectionRevision: number; annotations: readonly FocusAnnotation[]; deletedIds: readonly string[] }>;
  action(sessionId: string, action: "pause" | "resume" | "complete" | "abandon", signal?: AbortSignal): Promise<FocusSession>;
}
