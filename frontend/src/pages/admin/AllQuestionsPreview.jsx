import { useState } from "react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { allQuestionsPreviewSections } from "../../lib/allQuestionsImport.js";

export function AllQuestionsPreview({ payload }) {
  const { t } = useI18n();
  const sections = allQuestionsPreviewSections(payload);
  const [sectionId, setSectionId] = useState(sections[0]?.id || "");
  const [position, setPosition] = useState(1);
  const selected = sections.find((item) => item.id === sectionId) || sections[0];
  const question = selected?.questions[position - 1];
  function sectionLabel(section) {
    if (section.kind === "normal") return t("allQuestions.normal");
    return `${t(`questions.difficulty.${section.difficulty}`)} — ${t(`allQuestions.${section.kind}`, { number: section.number })}`;
  }
  return <details className="admin-all-questions-preview">
    <summary>{t("allQuestions.preview")}</summary>
    <div className="admin-form-grid">
      <label className="field"><span>{t("allQuestions.section")}</span><select value={selected?.id || ""} onChange={(event) => { setSectionId(event.target.value); setPosition(1); }}>{sections.map((section) => <option key={section.id} value={section.id}>{sectionLabel(section)} · {section.questions.length}</option>)}</select></label>
      <label className="field"><span>{t("allQuestions.question")}</span><input type="number" inputMode="numeric" min="1" max={selected?.questions.length || 1} value={position} onChange={(event) => setPosition(Math.min(selected?.questions.length || 1, Math.max(1, Math.trunc(Number(event.target.value)) || 1)))} /></label>
    </div>
    {question ? <article className="admin-all-questions-preview-card" dir="auto">
      <p><strong>{position}. {question.question}</strong></p>
      {question.type === "true_false" ? <p>{t("allQuestions.true")} / {t("allQuestions.false")}</p> : <ol type="A">{["A", "B", "C", "D"].map((key) => <li key={key} className={key === question.correct_answer ? "is-correct" : ""}>{question.options?.[key]}</li>)}</ol>}
      <p><strong>{t("allQuestions.correct")}:</strong> {question.type === "true_false" ? t(question.correct_answer ? "allQuestions.true" : "allQuestions.false") : question.correct_answer}</p>
      <p><strong>{t("allQuestions.explanation")}:</strong> {question.explanation}</p>
    </article> : <p>{t("allQuestions.empty")}</p>}
  </details>;
}
