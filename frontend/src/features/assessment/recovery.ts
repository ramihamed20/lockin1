import type { Attempt } from "./types";

const PREFIX = "lockin:assessment:pending:";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  clientRevision: number;
  createdAt: number;
};

function key(attemptId: string) {
  return `${PREFIX}${attemptId}`;
}

function rawPending(attemptId: string): PendingAnswer[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key(attemptId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingAnswer => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return Boolean(
        typeof candidate.questionId === "string" &&
        UUID_PATTERN.test(candidate.questionId) &&
        Array.isArray(candidate.selectedOptionIds) &&
        candidate.selectedOptionIds.length <= 1 &&
        candidate.selectedOptionIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id)) &&
        Number.isInteger(candidate.clientRevision) &&
        Number(candidate.clientRevision) > 0 &&
        typeof candidate.createdAt === "number" &&
        Date.now() - candidate.createdAt < MAX_AGE_MS
      );
    });
  } catch {
    return [];
  }
}

export function readPendingAnswers(attempt: Attempt): PendingAnswer[] {
  const questions = new Map(attempt.questions.map((question) => [question.id, question]));
  return rawPending(attempt.id).filter((pending) => {
    const question = questions.get(pending.questionId);
    if (!question) return false;
    const allowed = new Set(question.option_snapshot.map((option) => option.id));
    return pending.selectedOptionIds.every((id) => allowed.has(id));
  });
}

export function storePendingAnswer(attemptId: string, answer: PendingAnswer) {
  try {
    const current = rawPending(attemptId).filter((item) => item.questionId !== answer.questionId);
    sessionStorage.setItem(key(attemptId), JSON.stringify([...current, answer].slice(-100)));
  } catch {
    // Autosave remains server-first when storage is unavailable.
  }
}

export function clearPendingAnswer(attemptId: string, questionId: string) {
  try {
    const current = rawPending(attemptId).filter((item) => item.questionId !== questionId);
    if (current.length) sessionStorage.setItem(key(attemptId), JSON.stringify(current));
    else sessionStorage.removeItem(key(attemptId));
  } catch {
    // Storage cleanup is best effort; entries expire and are validated before use.
  }
}

export function clearAttemptRecovery(attemptId: string) {
  try {
    sessionStorage.removeItem(key(attemptId));
  } catch {
    // No recovery state exists when session storage is unavailable.
  }
}
