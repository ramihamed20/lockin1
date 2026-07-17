import { useState, type FormEvent } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { FormField, SelectField } from "../../../components/FormField";
import { formValue } from "../../../components/formValue";
import { useI18n } from "../../../i18n/I18nProvider";
import type { EducationNode } from "../../learning/types";
import { saveQuestionDraft } from "../api";
import type { ManagedQuestion } from "../types";

export function QuestionComposer({
  nodes,
  onSaved
}: {
  nodes: EducationNode[];
  onSaved: (question: ManagedQuestion) => void;
}) {
  const { t } = useI18n();
  const [options, setOptions] = useState(["", ""]);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setMessage("");
    try {
      const question = await saveQuestionDraft({
        academic_node_id: formValue(form, "academic_node_id"),
        question_type: formValue(form, "question_type"),
        prompt: formValue(form, "prompt"),
        explanation: formValue(form, "explanation"),
        difficulty: formValue(form, "difficulty"),
        language: formValue(form, "language") || "en",
        metadata: {},
        options: options.map((text, index) => ({ text, is_correct: index === correctIndex }))
      });
      onSaved(question);
      formElement.reset();
      setOptions(["", ""]);
      setCorrectIndex(0);
      setMessage(t("questionDraftSaved"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="studio-editor assessment-composer" onSubmit={(event) => void submit(event)}>
      <header><div><p className="eyebrow">{t("questionBank")}</p><h2>{t("createQuestion")}</h2><p>{t("createQuestionCopy")}</p></div></header>
      <div className="studio-editor__grid">
        <SelectField name="academic_node_id" label={t("learningLocation")} required defaultValue="">
          <option value="" disabled>{t("chooseLearningLocation")}</option>
          {nodes.filter((node) => node.status !== "archived").map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
        </SelectField>
        <SelectField name="question_type" label={t("questionType")} defaultValue="single_choice">
          <option value="single_choice">{t("question_single_choice")}</option>
          <option value="true_false">{t("question_true_false")}</option>
          <option value="completion_choice">{t("question_completion_choice")}</option>
        </SelectField>
        <SelectField name="difficulty" label={t("difficultyLabel")} defaultValue="medium">
          <option value="easy">{t("difficulty_easy")}</option><option value="medium">{t("difficulty_medium")}</option><option value="hard">{t("difficulty_hard")}</option>
        </SelectField>
        <FormField name="language" label={t("contentLanguage")} defaultValue="en" maxLength={12} required />
      </div>
      <div className="field"><label htmlFor="question-prompt">{t("questionPrompt")}</label><textarea id="question-prompt" name="prompt" required maxLength={10000} rows={4} /></div>
      <fieldset className="question-option-editor">
        <legend>{t("answerOptions")}</legend>
        {options.map((option, index) => (
          <div key={index} className="question-option-editor__row">
            <input type="radio" name="correct_option" checked={correctIndex === index} aria-label={`${t("correctAnswer")} ${index + 1}`} onChange={() => setCorrectIndex(index)} />
            <FormField
              label={`${t("answerOption")} ${index + 1}`}
              value={option}
              required
              maxLength={2000}
              onChange={(event) => setOptions((current) => current.map((value, optionIndex) => optionIndex === index ? event.target.value : value))}
            />
            {options.length > 2 ? <Button type="button" variant="quiet" onClick={() => { setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index)); setCorrectIndex(0); }}>{t("removeOption")}</Button> : null}
          </div>
        ))}
        {options.length < 12 ? <Button type="button" variant="secondary" onClick={() => setOptions((current) => [...current, ""])}>{t("addOption")}</Button> : null}
      </fieldset>
      <div className="field"><label htmlFor="question-explanation">{t("explanationLabel")}</label><textarea id="question-explanation" name="explanation" maxLength={10000} rows={4} /></div>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("saveQuestionDraft")}</Button>
      {message ? <p className={message === t("questionDraftSaved") ? "inline-success" : "inline-error"} role="status">{message}</p> : null}
    </form>
  );
}
