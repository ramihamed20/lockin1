import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Attempt } from "./types";
import {
  clearAttemptRecovery,
  clearPendingAnswer,
  readPendingAnswers,
  storePendingAnswer
} from "./recovery";

const attempt = {
  id: "10000000-0000-4000-8000-000000000001",
  questions: [{
    id: "20000000-0000-4000-8000-000000000001",
    option_snapshot: [{ id: "30000000-0000-4000-8000-000000000001", text: "A" }]
  }]
} as Attempt;

describe("scoped answer recovery", () => {
  beforeEach(() => sessionStorage.clear());

  it("stores only validated pending answer identifiers and removes acknowledgements", () => {
    const pending = {
      questionId: attempt.questions[0]!.id,
      selectedOptionIds: [attempt.questions[0]!.option_snapshot[0]!.id],
      clientRevision: 2,
      createdAt: Date.now()
    };
    storePendingAnswer(attempt.id, pending);
    expect(readPendingAnswers(attempt)).toEqual([pending]);
    clearPendingAnswer(attempt.id, pending.questionId);
    expect(readPendingAnswers(attempt)).toEqual([]);
  });

  it("rejects malformed, unknown, and expired storage payloads", () => {
    const key = `lockin:assessment:pending:${attempt.id}`;
    sessionStorage.setItem(key, "not-json");
    expect(readPendingAnswers(attempt)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify({ questionId: attempt.questions[0]!.id }));
    expect(readPendingAnswers(attempt)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([null, {
      questionId: attempt.questions[0]!.id,
      selectedOptionIds: [],
      clientRevision: 1,
      createdAt: Date.now() - (7 * 60 * 60 * 1000)
    }]));
    expect(readPendingAnswers(attempt)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ questionId: "bad", selectedOptionIds: [], clientRevision: 1, createdAt: Date.now() }]));
    expect(readPendingAnswers(attempt)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{
      questionId: attempt.questions[0]!.id,
      selectedOptionIds: ["40000000-0000-4000-8000-000000000001"],
      clientRevision: 1,
      createdAt: Date.now()
    }]));
    expect(readPendingAnswers(attempt)).toEqual([]);
  });

  it("fails closed when session storage is unavailable", () => {
    const getter = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readPendingAnswers(attempt)).toEqual([]);
    getter.mockRestore();
    storePendingAnswer(attempt.id, {
      questionId: attempt.questions[0]!.id,
      selectedOptionIds: [],
      clientRevision: 1,
      createdAt: Date.now()
    });
    clearAttemptRecovery(attempt.id);
    expect(readPendingAnswers(attempt)).toEqual([]);
  });

  it("keeps other pending questions while clearing one entry", () => {
    const second = {
      ...attempt,
      questions: [
        attempt.questions[0]!,
        {
          ...attempt.questions[0]!,
          id: "20000000-0000-4000-8000-000000000002",
          option_snapshot: [{ id: "30000000-0000-4000-8000-000000000002", text: "B" }]
        }
      ]
    };
    for (const question of second.questions) {
      storePendingAnswer(second.id, {
        questionId: question.id,
        selectedOptionIds: [question.option_snapshot[0]!.id],
        clientRevision: 1,
        createdAt: Date.now()
      });
    }
    clearPendingAnswer(second.id, second.questions[0]!.id);
    expect(readPendingAnswers(second)).toHaveLength(1);
  });
});
