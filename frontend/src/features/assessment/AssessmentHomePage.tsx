import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { quizzes, reviewQueue } from "./api";
import type { AssessmentMode, Quiz, ReviewItem } from "./types";

const modes: Array<AssessmentMode | "all"> = ["all", "practice", "quiz", "mastery"];

export function AssessmentHomePage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Quiz[] | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [mode, setMode] = useState<AssessmentMode | "all">("all");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled([quizzes(undefined, controller.signal), reviewQueue(controller.signal)])
      .then(([quizResult, reviewResult]) => {
        if (controller.signal.aborted) return;
        if (quizResult.status === "fulfilled") setItems(quizResult.value.results);
        else setFailed(true);
        if (reviewResult.status === "fulfilled") setReviews(reviewResult.value.results);
        else setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const visible = useMemo(
    () => items?.filter((item) => mode === "all" || item.version.mode === mode) ?? [],
    [items, mode]
  );
  const practice = items?.find((item) => item.version.mode === "practice");

  if (!items && !failed) return <PageSkeleton label={t("loadingAssessments")} />;

  return (
    <div className="page assessment-home">
      <header className="page-heading page-heading--wide">
        <p className="eyebrow">{t("assessmentEyebrow")}</p>
        <h1>{t("assessmentTitle")}</h1>
        <p>{t("assessmentCopy")}</p>
      </header>
      {failed ? <Alert>{t("assessmentLoadError")}</Alert> : null}

      <section className="review-command" aria-labelledby="review-command-title">
        <div>
          <span className="review-command__count">{reviews.length}</span>
          <div>
            <p className="eyebrow">{t("dueNow")}</p>
            <h2 id="review-command-title">{t("reviewQueueTitle")}</h2>
            <p>{reviews.length ? t("reviewQueueReady") : t("reviewQueueClear")}</p>
          </div>
        </div>
        {reviews.length && practice ? (
          <Link className="button button--primary" to={`/assessments/quizzes/${practice.id}?review=1`}>
            {t("startDueReview")}
          </Link>
        ) : null}
      </section>

      {reviews.length ? (
        <ul className="review-preview" aria-label={t("reviewQueueTitle")}>
          {reviews.slice(0, 3).map((review) => (
            <li key={review.question_id}>
              <span>{review.academic_node_title}</span>
              <strong>{review.prompt}</strong>
              <small>{review.mastery_state === "mastered" ? t("mastered") : t("learningState")}</small>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="study-section" aria-labelledby="assessment-list-title">
        <header className="study-section__heading assessment-list-heading">
          <div><h2 id="assessment-list-title">{t("availableAssessments")}</h2><span>{visible.length}</span></div>
          <div className="assessment-filter" role="group" aria-label={t("filterAssessments")}>
            {modes.map((entry) => (
              <Button
                key={entry}
                variant={mode === entry ? "secondary" : "quiet"}
                aria-pressed={mode === entry}
                onClick={() => setMode(entry)}
              >
                {t(entry === "all" ? "allAssessments" : `mode_${entry}`)}
              </Button>
            ))}
          </div>
        </header>
        {visible.length ? (
          <ul className="assessment-list">
            {visible.map((item) => (
              <li key={item.id}>
                <Link to={`/assessments/quizzes/${item.id}`}>
                  <span className={`mode-mark mode-mark--${item.version.mode}`}>{t(`mode_${item.version.mode}`)}</span>
                  <div>
                    <strong>{item.version.title}</strong>
                    <span>{item.version.academic_node_title}</span>
                  </div>
                  <dl>
                    <div><dt>{t("questionsLabel")}</dt><dd>{item.version.question_count}</dd></div>
                    <div><dt>{t("durationLabel")}</dt><dd>{item.version.duration_seconds ? `${Math.ceil(item.version.duration_seconds / 60)} ${t("minutesShort")}` : t("untimed")}</dd></div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("noAssessments")}>{t("noAssessmentsCopy")}</EmptyState>
        )}
      </section>
    </div>
  );
}
