import { apiRequest } from "../../api/client";
import type {
  AssessmentResult,
  Attempt,
  AttemptAnswer,
  ManagedQuestion,
  ManagedQuestionPage,
  ManagedQuiz,
  ManagedQuizPage,
  Quiz,
  QuizPage,
  ReviewItem
} from "./types";

export function quizzes(mode?: string, signal?: AbortSignal) {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return apiRequest<QuizPage>(`/quizzes${query}`, signal ? { signal } : {});
}

export function quiz(quizId: string, signal?: AbortSignal) {
  return apiRequest<Quiz>(`/quizzes/${encodeURIComponent(quizId)}`, signal ? { signal } : {});
}

export function reviewQueue(signal?: AbortSignal) {
  return apiRequest<{ count: number; results: ReviewItem[] }>(
    "/assessment-review",
    signal ? { signal } : {}
  );
}

export function beginAttempt(
  quizId: string,
  payload: {
    idempotency_key: string;
    question_count?: number;
    difficulties?: string[];
    review_only?: boolean;
  }
) {
  return apiRequest<{ resumed: boolean; attempt: Attempt }>(
    `/quizzes/${encodeURIComponent(quizId)}/attempts`,
    { method: "POST", body: payload }
  );
}

export function attempt(attemptId: string, signal?: AbortSignal) {
  return apiRequest<Attempt>(
    `/attempts/${encodeURIComponent(attemptId)}`,
    signal ? { signal } : {}
  );
}

export function saveAttemptAnswer(
  attemptId: string,
  questionId: string,
  selectedOptionIds: string[],
  clientRevision: number
) {
  return apiRequest<AttemptAnswer>(
    `/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}/answer`,
    {
      method: "PUT",
      body: {
        selected_option_ids: selectedOptionIds,
        client_revision: clientRevision
      }
    }
  );
}

export function submitAttempt(attemptId: string, idempotencyKey: string) {
  return apiRequest<AssessmentResult>(`/attempts/${encodeURIComponent(attemptId)}/submit`, {
    method: "POST",
    body: { idempotency_key: idempotencyKey }
  });
}

export function assessmentResult(resultId: string, signal?: AbortSignal) {
  return apiRequest<AssessmentResult>(
    `/assessment-results/${encodeURIComponent(resultId)}`,
    signal ? { signal } : {}
  );
}

export function recordActivity(
  attemptId: string,
  activityType: string,
  metadata: Record<string, string> = {}
) {
  return apiRequest(`/attempts/${encodeURIComponent(attemptId)}/activities`, {
    method: "POST",
    body: {
      client_event_id: crypto.randomUUID(),
      activity_type: activityType,
      client_occurred_at: new Date().toISOString(),
      metadata
    }
  });
}

export function reportQuestion(
  resultId: string,
  payload: { attempt_question_id: string; category: string; details: string }
) {
  return apiRequest(`/assessment-results/${encodeURIComponent(resultId)}/reports`, {
    method: "POST",
    body: payload
  });
}

export function managedQuestions(signal?: AbortSignal) {
  return apiRequest<ManagedQuestionPage>(
    "/management/questions?page_size=100",
    signal ? { signal } : {}
  );
}

export function saveQuestionDraft(payload: Record<string, unknown>) {
  return apiRequest<ManagedQuestion>("/management/questions", { method: "POST", body: payload });
}

export function questionAction(
  question: ManagedQuestion,
  action: "submit" | "publish" | "reject" | "retire",
  reviewNote?: string
) {
  return apiRequest<ManagedQuestion>(`/management/questions/${question.id}/${action}`, {
    method: "POST",
    body: {
      expected_revision: question.revision,
      ...(action === "reject" ? { review_note: reviewNote ?? "Changes requested." } : {})
    }
  });
}

export function managedQuizzes(signal?: AbortSignal) {
  return apiRequest<ManagedQuizPage>(
    "/management/quizzes?page_size=100",
    signal ? { signal } : {}
  );
}

export function saveQuizDraft(payload: Record<string, unknown>) {
  return apiRequest<ManagedQuiz>("/management/quizzes", { method: "POST", body: payload });
}

export function quizAction(
  item: ManagedQuiz,
  action: "submit" | "publish" | "reject" | "retire",
  reviewNote?: string
) {
  return apiRequest<ManagedQuiz>(`/management/quizzes/${item.id}/${action}`, {
    method: "POST",
    body: {
      expected_revision: item.revision,
      ...(action === "reject" ? { review_note: reviewNote ?? "Changes requested." } : {})
    }
  });
}
