import { useState, type FormEvent } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { FormField, SelectField } from "../../../components/FormField";
import { formValue } from "../../../components/formValue";
import { useI18n } from "../../../i18n/I18nProvider";
import type { EducationNode } from "../../learning/types";
import { saveQuizDraft } from "../api";
import type { AssessmentMode, ManagedQuestion, ManagedQuiz } from "../types";

export function QuizComposer({
  nodes,
  questions,
  onSaved
}: {
  nodes: EducationNode[];
  questions: ManagedQuestion[];
  onSaved: (quiz: ManagedQuiz) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AssessmentMode>("practice");
  const [selectionMode, setSelectionMode] = useState<"fixed" | "pool">("pool");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const published = questions.filter((question) => question.workflow_status === "published");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const questionCount = selectionMode === "fixed"
      ? selectedQuestionIds.length
      : Number(form.get("question_count") || 10);
    setPending(true);
    setMessage("");
    try {
      const item = await saveQuizDraft({
        academic_node_id: formValue(form, "academic_node_id"),
        title: formValue(form, "title"),
        instructions: formValue(form, "instructions"),
        mode,
        selection_mode: selectionMode,
        question_count: questionCount,
        question_ids: selectionMode === "fixed" ? selectedQuestionIds : [],
        duration_seconds: mode === "practice" ? null : Number(form.get("duration_minutes") || 30) * 60,
        maximum_attempts: mode === "practice" ? 0 : Number(form.get("maximum_attempts") || 1),
        randomize_questions: true,
        randomize_options: true,
        result_release: "immediate",
        pass_percent: formValue(form, "pass_percent") || "60.00",
        ranking_eligible: false,
        achievement_eligible: false,
        focus_required: form.get("focus_required") === "on",
        allowed_difficulties: form.getAll("allowed_difficulty").map(String),
        language: formValue(form, "language") || "en",
        metadata: {}
      });
      onSaved(item);
      formElement.reset();
      setSelectedQuestionIds([]);
      setMessage(t("quizDraftSaved"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="studio-editor assessment-composer" onSubmit={(event) => void submit(event)}>
      <header><div><p className="eyebrow">{t("assessmentBuilder")}</p><h2>{t("createAssessment")}</h2><p>{t("createAssessmentCopy")}</p></div></header>
      <div className="studio-editor__grid">
        <SelectField name="academic_node_id" label={t("learningLocation")} required defaultValue="">
          <option value="" disabled>{t("chooseLearningLocation")}</option>
          {nodes.filter((node) => node.status !== "archived").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </SelectField>
        <FormField name="title" label={t("assessmentName")} maxLength={220} required />
        <SelectField name="mode" label={t("assessmentMode")} value={mode} onChange={(event) => setMode(event.target.value as AssessmentMode)}>
          <option value="practice">{t("mode_practice")}</option><option value="quiz">{t("mode_quiz")}</option><option value="mastery">{t("mode_mastery")}</option>
        </SelectField>
        <SelectField name="selection_mode" label={t("selectionMode")} value={selectionMode} onChange={(event) => setSelectionMode(event.target.value as "fixed" | "pool")}>
          <option value="pool">{t("selectionPool")}</option><option value="fixed">{t("selectionFixed")}</option>
        </SelectField>
        {selectionMode === "pool" ? <FormField name="question_count" label={t("questionsLabel")} type="number" min={1} max={100} defaultValue={10} required /> : null}
        {mode !== "practice" ? <><FormField name="duration_minutes" label={t("durationMinutes")} type="number" min={1} max={240} defaultValue={30} required /><FormField name="maximum_attempts" label={t("attemptLimit")} type="number" min={1} max={100} defaultValue={1} required /></> : null}
        <FormField name="pass_percent" label={t("passMark")} type="number" min={0} max={100} defaultValue={60} required />
        <FormField name="language" label={t("contentLanguage")} defaultValue="en" maxLength={12} required />
      </div>
      <div className="field"><label htmlFor="quiz-instructions">{t("assessmentInstructions")}</label><textarea id="quiz-instructions" name="instructions" maxLength={10000} rows={3} /></div>
      <fieldset className="difficulty-picker"><legend>{t("difficultyPool")}</legend>{(["easy", "medium", "hard"] as const).map((difficulty) => <label className="check-control" key={difficulty}><input type="checkbox" name="allowed_difficulty" value={difficulty} defaultChecked /><span>{t(`difficulty_${difficulty}`)}</span></label>)}</fieldset>
      {selectionMode === "fixed" ? (
        <fieldset className="question-picker"><legend>{t("fixedQuestions")}</legend>{published.length ? published.map((question) => <label className="check-control" key={question.id}><input type="checkbox" checked={selectedQuestionIds.includes(question.id)} onChange={(event) => setSelectedQuestionIds((current) => event.target.checked ? [...current, question.id] : current.filter((id) => id !== question.id))} /><span>{question.current_version.prompt}</span></label>) : <p className="muted-copy">{t("publishQuestionsFirst")}</p>}</fieldset>
      ) : null}
      <label className="check-control"><input type="checkbox" name="focus_required" defaultChecked /><span>{t("requireFocusWorkspace")}</span></label>
      <Button type="submit" disabled={pending || (selectionMode === "fixed" && !selectedQuestionIds.length)}>{pending ? t("saving") : t("saveAssessmentDraft")}</Button>
      {message ? <p className={message === t("quizDraftSaved") ? "inline-success" : "inline-error"} role="status">{message}</p> : null}
    </form>
  );
}
