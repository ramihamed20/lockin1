import { useId, useState } from "react";
import { useI18n } from "../I18nProvider.jsx";
import "./question-flow.css";

/**
 * The product's one explanation control: once a question is answered and the
 * explanation exists, an "Explanation" button reveals it in place. It renders
 * nothing when there is no explanation, so callers never show an empty box.
 */
export function QuestionExplanation({ explanation, className = "", labelKey = "question.explanation", hideLabelKey = "question.hideExplanation" }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const text = typeof explanation === "string" ? explanation.trim() : "";
  if (!text) return null;
  return (
    <div className={`question-explanation ${className}`.trim()}>
      <button className="btn btn-soft compact question-explanation-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {t(open ? hideLabelKey : labelKey)}
      </button>
      {open && <p id={id} className="question-explanation-text" dir="auto">{text}</p>}
    </div>
  );
}
