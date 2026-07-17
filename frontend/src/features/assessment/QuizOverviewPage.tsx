import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { useI18n } from "../../i18n/I18nProvider";
import { beginAttempt, quiz } from "./api";
import type { Quiz } from "./types";

export function QuizOverviewPage() {
  const { quizId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const reviewOnly = searchParams.get("review") === "1";
  const navigate = useNavigate();
  const { t } = useI18n();
  const [item, setItem] = useState<Quiz | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void quiz(quizId, controller.signal)
      .then(setItem)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [quizId]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const practice = item.version.mode === "practice";
      const result = await beginAttempt(item.id, {
        idempotency_key: crypto.randomUUID(),
        ...(practice ? { question_count: Number(form.get("question_count") || item.version.question_count) } : {}),
        ...(practice ? { difficulties: form.getAll("difficulty").map(String) } : {}),
        ...(reviewOnly ? { review_only: true } : {})
      });
      void navigate(`/assessments/attempts/${result.attempt.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (!item && !failed) return <PageSkeleton label={t("loadingAssessments")} />;
  if (failed || !item) return <div className="page"><Alert>{t("assessmentLoadError")}</Alert></div>;
  const version = item.version;
  return (
    <div className="page page--narrow quiz-overview">
      <nav className="breadcrumbs" aria-label={t("breadcrumbs")}>
        <Link to="/assessments">{t("navAssessments")}</Link>
        <a aria-current="page">{version.title}</a>
      </nav>
      <header className="page-heading">
        <p className="eyebrow">{reviewOnly ? t("dueReview") : t(`mode_${version.mode}`)}</p>
        <h1>{version.title}</h1>
        <p>{version.instructions || t("assessmentDefaultInstructions")}</p>
      </header>
      {error ? <Alert>{error}</Alert> : null}
      <dl className="assessment-facts">
        <div><dt>{t("questionsLabel")}</dt><dd>{version.question_count}</dd></div>
        <div><dt>{t("durationLabel")}</dt><dd>{version.duration_seconds ? `${Math.ceil(version.duration_seconds / 60)} ${t("minutesShort")}` : t("untimed")}</dd></div>
        <div><dt>{t("passMark")}</dt><dd>{version.pass_percent}%</dd></div>
        <div><dt>{t("attemptLimit")}</dt><dd>{version.maximum_attempts || t("unlimited")}</dd></div>
      </dl>
      <form className="assessment-start" onSubmit={(event) => void start(event)}>
        {version.mode === "practice" ? (
          <>
            <FormField
              name="question_count"
              type="number"
              min={1}
              max={version.question_count}
              defaultValue={Math.min(10, version.question_count)}
              label={t("practiceSize")}
            />
            <fieldset className="difficulty-picker">
              <legend>{t("difficultyLabel")}</legend>
              {(["easy", "medium", "hard"] as const).map((difficulty) => (
                <label className="check-control" key={difficulty}>
                  <input type="checkbox" name="difficulty" value={difficulty} defaultChecked={!reviewOnly} />
                  <span>{t(`difficulty_${difficulty}`)}</span>
                </label>
              ))}
            </fieldset>
          </>
        ) : null}
        <aside className="assessment-trust-note">
          <strong>{t("serverAuthority")}</strong>
          <span>{t("serverAuthorityCopy")}</span>
        </aside>
        <Button type="submit" fullWidth disabled={pending}>
          {pending ? t("startingAttempt") : reviewOnly ? t("startDueReview") : t("startAssessment")}
        </Button>
        <Link className="text-action" to={`/community/context/quiz/${item.id}?label=${encodeURIComponent(version.title)}`}>{t("communityDiscussQuiz")}</Link>
      </form>
    </div>
  );
}
