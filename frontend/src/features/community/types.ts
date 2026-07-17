export type LearningContextType = "lesson" | "learning_object" | "question" | "quiz";

export type CursorPage<T> = {
  next: string | null;
  previous: string | null;
  results: T[];
};

export type CommunityAuthor = {
  id: string;
  full_name: string;
  badges: Array<"moderator" | "creator" | "administrator">;
};

export type Discussion = {
  id: string;
  author: CommunityAuthor;
  space_id: string | null;
  space_title: string | null;
  context_type: LearningContextType;
  context_id: string;
  context_title: string;
  context_route: string;
  title: string | null;
  body: string | null;
  status: "active" | "locked" | "author_deleted" | "moderator_removed";
  revision: number;
  comment_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
};

export type Comment = {
  id: string;
  discussion_id: string;
  parent_id: string | null;
  author: CommunityAuthor;
  body: string | null;
  status: "active" | "author_deleted" | "moderator_removed";
  revision: number;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
};

export type CommunitySpace = {
  id: string;
  owner: CommunityAuthor;
  context_type: "lesson" | "learning_object";
  context_id: string;
  context_title: string;
  context_route: string;
  title: string;
  description: string;
  status: "active" | "archived";
  revision: number;
  member_count: number;
  membership_role: "owner" | "moderator" | "member" | null;
  can_manage: boolean;
  created_at: string;
  updated_at: string;
};

export type ReportReason =
  | "spam"
  | "abuse"
  | "incorrect_question"
  | "incorrect_answer"
  | "incorrect_explanation"
  | "duplicate"
  | "other";

export type Report = {
  id: string;
  reporter_id: string;
  reporter_name: string;
  target_type: "discussion" | "comment" | "question" | "answer" | "explanation" | "learning_object";
  target_id: string;
  target_label: string;
  context_type: string;
  context_id: string | null;
  private_space_id: string | null;
  reason: ReportReason;
  description: string;
  status: "open" | "triaged" | "in_progress" | "resolved" | "rejected" | "duplicate";
  priority: "routine" | "important" | "urgent";
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  duplicate_of_id: string | null;
  resolution_notes: string;
  revision: number;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  can_manage: boolean;
  target_author_id?: string | null;
  target_version_id?: string | null;
  evidence_snapshot?: Record<string, unknown>;
};

export type ModerationAudit = {
  id: string;
  report_id: string | null;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
