/** A practice replay can use a verdict already revealed for these exact choices. */
export function gradeRecordedRetry(question, recorded, choiceIds) {
  const offered = new Set((question.choices || []).map((choice) => choice.id));
  const correct = recorded?.correct_choice_ids;
  if (!Array.isArray(correct) || !correct.length || !choiceIds.length || new Set(choiceIds).size !== choiceIds.length ||
      correct.some((id) => !offered.has(id)) || choiceIds.some((id) => !offered.has(id))) return null;
  return {
    ...recorded,
    selected_choice_ids: choiceIds,
    is_correct: choiceIds.length === correct.length && choiceIds.every((id) => correct.includes(id)),
    xp_awarded: 0
  };
}
