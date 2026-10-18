import { useState } from "react";
import { latestExplainAttempt } from "./model.js";
import { DictationControl } from "./SummaryEditor.jsx";

export default function ExplainEditor({ questions, attempts, drafts, onDraft, onSubmit, onSummary, conceptId, page, t, locale, uiState, onState }) {
  const difficulty = uiState.difficulty || "easy";
  const selected = uiState.selected || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const wanted = Array.isArray(conceptId) ? conceptId : conceptId ? [conceptId] : [];
  const filtered = questions.filter((question) => question.difficulty === difficulty
    && wanted.every((id) => (question.concept_ids || [question.concept_id]).includes(id))
    && (wanted.length || (question.page_start <= page && question.page_end >= page)));
  const question = filtered.find((item) => item.id === selected) || filtered[0];
  const draftKey = question ? `${question.id}:${question.revision}` : "";
  const draft = draftKey ? drafts[draftKey] || "" : "";
  const earlierDrafts = question ? Object.entries(drafts).filter(([key, text]) => typeof text === "string" && text && key !== draftKey && (key === question.id || key.startsWith(`${question.id}:`))) : [];
  const history = question ? attempts.filter((attempt) => attempt.question_id === question.id) : [];
  const latest = latestExplainAttempt(history);
  async function submit() {
    setBusy(true); setError(false);
    try { await onSubmit(question, draft); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <>
    <p className="knowledge-hint">{t("knowledge.explainHint")}</p>
    {wanted.length > 0 && <button type="button" onClick={() => onState({ conceptIds: [], selected: "" })}>{t("knowledge.allQuestions")}</button>}
    <label>{t("knowledge.difficulty")}<select value={difficulty} onChange={(event) => { onState({ difficulty: event.target.value, selected: "" }); }}>{["easy", "medium", "hard"].map((level) => <option key={level} value={level}>{t(`knowledge.${level}`)}</option>)}</select></label>
    {!question ? <p className="knowledge-empty">{t("knowledge.noQuestions")}</p> : <>
      <label>{t("knowledge.question")}<select value={question.id} onChange={(event) => onState({ selected: event.target.value })}>{filtered.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.prompt}</option>)}</select></label>
      <h3 dir="auto">{question.prompt}</h3>
      {earlierDrafts.length > 0 && <details><summary>{t("knowledge.earlierDrafts")}</summary>{earlierDrafts.map(([key, text]) => <p dir="auto" key={key}>{text}</p>)}</details>}
      <label className="knowledge-field">{t("knowledge.yourExplanation")}<textarea aria-label={t("knowledge.yourExplanation")} dir="auto" maxLength={10000} rows={8} value={draft} onChange={(event) => onDraft(draftKey, event.target.value)} /></label>
      <DictationControl t={t} locale={locale} onText={(text) => onDraft(draftKey, [draft, text].filter(Boolean).join("\n"))} />
      <button type="button" disabled={!draft.trim() || busy} onClick={() => { void submit(); }}>{t("knowledge.submitExplanation")}</button>
      {error && <p role="alert">{t("knowledge.storage_error")}</p>}
      {latest?.evaluation_status === "pending" && <p role="status">{t("knowledge.pendingEvaluation")}</p>}
      {latest?.feedback && <section className="knowledge-feedback" aria-label={t("knowledge.reference")}>
        <h3>{t("knowledge.reference")}</h3>
        {latest.question_revision !== question.revision && <p className="knowledge-warning">{t("knowledge.earlierQuestion")} <span dir="auto">{latest.feedback.prompt}</span></p>}
        <p className="knowledge-hint">{t("knowledge.selfReviewOnly")}</p>
        <p dir="auto">{latest.feedback.reference_answer}</p>
        <ul>{latest.feedback.essential_points.map((point, index) => <li dir="auto" key={index}>{point}</li>)}</ul>
        {latest.feedback.alternatives?.map((text, index) => <p dir="auto" key={index}>{text}</p>)}
        {latest.feedback.follow_ups?.length > 0 && <><h4>{t("knowledge.followUps")}</h4>{latest.feedback.follow_ups.map((text, index) => <p dir="auto" key={index}>{text}</p>)}</>}
        <button type="button" onClick={() => onSummary({ text: latest.feedback.essential_points.join("\n"), conceptIds: latest.feedback.concept_ids || question.concept_ids || [question.concept_id], source: latest.feedback.source || { page_start: question.page_start, page_end: question.page_end } })}>{t("knowledge.addSummary")}</button>
        <p>{t("knowledge.selfRating")}</p>
        <div className="knowledge-toolbar">{["needs_review", "partial", "understood"].map((rating) => <button type="button" key={rating} disabled={busy || latest.question_revision !== question.revision} onClick={async () => { setBusy(true); try { await onSubmit(question, latest.answer, rating); } finally { setBusy(false); } }}>{t(`knowledge.rating_${rating}`)}</button>)}</div>
      </section>}
    </>}
  </>;
}
