import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { AttemptTimer } from "./components/AttemptTimer";
import { QuestionPanel } from "./components/QuestionPanel";
import { SubmissionDialog } from "./components/SubmissionDialog";
import { SaveIndicator } from "./components/SaveIndicator";
import type { AttemptQuestion } from "./types";

const question: AttemptQuestion = {
  id: "20000000-0000-4000-8000-000000000001",
  position: 1,
  prompt: "Which nerve controls facial expression?",
  question_type: "single_choice",
  difficulty: "medium",
  language: "en",
  option_snapshot: [
    { id: "30000000-0000-4000-8000-000000000001", text: "Facial nerve" },
    { id: "30000000-0000-4000-8000-000000000002", text: "Optic nerve" }
  ],
  max_points: "1.00",
  answer: null
};

function renderLocalized(children: React.ReactNode) {
  return render(<I18nProvider>{children}</I18nProvider>);
}

describe("assessment interaction components", () => {
  beforeEach(() => {
    localStorage.setItem("lockin.locale", "en");
  });

  it("uses native radio semantics and reports the selected option", () => {
    const onSelect = vi.fn();
    renderLocalized(
      <QuestionPanel
        question={question}
        selectedOptionId={question.option_snapshot[0]!.id}
        onSelect={onSelect}
        disabled={false}
      />
    );

    expect(screen.getByRole("group", { name: /Question 1/ })).toBeVisible();
    expect(screen.getByRole("radio", { name: /Facial nerve/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Optic nerve/ }));
    expect(onSelect).toHaveBeenCalledWith(question.option_snapshot[1]!.id);
  });

  it("focuses the reversible dialog action and supports Escape", () => {
    const onCancel = vi.fn();
    renderLocalized(
      <SubmissionDialog unanswered={2} pending={false} onCancel={onCancel} onConfirm={vi.fn()} />
    );

    expect(screen.getByRole("dialog", { name: "Submit this attempt?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep reviewing" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("announces every autosave state and makes failure recovery actionable", () => {
    const retry = vi.fn();
    const view = renderLocalized(<SaveIndicator state="idle" onRetry={retry} />);
    expect(screen.getByText("Not answered")).toBeVisible();
    view.rerender(<I18nProvider><SaveIndicator state="saving" onRetry={retry} /></I18nProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Saving answer");
    view.rerender(<I18nProvider><SaveIndicator state="failed" onRetry={retry} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders an untimed assessment without starting an expiry clock", () => {
    const expired = vi.fn();
    renderLocalized(
      <AttemptTimer serverTime="2026-07-17T10:00:00Z" deadline={null} onExpired={expired} />
    );
    expect(screen.getByText("Untimed")).toBeVisible();
    expect(expired).not.toHaveBeenCalled();
  });

  it("locks the submission dialog while the final request is pending", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderLocalized(
      <SubmissionDialog unanswered={0} pending onCancel={onCancel} onConfirm={onConfirm} />
    );
    expect(screen.getByText("Every question has an answer.")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
  });

  it("derives expiry from server time and calls the deadline handler once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T10:00:00Z"));
    const onExpired = vi.fn();
    renderLocalized(
      <AttemptTimer
        serverTime="2026-07-17T10:00:00Z"
        deadline="2026-07-17T10:00:02Z"
        onExpired={onExpired}
      />
    );

    expect(screen.getByLabelText("Time remaining 0:02")).toBeVisible();
    await act(() => vi.advanceTimersByTime(3_000));
    expect(onExpired).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTime(3_000));
    expect(onExpired).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
