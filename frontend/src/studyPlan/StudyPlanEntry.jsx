import { useEffect, useState } from "react";
import { studyPlanApi } from "../api/studyPlan.js";
import { FeatureComingSoon } from "../components/FeatureComingSoon.jsx";
import { LoadingPanel } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import StudyPlan from "../pages/StudyPlan.jsx";

/** A closed product route can open only after the server authorizes this pilot account. */
export default function StudyPlanEntry({ user }) {
  const { t } = useI18n();
  const [state, setState] = useState({ status: "loading", exams: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", exams: [] });
    studyPlanApi.getExams({ signal: controller.signal }).then(exams => {
      if (!controller.signal.aborted) setState({ status: "pilot", exams });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ status: error.status === 403 ? "closed" : "error", exams: [] });
    });
    return () => controller.abort();
  }, [user.id, attempt]);
  if (state.status === "loading") return <LoadingPanel variant="list" />;
  if (state.status === "pilot") return <StudyPlan user={user} examPeriods={state.exams} />;
  return <>
    <FeatureComingSoon featureId="study-plan" />
    {state.status === "error" && <div className="plan-pilot-retry" role="status"><p>{t("plan.examAccessError")}</p><button className="btn btn-soft" type="button" onClick={() => setAttempt(value => value + 1)}>{t("plan.examRetry")}</button></div>}
  </>;
}
