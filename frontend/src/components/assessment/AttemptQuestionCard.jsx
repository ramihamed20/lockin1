import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

function optionLabel(option, t) {
  return typeof option?.text === "string" ? option.text : t("assessment.optionUnavailable");
}

/** Student attempt snapshot: grading details stay private until release. */
export function AttemptQuestionCard({ question, saving, error, conflict, disabled, onSelect }) {
  const { t } = useI18n();
  const selectedIds = Array.isArray(question?.answer?.selected_option_ids) ? question.answer.selected_option_ids : [];
  const options = Array.isArray(question?.option_snapshot) ? question.option_snapshot : [];
  return (
    <article className="question-card">
      <div className="card-head"><div><span className="pill" dir="auto">{question.difficulty || t("assessment.question")}</span><h2 dir="auto">{question.prompt}</h2></div><span className="stat-icon"><Icon name="help" /></span></div>
      {question.question_type === "multiple_select" && <p className="save-hint">{t("assessment.selectEvery")}</p>}
      <div className="choices">
        {options.map((option, index) => {
          const selected = selectedIds.includes(option.id);
          return <button key={option.id} type="button" className={selected ? "selected" : ""} disabled={disabled || saving} aria-pressed={selected} onClick={() => onSelect(option.id)}><span className="choice-prefix">{String.fromCharCode(65 + index)}</span><span dir="auto">{optionLabel(option, t)}</span>{selected && <Icon name="check" size={18} aria-hidden="true" />}</button>;
        })}
      </div>
      {saving && <p className="save-hint" role="status">{t("assessment.savingAnswer")}</p>}
      {!saving && selectedIds.length > 0 && <p className="save-hint" role="status">{t("assessment.answerSaved", { count: question.question_type === "multiple_select" ? selectedIds.length : 1 })}</p>}
      {conflict && <p className="save-hint" role="status">{t("assessment.newerAnswer")}</p>}
      {error && <p className="inline-error" role="alert" dir="auto">{error}</p>}
    </article>
  );
}
