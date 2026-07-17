import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { assessmentResult, reportQuestion } from "./api";
import type { AssessmentResult } from "./types";

export function ResultPage() {
  const { resultId = "" } = useParams();
  const { t } = useI18n();
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportPending, setReportPending] = useState(false);
  const [reportMessage, setReportMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void assessmentResult(resultId, controller.signal)
      .then(setResult)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [resultId]);

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result || !reportingId) return;
    const form = new FormData(event.currentTarget);
    setReportPending(true);
    setReportMessage("");
    try {
      await reportQuestion(result.id, {
        attempt_question_id: reportingId,
        category: formValue(form, "category"),
        details: formValue(form, "details")
      });
      setReportMessage(t("reportReceived"));
      setReportingId(null);
    } catch (error) {
      setReportMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setReportPending(false);
    }
  }

  if (!result && !failed) return <PageSkeleton label={t("loadingResult")} />;
  if (failed || !result) return <div className="page"><Alert>{t("assessmentLoadError")}</Alert></div>;

  if (!result.released) {
    return (
      <div className="page page--narrow result-delayed">
        <p className="eyebrow">{t("resultRecorded")}</p>
        <h1>{t("resultPendingTitle")}</h1>
        <p>{t("resultPendingCopy")}</p>
        <dl className="assessment-facts">
          <div><dt>{t("submittedLabel")}</dt><dd>{new Date(result.submitted_at).toLocaleString()}</dd></div>
          <div><dt>{t("releaseLabel")}</dt><dd>{new Date(result.release_at).toLocaleString()}</dd></div>
        </dl>
        <Link className="button button--primary" to="/assessments">{t("backToAssessments")}</Link>
      </div>
    );
  }

  return (
    <div className="page assessment-result">
      <header className="result-hero">
        <div>
          <p className="eyebrow">{result.passed ? t("masteryProgress") : t("reviewNext")}</p>
          <h1>{result.quiz_title}</h1>
          <p>{result.passed ? t("resultPassedCopy") : t("resultReviewCopy")}</p>
        </div>
        <div className={`result-score${result.passed ? " result-score--passed" : ""}`}>
          <strong>{result.percentage}%</strong>
          <span>{result.passed ? t("passed") : t("keepLearning")}</span>
        </div>
      </header>
      <dl className="result-summary">
        <div><dt>{t("correctAnswers")}</dt><dd>{result.questions?.filter((question) => question.correct).length ?? 0}</dd></div>
        <div><dt>{t("answeredLabel")}</dt><dd>{result.answered_count}</dd></div>
        <div><dt>{t("unansweredLabel")}</dt><dd>{result.unanswered_count}</dd></div>
        <div><dt>{t("resultStatus")}</dt><dd>{result.attempt_status === "expired" ? t("submittedAtDeadline") : t("submittedLabel")}</dd></div>
      </dl>
      {reportMessage ? <Alert tone={reportingId ? "error" : "success"}>{reportMessage}</Alert> : null}
      <section className="result-review" aria-labelledby="result-review-title">
        <header><h2 id="result-review-title">{t("reviewAnswers")}</h2><p>{t("reviewAnswersCopy")}</p></header>
        <ol>
          {result.questions?.map((question) => (
            <li key={question.id} className={question.correct ? "is-correct" : "is-incorrect"}>
              <div className="result-question__heading">
                <span>{question.position}</span>
                <div><strong>{question.prompt}</strong><small>{question.correct ? t("correct") : t("needsReview")}</small></div>
              </div>
              <ul className="result-options">
                {question.option_snapshot.map((option) => {
                  const selected = question.selected_option_ids.includes(option.id);
                  const correct = question.correct_option_ids.includes(option.id);
                  return (
                    <li key={option.id} className={`${selected ? "is-selected" : ""}${correct ? " is-answer" : ""}`}>
                      <span>{option.text}</span>
                      {correct ? <strong>{t("correctAnswer")}</strong> : selected ? <strong>{t("yourAnswer")}</strong> : null}
                    </li>
                  );
                })}
              </ul>
              {question.explanation ? <p className="result-explanation"><strong>{t("explanationLabel")}</strong>{question.explanation}</p> : null}
              <Link className="text-action" to={`/community/context/question/${question.question_id}?label=${encodeURIComponent(question.prompt)}`}>{t("communityDiscussQuestion")}</Link>
              {reportingId === question.id ? (
                <form className="report-form" onSubmit={(event) => void submitReport(event)}>
                  <SelectField name="category" label={t("reportCategory")} defaultValue="ambiguous">
                    <option value="answer_key">{t("report_answer_key")}</option>
                    <option value="ambiguous">{t("report_ambiguous")}</option>
                    <option value="outdated">{t("report_outdated")}</option>
                    <option value="typo">{t("report_typo")}</option>
                    <option value="other">{t("report_other")}</option>
                  </SelectField>
                  <div className="field"><label htmlFor={`report-${question.id}`}>{t("reportDetails")}</label><textarea id={`report-${question.id}`} name="details" required minLength={10} maxLength={4000} rows={3} /></div>
                  <div className="form-actions"><Button type="button" variant="quiet" onClick={() => setReportingId(null)}>{t("cancelEditing")}</Button><Button type="submit" disabled={reportPending}>{reportPending ? t("saving") : t("sendReport")}</Button></div>
                </form>
              ) : (
                <Button variant="quiet" onClick={() => setReportingId(question.id)}>{t("reportMistake")}</Button>
              )}
            </li>
          ))}
        </ol>
      </section>
      <footer className="result-next">
        <div><p className="eyebrow">{t("nextStudySession")}</p><h2>{t("continueLearningLoop")}</h2></div>
        <div className="form-actions"><Link className="button button--quiet" to={`/community/context/quiz/${result.quiz_id}?label=${encodeURIComponent(result.quiz_title)}`}>{t("communityDiscussResult")}</Link><Link className="button button--secondary" to="/learn">{t("studyAction")}</Link><Link className="button button--primary" to="/assessments">{t("practiceAgain")}</Link></div>
      </footer>
    </div>
  );
}
