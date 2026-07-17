import type { Paginated } from "../learning/types";

export type AssessmentMode = "quiz" | "practice" | "mastery";
export type WorkflowStatus = "draft" | "in_review" | "published" | "rejected" | "retired";

export type QuizVersion = {
  id: string;
  version_number: number;
  academic_node_id: string;
  academic_node_title: string;
  title: string;
  instructions: string;
  mode: AssessmentMode;
  selection_mode: "fixed" | "pool";
  question_count: number;
  duration_seconds: number | null;
  maximum_attempts: number;
  available_from: string | null;
  available_until: string | null;
  randomize_questions: boolean;
  randomize_options: boolean;
  result_release: "immediate" | "after_close";
  pass_percent: string;
  focus_required: boolean;
  allowed_difficulties: Array<"easy" | "medium" | "hard">;
  language: string;
};

export type Quiz = {
  id: string;
  version: QuizVersion;
  published_at: string;
};

export type AttemptAnswer = {
  selected_option_ids: string[];
  client_revision: number;
  server_revision: number;
  saved_at: string;
};

export type AttemptQuestion = {
  id: string;
  position: number;
  prompt: string;
  question_type: "single_choice" | "true_false" | "completion_choice";
  difficulty: "easy" | "medium" | "hard";
  language: string;
  option_snapshot: Array<{ id: string; text: string }>;
  max_points: string;
  answer: AttemptAnswer | null;
};

export type Attempt = {
  id: string;
  quiz_id: string;
  quiz_version_id: string;
  quiz_title: string;
  mode: AssessmentMode;
  status: "active" | "submitted" | "expired";
  review_only: boolean;
  requested_question_count: number;
  server_revision: number;
  started_at: string;
  deadline_at: string | null;
  completed_at: string | null;
  focus_required: boolean;
  focus_context: { context_type: "quiz"; context_id: string };
  server_time: string;
  result_id: string | null;
  questions: AttemptQuestion[];
};

export type AssessmentResultQuestion = {
  id: string;
  question_id: string;
  position: number;
  prompt: string;
  question_type: AttemptQuestion["question_type"];
  difficulty: AttemptQuestion["difficulty"];
  option_snapshot: Array<{ id: string; text: string }>;
  selected_option_ids: string[];
  correct_option_ids: string[];
  correct: boolean;
  explanation: string;
  max_points: string;
};

export type AssessmentResult = {
  id: string;
  attempt_id: string;
  quiz_id: string;
  quiz_title: string;
  mode: AssessmentMode;
  attempt_status: "submitted" | "expired";
  released: boolean;
  release_at: string;
  score_points: string | null;
  maximum_points: string | null;
  percentage: string | null;
  passed: boolean | null;
  answered_count: number | null;
  unanswered_count: number | null;
  submitted_at: string;
  questions: AssessmentResultQuestion[] | null;
};

export type ReviewItem = {
  question_id: string;
  prompt: string;
  academic_node_id: string;
  academic_node_title: string;
  difficulty: "easy" | "medium" | "hard";
  due_at: string;
  interval_days: number;
  repetitions: number;
  lapses: number;
  mastery_state: "learning" | "mastered";
};

export type ManagedQuestionOption = {
  id: string;
  text: string;
  position: number;
  is_correct: boolean;
};

export type ManagedQuestion = {
  id: string;
  owner: string;
  owner_name: string;
  owner_email: string;
  current_version: {
    id: string;
    version_number: number;
    academic_node_id: string;
    academic_node_title: string;
    question_type: AttemptQuestion["question_type"];
    prompt: string;
    explanation: string;
    difficulty: AttemptQuestion["difficulty"];
    language: string;
    metadata: Record<string, unknown>;
    options: ManagedQuestionOption[];
    created_at: string;
  };
  published_version_id: string | null;
  workflow_status: WorkflowStatus;
  review_note: string;
  revision: number;
  published_at: string | null;
  retired_at: string | null;
  updated_at: string;
};

export type ManagedQuiz = {
  id: string;
  owner: string;
  owner_name: string;
  owner_email: string;
  current_version: QuizVersion & {
    ranking_eligible: boolean;
    achievement_eligible: boolean;
    metadata: Record<string, unknown>;
    question_links: Array<{
      id: string;
      position: number;
      question_id: string;
      question_version_id: string;
      prompt: string;
    }>;
  };
  published_version_id: string | null;
  workflow_status: WorkflowStatus;
  review_note: string;
  revision: number;
  published_at: string | null;
  retired_at: string | null;
  updated_at: string;
};

export type QuizPage = Paginated<Quiz>;
export type ManagedQuestionPage = Paginated<ManagedQuestion>;
export type ManagedQuizPage = Paginated<ManagedQuiz>;
