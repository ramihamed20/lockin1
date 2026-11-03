/** Bounded budgets use measured timing only after the server has enough samples. */
export function reviewQuestionLimit(data, minutes) {
  const seconds = Number(data?.seconds_per_question) || 30;
  return Math.max(1, Math.min(20, Math.floor(minutes * 60 / seconds)));
}

export function requestedReviewLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 10;
}

/** Accumulates foreground answering time without a ticking React state. */
export function createReviewTimer(clock = () => globalThis.performance.now()) {
  let elapsed = 0;
  let started = null;
  return {
    resume() { if (started === null) started = clock(); },
    pause() { if (started !== null) { elapsed += Math.max(0, clock() - started); started = null; } },
    seconds() { return Math.min(900, Math.max(1, Math.round((elapsed + (started === null ? 0 : Math.max(0, clock() - started))) / 1000))); }
  };
}
