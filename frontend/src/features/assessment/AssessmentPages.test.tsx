import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ApiError } from "../../api/client";
import { AssessmentHomePage } from "./AssessmentHomePage";
import { AttemptPage } from "./AttemptPage";
import { QuizOverviewPage } from "./QuizOverviewPage";
import { ResultPage } from "./ResultPage";
import type { AssessmentResult, Attempt, Quiz, ReviewItem } from "./types";

const api = vi.hoisted(() => ({
  assessmentResult: vi.fn(),
  attempt: vi.fn(),
  beginAttempt: vi.fn(),
  quiz: vi.fn(),
  quizzes: vi.fn(),
  recordActivity: vi.fn(),
  reportQuestion: vi.fn(),
  reviewQueue: vi.fn(),
  saveAttemptAnswer: vi.fn(),
  submitAttempt: vi.fn()
}));
vi.mock("./api", () => api);

const page = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });
const optionIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002"
];
const quiz: Quiz = {
  id: "10000000-0000-4000-8000-000000000001",
  version: {
    id: "11000000-0000-4000-8000-000000000001",
    version_number: 1,
    academic_node_id: "12000000-0000-4000-8000-000000000001",
    academic_node_title: "Oral anatomy",
    title: "Cranial nerves checkpoint",
    instructions: "Choose the best answer.",
    mode: "practice",
    selection_mode: "pool",
    question_count: 5,
    duration_seconds: null,
    maximum_attempts: 0,
    available_from: null,
    available_until: null,
    randomize_questions: true,
    randomize_options: true,
    result_release: "immediate",
    pass_percent: "60.00",
    focus_required: true,
    allowed_difficulties: ["easy", "medium", "hard"],
    language: "en"
  },
  published_at: "2026-07-17T09:00:00Z"
};
const review: ReviewItem = {
  question_id: "13000000-0000-4000-8000-000000000001",
  prompt: "Identify the facial nerve.",
  academic_node_id: quiz.version.academic_node_id,
  academic_node_title: "Oral anatomy",
  difficulty: "medium",
  due_at: "2026-07-17T09:00:00Z",
  interval_days: 1,
  repetitions: 0,
  lapses: 1,
  mastery_state: "learning"
};
const attempt: Attempt = {
  id: "20000000-0000-4000-8000-000000000001",
  quiz_id: quiz.id,
  quiz_version_id: quiz.version.id,
  quiz_title: quiz.version.title,
  mode: "practice",
  status: "active",
  review_only: false,
  requested_question_count: 1,
  server_revision: 1,
  started_at: "2026-07-17T10:00:00Z",
  deadline_at: null,
  completed_at: null,
  focus_required: true,
  focus_context: { context_type: "quiz", context_id: "20000000-0000-4000-8000-000000000001" },
  server_time: "2026-07-17T10:00:00Z",
  result_id: null,
  questions: [{
    id: "21000000-0000-4000-8000-000000000001",
    position: 1,
    prompt: "Which nerve controls facial expression?",
    question_type: "single_choice",
    difficulty: "medium",
    language: "en",
    option_snapshot: [
      { id: optionIds[0]!, text: "Facial nerve" },
      { id: optionIds[1]!, text: "Optic nerve" }
    ],
    max_points: "1.00",
    answer: null
  }]
};
const releasedResult: AssessmentResult = {
  id: "40000000-0000-4000-8000-000000000001",
  attempt_id: attempt.id,
  quiz_id: quiz.id,
  quiz_title: quiz.version.title,
  mode: "practice",
  attempt_status: "submitted",
  released: true,
  release_at: "2026-07-17T10:02:00Z",
  score_points: "1.00",
  maximum_points: "1.00",
  percentage: "100.00",
  passed: true,
  answered_count: 1,
  unanswered_count: 0,
  submitted_at: "2026-07-17T10:02:00Z",
  questions: [{
    id: attempt.questions[0]!.id,
    question_id: "22000000-0000-4000-8000-000000000001",
    position: 1,
    prompt: attempt.questions[0]!.prompt,
    question_type: "single_choice",
    difficulty: "medium",
    option_snapshot: attempt.questions[0]!.option_snapshot,
    selected_option_ids: [optionIds[0]!],
    correct_option_ids: [optionIds[0]!],
    correct: true,
    explanation: "The facial nerve supplies the muscles of facial expression.",
    max_points: "1.00"
  }]
};

function renderRoute(path: string, routePath: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="/assessments/attempts/:attemptId" element={<p>Attempt destination</p>} />
          <Route path="/assessments/results/:resultId" element={<p>Result destination</p>} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("assessment learning journey", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
    sessionStorage.clear();
    vi.clearAllMocks();
    api.quiz.mockResolvedValue(quiz);
    api.quizzes.mockResolvedValue(page([quiz]));
    api.reviewQueue.mockResolvedValue(page([review]));
    api.recordActivity.mockResolvedValue(undefined);
  });

  it("turns due reviews into a clear next action and filters assessment modes", async () => {
    renderRoute("/assessments", "/assessments", <AssessmentHomePage />);

    expect(await screen.findByRole("heading", { name: "Your review queue" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Start due review" })).toHaveAttribute(
      "href",
      `/assessments/quizzes/${quiz.id}?review=1`
    );
    fireEvent.click(screen.getByRole("button", { name: "Quiz" }));
    expect(screen.getByRole("heading", { name: "No assessment is available yet" })).toBeVisible();
  });

  it("keeps the review command usable when the assessment catalog is unavailable", async () => {
    api.quizzes.mockRejectedValue(new Error("catalog unavailable"));
    renderRoute("/assessments", "/assessments", <AssessmentHomePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("heading", { name: "Your review queue" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Start due review" })).not.toBeInTheDocument();
  });

  it("starts review practice with the server-authoritative options", async () => {
    api.beginAttempt.mockResolvedValue({ attempt, resumed: false });
    renderRoute(
      `/assessments/quizzes/${quiz.id}?review=1`,
      "/assessments/quizzes/:quizId",
      <QuizOverviewPage />
    );

    expect(await screen.findByRole("heading", { name: quiz.version.title })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Practice question count"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Start due review" }));
    await waitFor(() => expect(api.beginAttempt).toHaveBeenCalledWith(
      quiz.id,
      expect.objectContaining({ question_count: 3, difficulties: [], review_only: true })
    ));
    expect(await screen.findByText("Attempt destination")).toBeVisible();
  });

  it("surfaces quiz loading and server start failures without inventing attempt state", async () => {
    api.quiz.mockRejectedValueOnce(new Error("not found"));
    const failed = renderRoute(
      `/assessments/quizzes/${quiz.id}`,
      "/assessments/quizzes/:quizId",
      <QuizOverviewPage />
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    failed.unmount();

    api.quiz.mockResolvedValue({ ...quiz, version: { ...quiz.version, mode: "quiz", duration_seconds: 600 } });
    api.beginAttempt.mockRejectedValue(new ApiError(409, { error: { message: "Retry limit reached." } }));
    renderRoute(
      `/assessments/quizzes/${quiz.id}`,
      "/assessments/quizzes/:quizId",
      <QuizOverviewPage />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Start assessment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retry limit reached.");
    expect(api.beginAttempt).toHaveBeenCalledOnce();
    expect(api.beginAttempt.mock.calls[0]?.[0]).toBe(quiz.id);
    expect(api.beginAttempt.mock.calls[0]?.[1]).not.toHaveProperty("question_count");
  });

  it("autosaves a selected answer and requires explicit final confirmation", async () => {
    api.attempt.mockResolvedValue(attempt);
    api.saveAttemptAnswer.mockResolvedValue({
      selected_option_ids: [optionIds[0]],
      client_revision: 1,
      server_revision: 2,
      saved_at: "2026-07-17T10:01:00Z"
    });
    api.submitAttempt.mockResolvedValue(releasedResult);
    renderRoute(
      `/assessments/attempts/${attempt.id}`,
      "/assessments/attempts/:attemptId",
      <AttemptPage />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
    expect(await screen.findByText("Full-screen mode is not available in this browser.")).toBeVisible();
    const answer = await screen.findByRole("radio", { name: /Facial nerve/ });
    fireEvent.click(answer);
    await waitFor(() => expect(api.saveAttemptAnswer).toHaveBeenCalledWith(
      attempt.id,
      attempt.questions[0]!.id,
      [optionIds[0]],
      1
    ));
    expect(await screen.findByText("Answer saved")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    const dialog = screen.getByRole("dialog", { name: "Submit this attempt?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit attempt" }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalledWith(attempt.id, expect.any(String)));
    expect(await screen.findByText("Result destination")).toBeVisible();
  });

  it("redirects a closed attempt and renders a recoverable load failure", async () => {
    api.attempt.mockResolvedValueOnce({ ...attempt, status: "submitted", result_id: releasedResult.id });
    const closed = renderRoute(
      `/assessments/attempts/${attempt.id}`,
      "/assessments/attempts/:attemptId",
      <AttemptPage />
    );
    expect(await screen.findByText("Result destination")).toBeVisible();
    closed.unmount();

    api.attempt.mockRejectedValue(new Error("offline"));
    renderRoute(
      `/assessments/attempts/${attempt.id}`,
      "/assessments/attempts/:attemptId",
      <AttemptPage />
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.getByRole("link", { name: "Back to practice" })).toBeVisible();
  });

  it("retains a failed autosave for explicit retry", async () => {
    api.attempt.mockResolvedValue(attempt);
    api.saveAttemptAnswer
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        selected_option_ids: [optionIds[0]],
        client_revision: 1,
        server_revision: 2,
        saved_at: "2026-07-17T10:01:00Z"
      });
    renderRoute(
      `/assessments/attempts/${attempt.id}`,
      "/assessments/attempts/:attemptId",
      <AttemptPage />
    );

    fireEvent.click(await screen.findByRole("radio", { name: /Facial nerve/ }));
    expect(await screen.findByText(/waiting to reconnect/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.saveAttemptAnswer).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Answer saved")).toBeVisible();
  });

  it("withholds delayed results without rendering score or answer keys", async () => {
    api.assessmentResult.mockResolvedValue({
      ...releasedResult,
      released: false,
      percentage: null,
      passed: null,
      score_points: null,
      maximum_points: null,
      answered_count: null,
      unanswered_count: null,
      questions: null,
      release_at: "2026-07-18T10:00:00Z"
    });
    renderRoute(
      `/assessments/results/${releasedResult.id}`,
      "/assessments/results/:resultId",
      <ResultPage />
    );

    expect(await screen.findByRole("heading", { name: "Your result is safely held." })).toBeVisible();
    expect(screen.queryByText("100.00%")).not.toBeInTheDocument();
    expect(screen.queryByText("Correct answer")).not.toBeInTheDocument();
  });

  it("reviews a released answer and submits a scoped mistake report", async () => {
    api.assessmentResult.mockResolvedValue(releasedResult);
    api.reportQuestion.mockResolvedValue({ id: "report-1" });
    renderRoute(
      `/assessments/results/${releasedResult.id}`,
      "/assessments/results/:resultId",
      <ResultPage />
    );

    expect(await screen.findByText("100.00%")).toBeVisible();
    expect(screen.getByText("The facial nerve supplies the muscles of facial expression.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Report a possible mistake" }));
    fireEvent.change(screen.getByLabelText("What needs review?"), { target: { value: "outdated" } });
    fireEvent.change(screen.getByLabelText("Explain the issue"), {
      target: { value: "The explanation should cite the current course edition." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(api.reportQuestion).toHaveBeenCalledWith(releasedResult.id, {
      attempt_question_id: attempt.questions[0]!.id,
      category: "outdated",
      details: "The explanation should cite the current course edition."
    }));
    expect(await screen.findByText("Your report was recorded with the question version used in this attempt.")).toBeVisible();
  });

  it("shows an incorrect expired result and keeps report errors editable", async () => {
    api.assessmentResult.mockResolvedValue({
      ...releasedResult,
      passed: false,
      percentage: "0.00",
      attempt_status: "expired",
      questions: [{
        ...releasedResult.questions![0]!,
        correct: false,
        selected_option_ids: [optionIds[1]!],
        explanation: ""
      }]
    });
    api.reportQuestion.mockRejectedValue(
      new ApiError(409, { error: { message: "This question was already reported." } })
    );
    renderRoute(
      `/assessments/results/${releasedResult.id}`,
      "/assessments/results/:resultId",
      <ResultPage />
    );

    expect(await screen.findByText("0.00%")).toBeVisible();
    expect(screen.getByText("Submitted at deadline")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Report a possible mistake" }));
    fireEvent.change(screen.getByLabelText("Explain the issue"), {
      target: { value: "This wording appears to be outdated for the course." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already reported");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.getByRole("button", { name: "Report a possible mistake" })).toBeVisible();
  });

  it("renders a bounded result-load error", async () => {
    api.assessmentResult.mockRejectedValue(new Error("offline"));
    renderRoute(
      `/assessments/results/${releasedResult.id}`,
      "/assessments/results/:resultId",
      <ResultPage />
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
  });
});
