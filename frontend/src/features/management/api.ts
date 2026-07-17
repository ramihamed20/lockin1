import { apiRequest } from "../../api/client";
import type { EducationNode, Paginated } from "../learning/types";
import type {
  ContentDraft,
  CreatorScope,
  ManagedContentPage,
  ManagedFile,
  ManagedLearningObject,
  ManagedNodePage,
  ManagedUser
} from "./types";

export function managedNodes(signal?: AbortSignal) {
  return apiRequest<ManagedNodePage>("/management/education/nodes?page_size=100", signal ? { signal } : {});
}

export function createNode(payload: {
  parent_id: string | null;
  kind: EducationNode["kind"];
  title: string;
  description: string;
  position: number;
}) {
  return apiRequest<EducationNode>("/management/education/nodes", { method: "POST", body: payload });
}

export function setNodeStatus(node: EducationNode, status: "published" | "archived") {
  return apiRequest<EducationNode>(`/management/education/nodes/${node.id}/status`, {
    method: "POST",
    body: { expected_revision: node.revision, status }
  });
}

export function managedContent(signal?: AbortSignal) {
  return apiRequest<ManagedContentPage>("/management/content?page_size=100", signal ? { signal } : {});
}

export function uploadManagedFile(file: File, kind: "pdf" | "audio") {
  const body = new FormData();
  body.set("kind", kind);
  body.set("file", file);
  return apiRequest<ManagedFile>("/management/files", { method: "POST", body });
}

export function saveContentDraft(payload: ContentDraft, current?: ManagedLearningObject) {
  const body = current ? { ...payload, expected_revision: current.revision } : payload;
  return apiRequest<ManagedLearningObject>(
    current ? `/management/content/${current.id}` : "/management/content",
    { method: current ? "PATCH" : "POST", body }
  );
}

export function contentAction(
  item: ManagedLearningObject,
  action: "submit" | "publish" | "archive" | "reject",
  reviewNote?: string
) {
  return apiRequest<ManagedLearningObject>(`/management/content/${item.id}/${action}`, {
    method: "POST",
    body: {
      expected_revision: item.revision,
      ...(action === "reject" ? { review_note: reviewNote ?? "Changes requested." } : {})
    }
  });
}

export function creatorScopes(signal?: AbortSignal) {
  return apiRequest<{ scopes: CreatorScope[] }>("/management/education/scopes", signal ? { signal } : {});
}

export function adminUsers(signal?: AbortSignal) {
  return apiRequest<Paginated<ManagedUser>>("/admin/users?page_size=100", signal ? { signal } : {});
}

export function grantScope(payload: {
  user_id: string;
  node_id: string;
  can_create_content: boolean;
  can_review_content: boolean;
  can_publish_content: boolean;
  can_manage_hierarchy: boolean;
}) {
  return apiRequest<CreatorScope>("/management/education/scopes", { method: "POST", body: payload });
}

export function revokeScope(scopeId: string) {
  return apiRequest<void>(`/management/education/scopes/${scopeId}`, { method: "DELETE" });
}
