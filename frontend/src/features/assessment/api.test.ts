import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("../../api/client", () => ({ apiRequest }));

import {
  assessmentResult,
  attempt,
  beginAttempt,
  managedQuestions,
  managedQuizzes,
  questionAction,
  quiz,
  quizAction,
  quizzes,
  recordActivity,
  reportQuestion,
  reviewQueue,
  saveAttemptAnswer,
  saveQuestionDraft,
  saveQuizDraft,
  submitAttempt
} from "./api";

describe("assessment API contracts", () => {
  beforeEach(() => apiRequest.mockClear());

  it("uses same-origin read contracts and forwards abort signals", async () => {
    const controller = new AbortController();
    await quizzes("practice", controller.signal);
    await quizzes();
    await quiz("quiz 1", controller.signal);
    await reviewQueue(controller.signal);
    await attempt("attempt 1", controller.signal);
    await assessmentResult("result 1", controller.signal);
    await managedQuestions(controller.signal);
    await managedQuizzes(controller.signal);

    expect(apiRequest).toHaveBeenCalledWith("/quizzes?mode=practice", { signal: controller.signal });
    expect(apiRequest).toHaveBeenCalledWith("/quizzes", {});
    expect(apiRequest).toHaveBeenCalledWith("/quizzes/quiz%201", { signal: controller.signal });
    expect(apiRequest).toHaveBeenCalledWith("/assessment-review", { signal: controller.signal });
  });

  it("writes attempt state through strict server-authoritative endpoints", async () => {
    await beginAttempt("quiz-1", { idempotency_key: "start-key", question_count: 5 });
    await saveAttemptAnswer("attempt-1", "question-1", ["option-1"], 3);
    await submitAttempt("attempt-1", "submit-key");
    await recordActivity("attempt-1", "page_hidden", { reason: "hidden" });
    await reportQuestion("result-1", {
      attempt_question_id: "question-1",
      category: "ambiguous",
      details: "Review wording"
    });

    expect(apiRequest).toHaveBeenCalledWith("/quizzes/quiz-1/attempts", {
      method: "POST",
      body: { idempotency_key: "start-key", question_count: 5 }
    });
    expect(apiRequest).toHaveBeenCalledWith("/attempts/attempt-1/questions/question-1/answer", {
      method: "PUT",
      body: { selected_option_ids: ["option-1"], client_revision: 3 }
    });
    expect(apiRequest).toHaveBeenCalledWith("/attempts/attempt-1/submit", {
      method: "POST",
      body: { idempotency_key: "submit-key" }
    });
    expect(apiRequest).toHaveBeenCalledWith("/assessment-results/result-1/reports", {
      method: "POST",
      body: {
        attempt_question_id: "question-1",
        category: "ambiguous",
        details: "Review wording"
      }
    });
  });

  it("supports versioned question and quiz workflow actions", async () => {
    const question = { id: "question-1", revision: 4 } as Parameters<typeof questionAction>[0];
    const item = { id: "quiz-1", revision: 7 } as Parameters<typeof quizAction>[0];
    await saveQuestionDraft({ prompt: "Prompt" });
    await saveQuizDraft({ title: "Quiz" });
    await questionAction(question, "submit");
    await questionAction(question, "reject", "Clarify answer");
    await quizAction(item, "publish");
    await quizAction(item, "reject");

    expect(apiRequest).toHaveBeenCalledWith("/management/questions", {
      method: "POST",
      body: { prompt: "Prompt" }
    });
    expect(apiRequest).toHaveBeenCalledWith("/management/questions/question-1/reject", {
      method: "POST",
      body: { expected_revision: 4, review_note: "Clarify answer" }
    });
    expect(apiRequest).toHaveBeenCalledWith("/management/quizzes/quiz-1/reject", {
      method: "POST",
      body: { expected_revision: 7, review_note: "Changes requested." }
    });
  });
});
