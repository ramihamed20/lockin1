export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type EducationNode = {
  id: string;
  parent_id: string | null;
  kind: "institution" | "college" | "department" | "academic_year" | "semester" | "subject" | "unit" | "lesson";
  title: string;
  slug: string;
  description: string;
  position: number;
  path: string;
  depth: number;
  status: "draft" | "published" | "archived";
  is_discoverable: boolean;
  revision: number;
  updated_at: string;
};

export type ManagedAsset = {
  id: string;
  file_id: string;
  role: "primary" | "transcript" | "caption" | "cover";
  position: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  view_url: string;
  download_url: string | null;
};

export type LearningVersion = {
  id: string;
  version_number: number;
  academic_node_id: string;
  academic_node_title: string;
  content_type: "pdf" | "audio" | "video";
  title: string;
  summary: string;
  language: string;
  allow_download: boolean;
  metadata: Record<string, unknown>;
  available_from: string | null;
  available_until: string | null;
  assets: ManagedAsset[];
  focus_context: { context_type: "study"; context_id: string } | null;
  created_at: string;
};

export type LearningProgress = {
  status: "in_progress" | "completed";
  completion_percent: number;
  position: Record<string, unknown>;
  revision: number;
  updated_at?: string;
};

export type LearningObject = {
  id: string;
  version: LearningVersion;
  published_at: string;
  is_bookmarked: boolean;
  progress: LearningProgress | null;
};

export type SearchEntry = {
  resource_kind: string;
  resource_id: string;
  content_type: string;
  title: string;
  summary: string;
  language: string;
  published_at: string | null;
};

export type LearningDashboard = {
  next_item: {
    learning_object_id: string;
    title: string;
    content_type: string;
    reason: "resume" | "bookmark";
    completion_percent: number;
  } | null;
  bookmark_count: number;
  completed_count: number;
  recent_content: Array<{
    learning_object_id: string;
    title: string;
    content_type: string;
  }>;
  review_due: unknown[];
};

export type EducationNodeDetail = {
  node: EducationNode;
  breadcrumbs: EducationNode[];
};
