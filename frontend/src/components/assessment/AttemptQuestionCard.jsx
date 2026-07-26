import { Icon } from "../../lib/icons.jsx";

function optionLabel(option) {
  return typeof option?.text === "string" ? option.text : "Option unavailable";
}

/** Student attempt snapshot: no correct answer or explanation is rendered here. */
export function AttemptQuestionCard({ question, saving, error, conflict, disabled, onSelect }) {
  const selectedIds = Array.isArray(question?.answer?.selected_option_ids) ? question.answer.selected_option_ids : [];
  const options = Array.isArray(question?.option_snapshot) ? question.option_snapshot : [];
  return (
    <article className="question-card">
      <div className="card-head"><div><span className="pill">{question.difficulty || "Question"}</span><h2>{question.prompt}</h2></div><span className="stat-icon"><Icon name="help" /></span></div>
      <div className="choices">
        {options.map((option, index) => {
          const selected = selectedIds.includes(option.id);
          return <button key={option.id} type="button" className={selected ? "selected" : ""} disabled={disabled || saving} aria-pressed={selected} onClick={() => onSelect(option.id)}><span className="choice-prefix">{String.fromCharCode(65 + index)}</span><span>{optionLabel(option)}</span>{selected && <Icon name="check" size={18} />}</button>;
        })}
      </div>
      {saving && <p className="save-hint" role="status">Saving your answer to the server…</p>}
      {conflict && <p className="save-hint" role="status">A newer saved answer was restored from the server.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
