import { apiRequest } from "../../api/client";
import type { FocusAnnotation, FocusDocument, FocusSession, FocusToolId, FocusWorkspaceState, PersistedFocusToolId } from "./contracts/types";

type WorkspaceWire = {
  session_id: string; document_id: string; document_version_id: string; file_id: string;
  current_page: number; page_count: number | null; zoom: string | number; sidebar: FocusWorkspaceState["sidebar"];
  active_tool: FocusToolId | ""; layout: Record<string, unknown>; open_tabs: string[]; revision: number; updated_at: string;
};
type SessionWire = {
  id: string; context_type: string; context_id: string | null; status: FocusSession["status"];
  started_at: string; last_activity_at: string; ended_at: string | null; active_duration_seconds: number; revision: number;
  workspace: WorkspaceWire | null;
};
type AnnotationWire = {
  id: string; page_number: number; tool: PersistedFocusToolId; layer_key: string;
  bounds: FocusAnnotation["bounds"]; payload: FocusAnnotation["payload"]; color: string;
  thickness: string | number; opacity: string | number; revision: number; created_at: string; updated_at: string;
};

function workspaceFromWire(value: WorkspaceWire): FocusWorkspaceState {
  return {
    sessionId: value.session_id, documentId: value.document_id, documentVersionId: value.document_version_id,
    fileId: value.file_id, currentPage: value.current_page, pageCount: value.page_count, zoom: Number(value.zoom),
    sidebar: value.sidebar, activeTool: value.active_tool || null, layout: value.layout, openTabs: value.open_tabs,
    revision: value.revision, updatedAt: value.updated_at
  };
}

function sessionFromWire(value: SessionWire): FocusSession {
  return {
    id: value.id, contextType: value.context_type, contextId: value.context_id, status: value.status,
    startedAt: value.started_at, lastActivityAt: value.last_activity_at, endedAt: value.ended_at,
    activeDurationSeconds: value.active_duration_seconds, revision: value.revision,
    workspace: value.workspace ? workspaceFromWire(value.workspace) : null
  };
}

function annotationFromWire(value: AnnotationWire): FocusAnnotation {
  return {
    id: value.id, pageNumber: value.page_number, tool: value.tool, layerKey: value.layer_key,
    bounds: value.bounds, payload: value.payload, color: value.color, thickness: Number(value.thickness),
    opacity: Number(value.opacity), revision: value.revision, createdAt: value.created_at, updatedAt: value.updated_at
  };
}

export async function getFocusDocument(documentVersionId: string, signal?: AbortSignal) {
  const data = await apiRequest<{
    document: { document_id: string; document_version_id: string; file_id: string; title: string; language: string; view_url: string; size_bytes: number; checksum_sha256: string; page_count: number | null };
    latest_workspace: WorkspaceWire | null; annotation_revision: number;
  }>(`/focus/documents/${documentVersionId}`, signal ? { signal } : {});
  const document: FocusDocument = {
    documentId: data.document.document_id, documentVersionId: data.document.document_version_id,
    fileId: data.document.file_id, title: data.document.title, language: data.document.language,
    viewUrl: data.document.view_url, sizeBytes: data.document.size_bytes,
    checksumSha256: data.document.checksum_sha256, pageCount: data.document.page_count
  };
  return { document, latestWorkspace: data.latest_workspace ? workspaceFromWire(data.latest_workspace) : null, annotationRevision: data.annotation_revision };
}

export async function startFocusSession(documentVersionId: string, clientInstanceId: string, signal?: AbortSignal) {
  const value = await apiRequest<SessionWire>("/focus/sessions", { method: "POST", body: { document_version_id: documentVersionId, client_instance_id: clientInstanceId }, ...(signal ? { signal } : {}) });
  return sessionFromWire(value);
}

export async function saveFocusWorkspace(sessionId: string, state: FocusWorkspaceState, signal?: AbortSignal) {
  const value = await apiRequest<WorkspaceWire>(`/focus/sessions/${sessionId}/workspace`, {
    method: "PATCH", body: {
      expected_revision: state.revision, current_page: state.currentPage, page_count: state.pageCount,
      zoom: state.zoom.toFixed(2), sidebar: state.sidebar, active_tool: state.activeTool ?? "",
      layout: state.layout, open_tabs: state.openTabs
    }, ...(signal ? { signal } : {})
  });
  return workspaceFromWire(value);
}

export async function loadFocusAnnotations(documentVersionId: string, pages: readonly number[], signal?: AbortSignal) {
  const query = new URLSearchParams({ pages: pages.join(","), page_size: "1000" });
  const value = await apiRequest<{ collection_revision: number; results: AnnotationWire[] }>(`/focus/documents/${documentVersionId}/annotations?${query}`, signal ? { signal } : {});
  return { collectionRevision: value.collection_revision, annotations: value.results.map(annotationFromWire) };
}

export async function syncFocusAnnotations(documentVersionId: string, expectedRevision: number, upserts: readonly FocusAnnotation[], deletedIds: readonly string[], idempotencyKey: string, signal?: AbortSignal) {
  const value = await apiRequest<{ collection_revision: number; annotations: AnnotationWire[]; deleted_ids: string[] }>(`/focus/documents/${documentVersionId}/annotations`, {
    method: "POST", body: {
      expected_collection_revision: expectedRevision, idempotency_key: idempotencyKey,
      annotations: upserts.map((item) => ({
        id: item.id, page_number: item.pageNumber, tool: item.tool, layer_key: item.layerKey,
        bounds: item.bounds, payload: item.payload, color: item.color,
        thickness: item.thickness.toFixed(2), opacity: item.opacity.toFixed(3)
      })), deleted_ids: deletedIds
    }, ...(signal ? { signal } : {})
  });
  return { collectionRevision: value.collection_revision, annotations: value.annotations.map(annotationFromWire), deletedIds: value.deleted_ids };
}

export async function focusSessionAction(sessionId: string, action: "pause" | "resume" | "complete" | "abandon", signal?: AbortSignal) {
  const value = await apiRequest<SessionWire>(`/focus/sessions/${sessionId}/${action}`, { method: "POST", body: {}, ...(signal ? { signal } : {}) });
  return sessionFromWire(value);
}
