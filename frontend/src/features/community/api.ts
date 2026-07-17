import { apiEndpointFromUrl, apiRequest } from "../../api/client";
import type {
  Comment,
  CommunitySpace,
  CursorPage,
  Discussion,
  LearningContextType,
  ModerationAudit,
  Report,
  ReportReason
} from "./types";

function cursorEndpoint(next: string): string {
  return apiEndpointFromUrl(next);
}

export function discussions(
  filters: { contextType?: LearningContextType; contextId?: string; spaceId?: string } = {},
  signal?: AbortSignal
) {
  const params = new URLSearchParams();
  if (filters.contextType) params.set("context_type", filters.contextType);
  if (filters.contextId) params.set("context_id", filters.contextId);
  if (filters.spaceId) params.set("space_id", filters.spaceId);
  const query = params.size ? `?${params}` : "";
  return apiRequest<CursorPage<Discussion>>(
    `/community/discussions${query}`,
    signal ? { signal } : {}
  );
}

export function nextDiscussions(next: string, signal?: AbortSignal) {
  return apiRequest<CursorPage<Discussion>>(cursorEndpoint(next), signal ? { signal } : {});
}

export function discussion(discussionId: string, signal?: AbortSignal) {
  return apiRequest<Discussion>(
    `/community/discussions/${encodeURIComponent(discussionId)}`,
    signal ? { signal } : {}
  );
}

export function createDiscussion(payload: {
  context_type: LearningContextType;
  context_id: string;
  space_id?: string;
  title: string;
  body: string;
}) {
  return apiRequest<Discussion>("/community/discussions", {
    method: "POST",
    body: { ...payload, client_request_id: crypto.randomUUID() }
  });
}

export function deleteDiscussion(item: Discussion) {
  return apiRequest<Discussion>(`/community/discussions/${encodeURIComponent(item.id)}`, {
    method: "DELETE",
    body: { expected_revision: item.revision }
  });
}

export function comments(discussionId: string, signal?: AbortSignal) {
  return apiRequest<CursorPage<Comment>>(
    `/community/discussions/${encodeURIComponent(discussionId)}/comments`,
    signal ? { signal } : {}
  );
}

export function nextComments(next: string, signal?: AbortSignal) {
  return apiRequest<CursorPage<Comment>>(cursorEndpoint(next), signal ? { signal } : {});
}

export function createComment(discussionId: string, body: string, parentId?: string) {
  return apiRequest<Comment>(
    `/community/discussions/${encodeURIComponent(discussionId)}/comments`,
    {
      method: "POST",
      body: {
        body,
        parent_id: parentId ?? null,
        client_request_id: crypto.randomUUID()
      }
    }
  );
}

export function deleteComment(item: Comment) {
  return apiRequest<Comment>(`/community/comments/${encodeURIComponent(item.id)}`, {
    method: "DELETE",
    body: { expected_revision: item.revision }
  });
}

export function spaces(signal?: AbortSignal) {
  return apiRequest<CursorPage<CommunitySpace>>(
    "/community/spaces",
    signal ? { signal } : {}
  );
}

export function space(spaceId: string, signal?: AbortSignal) {
  return apiRequest<CommunitySpace>(
    `/community/spaces/${encodeURIComponent(spaceId)}`,
    signal ? { signal } : {}
  );
}

export function createSpace(payload: {
  context_type: "lesson" | "learning_object";
  context_id: string;
  title: string;
  description: string;
}) {
  return apiRequest<CommunitySpace>("/community/spaces", { method: "POST", body: payload });
}

export function inviteSpaceMember(spaceId: string, email: string, role: "member" | "moderator") {
  return apiRequest<{ user_id: string; role: string; status: string }>(
    `/community/spaces/${encodeURIComponent(spaceId)}/members`,
    { method: "POST", body: { email, role } }
  );
}

export function createReport(payload: {
  target_type: Report["target_type"];
  target_id: string;
  reason: ReportReason;
  description: string;
}) {
  return apiRequest<Report>("/moderation/reports", {
    method: "POST",
    body: { ...payload, client_request_id: crypto.randomUUID() }
  });
}

export function reports(filters: { status?: string; targetType?: string } = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.targetType) params.set("target_type", filters.targetType);
  const query = params.size ? `?${params}` : "";
  return apiRequest<CursorPage<Report>>(
    `/moderation/reports${query}`,
    signal ? { signal } : {}
  );
}

export function nextReports(next: string, signal?: AbortSignal) {
  return apiRequest<CursorPage<Report>>(cursorEndpoint(next), signal ? { signal } : {});
}

export function transitionReport(
  report: Report,
  payload: {
    status: "triaged" | "in_progress" | "resolved" | "rejected";
    resolution_notes?: string;
    content_action?: "remove" | "restore" | "lock" | "unlock";
  }
) {
  return apiRequest<Report>(`/moderation/reports/${encodeURIComponent(report.id)}/transition`, {
    method: "POST",
    body: { expected_revision: report.revision, ...payload }
  });
}

export function moderationAudit(signal?: AbortSignal) {
  return apiRequest<CursorPage<ModerationAudit>>(
    "/moderation/audit",
    signal ? { signal } : {}
  );
}
