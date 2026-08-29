import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { assessmentsApi } from "../api/assessments.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { ErrorPanel, Page } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";

function returnPath(state) {
  return typeof state?.returnTo === "string" && state.returnTo.startsWith("/questions") ? state.returnTo : "/questions";
}

function errorText(error, t) {
  if (!error) return "";
  const firstField = error.fields && Object.values(error.fields).flat().find((value) => typeof value === "string");
  return firstField || error.message || t("assessment.startError");
}

/** Starts the authoritative attempt immediately after Open Quiz. */
export default function QuizDetail() {
  const { t } = useI18n();
  const { quizId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const startKey = useRef(generateIdempotencyKey());
  const started = useRef(false);
  const [error, setError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const returnTo = returnPath(location.state);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    assessmentsApi.startAttempt(quizId, { idempotencyKey: startKey.current })
      .then((response) => {
        const attempt = response?.attempt && typeof response.attempt === "object" ? /** @type {any} */ (response.attempt) : null;
        if (!attempt?.id) throw new Error(t("assessment.missingAttemptId"));
        navigate(`/questions/attempts/${attempt.id}`, { replace: true, state: { returnTo } });
      })
      .catch(setError);
  }, [navigate, quizId, returnTo, retryToken, t]);

  if (error) {
    return <Page title={t("assessment.unableToStart")}><ErrorPanel message={errorText(error, t)} /><div className="result-actions"><button className="btn btn-primary" type="button" onClick={() => { startKey.current = generateIdempotencyKey(); started.current = false; setError(null); setRetryToken((value) => value + 1); }}>{t("common.tryAgain")}</button><Link className="btn btn-soft" to={returnTo}>{t("assessment.backToQuizzes")}</Link></div></Page>;
  }

  return <Page title={t("assessment.startingTitle")} subtitle={t("assessment.startingSubtitle")}><section className="session-panel question-launch-panel" aria-busy="true"><p className="eyebrow">{t("assessment.quiz")}</p><h2>{t("assessment.startingHeading")}</h2><p className="muted">{t("assessment.loadingSecurely")}</p></section></Page>;
}
