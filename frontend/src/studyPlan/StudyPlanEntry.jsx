import { useEffect, useState } from "react";
import { studyPlanApi } from "../api/studyPlan.js";
import StudyPlan from "../pages/StudyPlan.jsx";

/** The weekly plan stays available even when exam planning is not enabled. */
export default function StudyPlanEntry({ user }) {
  const [state, setState] = useState({ status: "loading", exams: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading", exams: null });
    studyPlanApi.getExams({ signal: controller.signal, user }).then(exams => {
      if (!controller.signal.aborted) setState({ status: "ready", exams });
    }).catch(error => {
      if (!controller.signal.aborted) {
        setState({ status: error?.status === 403 ? "closed" : "error", exams: null });
      }
    });
    return () => controller.abort();
  }, [user, attempt]);

  const examNotice = state.status === "closed" ? "plan.examDenied"
    : state.status === "error" ? "plan.examAccessError" : null;
  return <StudyPlan
    user={user}
    examPeriods={state.status === "ready" ? state.exams : null}
    examNotice={examNotice}
    onRetryExams={() => setAttempt(current => current + 1)}
  />;
}
