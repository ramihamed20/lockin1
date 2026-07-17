import { apiRequest } from "../../api/client";
import type {
  EducationNode,
  EducationNodeDetail,
  LearningDashboard,
  LearningObject,
  LearningProgress,
  Paginated,
  SearchEntry
} from "./types";

export function educationChildren(parentId?: string, signal?: AbortSignal) {
  const query = parentId ? `?parent=${encodeURIComponent(parentId)}` : "";
  return apiRequest<Paginated<EducationNode>>(`/education/nodes${query}`, signal ? { signal } : {});
}

export function educationNode(nodeId: string, signal?: AbortSignal) {
  return apiRequest<EducationNodeDetail>(`/education/nodes/${encodeURIComponent(nodeId)}`, signal ? { signal } : {});
}

export function learningObjects(nodeId?: string, contentType?: string, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (nodeId) params.set("node", nodeId);
  if (contentType) params.set("content_type", contentType);
  const query = params.size ? `?${params.toString()}` : "";
  return apiRequest<Paginated<LearningObject>>(`/learning-objects${query}`, signal ? { signal } : {});
}

export function learningObject(contentId: string, signal?: AbortSignal) {
  return apiRequest<LearningObject>(`/learning-objects/${encodeURIComponent(contentId)}`, signal ? { signal } : {});
}

export function learningDashboard(signal?: AbortSignal) {
  return apiRequest<LearningDashboard>("/learning/dashboard", signal ? { signal } : {});
}

export function searchLearning(query: string, contentType: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  if (contentType) params.set("content_types", contentType);
  return apiRequest<Paginated<SearchEntry>>(`/search?${params.toString()}`, signal ? { signal } : {});
}

export function toggleBookmark(contentId: string, bookmarked: boolean) {
  return bookmarked
    ? apiRequest<void>(`/bookmarks/${encodeURIComponent(contentId)}`, { method: "DELETE" })
    : apiRequest(`/bookmarks`, { method: "POST", body: { learning_object_id: contentId } });
}

export function saveLearningProgress(
  contentId: string,
  progress: LearningProgress
) {
  return apiRequest<LearningProgress>(`/progress/learning-objects/${encodeURIComponent(contentId)}`, {
    method: "PUT",
    body: {
      expected_revision: progress.revision,
      status: progress.status,
      completion_percent: progress.completion_percent,
      position: progress.position
    }
  });
}

export function completeLesson(lessonId: string, expectedRevision = 0) {
  return apiRequest<{ lesson_id: string; completed_at: string; revision: number }>(
    `/progress/lessons/${encodeURIComponent(lessonId)}/complete`,
    { method: "POST", body: { expected_revision: expectedRevision } }
  );
}
