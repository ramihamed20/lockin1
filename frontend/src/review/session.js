/** Bounded budgets use measured timing only after the server has enough samples. */
export function reviewQuestionLimit(data, minutes) {
  const seconds = Number(data?.seconds_per_question) || 30;
  return Math.max(1, Math.min(20, Math.floor(minutes * 60 / seconds)));
}

export function requestedReviewLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : 10;
}

/** Only already-revealed keys can power a local, unscored recovery pass. */
export function recoveryQuestions(items, outcomes, limit = 3) {
  const answered = items.filter(item => outcomes[item.id]);
  return answered.filter((item, index) => {
    const result = outcomes[item.id];
    const correct = result.review_item?.correct_option_ids;
    const options = new Set((item.options || []).map(option => String(option.id)));
    return result.was_correct === false && answered.length - index - 1 >= 2
      && Array.isArray(correct) && correct.length > 0
      && new Set(correct.map(String)).size === correct.length
      && correct.every(id => options.has(String(id)));
  }).slice(0, Math.max(0, Math.min(3, limit))).map(item => ({
    item, correctIds: outcomes[item.id].review_item.correct_option_ids.map(String),
    explanation: outcomes[item.id].review_item.explanation
  }));
}

export function gradeRecoveryAnswer(selected, correct) {
  return selected.length > 0 && new Set(selected.map(String)).size === selected.length
    && selected.length === correct.length && selected.every(id => correct.includes(String(id)));
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
