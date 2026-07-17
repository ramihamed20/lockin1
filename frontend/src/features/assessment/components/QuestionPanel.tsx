import type { AttemptQuestion } from "../types";
import { useI18n } from "../../../i18n/I18nProvider";

export function QuestionPanel({
  question,
  selectedOptionId,
  onSelect,
  disabled
}: {
  question: AttemptQuestion;
  selectedOptionId: string | undefined;
  onSelect: (optionId: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset className="attempt-question" disabled={disabled}>
      <legend>
        <span>{t("questionLabel")} {question.position}</span>
        <strong>{question.prompt}</strong>
      </legend>
      <div className="attempt-options">
        {question.option_snapshot.map((option, index) => (
          <label key={option.id} className="attempt-option">
            <input
              type="radio"
              name={`question-${question.id}`}
              value={option.id}
              checked={selectedOptionId === option.id}
              onChange={() => onSelect(option.id)}
            />
            <span className="attempt-option__key" aria-hidden="true">{index + 1}</span>
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
