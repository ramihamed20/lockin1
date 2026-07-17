import type { Role, User } from "../auth/types";
import type { EducationNode, LearningVersion, Paginated } from "../learning/types";

export type ManagedFile = {
  id: string;
  kind: "pdf" | "audio";
  original_name: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  validation_status: "pending" | "valid" | "rejected";
  scan_status: "not_configured" | "pending" | "clean" | "rejected";
  created_at: string;
};

export type ManagedLearningObject = {
  id: string;
  owner: string;
  owner_name: string;
  owner_email: string;
  current_version: LearningVersion;
  published_version_id: string | null;
  workflow_status: "draft" | "in_review" | "published" | "rejected" | "archived";
  review_note: string;
  revision: number;
  published_at: string | null;
  archived_at: string | null;
  updated_at: string;
};

export type CreatorScope = {
  id: string;
  user: string;
  user_name: string;
  user_email: string;
  node: string;
  node_title: string;
  can_create_content: boolean;
  can_review_content: boolean;
  can_publish_content: boolean;
  can_manage_hierarchy: boolean;
  updated_at: string;
};

export type ManagedUser = User & { roles: Role[] };
export type ManagedContentPage = Paginated<ManagedLearningObject>;
export type ManagedNodePage = Paginated<EducationNode>;

export type ContentDraft = {
  academic_node_id: string;
  content_type: "pdf" | "audio" | "video";
  title: string;
  summary: string;
  language: string;
  allow_download: boolean;
  primary_file_id?: string | null;
};
