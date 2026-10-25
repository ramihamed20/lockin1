import { useEffect, useRef, useState } from "react";
import { studyPlanApi } from "../api/studyPlan.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatDate } from "../lib/i18n.js";
import { fromStamp } from "./model.js";

const shownDate = stamp => formatDate(fromStamp(stamp), { day: "numeric", month: "short" });
const reasonKeys = {
  edition_unavailable: "plan.examEditionMissing", page_count_unknown: "plan.examPagesUnknown",
  partial_reading_needs_confirmation: "plan.examPartial", deadline_before_horizon: "plan.examDeadlinePassed",
  outside_horizon: "plan.examOutside", no_fitting_slot: "plan.examNoSlot"
};

export default function ReadingPlanPanel({ exams, profile, disabled, onSetup, onRefresh }) {
  const { t } = useI18n();
  const [examId, setExamId] = useState(exams[0]?.id || "");
  const [edition, setEdition] = useState("university");
  const [state, setState] = useState({ status: "idle", identity: "", preview: null });
  const request = useRef(null);
  const identity = `${examId}:${edition}:${profile.revision}`;
  useEffect(() => {
    request.current?.abort();
    setState({ status: "idle", identity: "", preview: null });
    return () => request.current?.abort();
  }, [identity, disabled]);
  const selected = exams.find(exam => exam.id === examId);
  const preview = state.identity === identity && !disabled ? state.preview : null;
  async function loadPreview(event) {
    event.preventDefault();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading", identity, preview: null });
    try {
      const data = await studyPlanApi.previewReading(examId, edition, { signal: controller.signal });
      if (!controller.signal.aborted) setState(data.profile_revision !== profile.revision
        ? { status: "stale", identity, preview: null }
        : { status: "ready", identity, preview: data });
    } catch (error) {
      if (!controller.signal.aborted) setState({ status: error.status === 403 ? "denied" : "error", identity, preview: null });
    }
  }
  return <section className="plan-exam-panel" aria-labelledby="plan-exam-title">
    <header><div><span className="plan-eyebrow">{t("plan.examPilot")}</span><h2 id="plan-exam-title"><Icon name="calendar" size={21} />{t("plan.examTitle")}</h2></div></header>
    <p className="plan-note">{t("plan.examReadOnly")}</p>
    {!exams.length ? <p role="status">{t("plan.examNone")}</p> : profile.mode !== "normal" ? <div className="plan-actions"><p>{t("plan.examSetup")}</p><button className="btn btn-soft" type="button" onClick={onSetup} disabled={disabled}>{t("plan.settings")}</button></div> : <>
      <form className="plan-exam-form" onSubmit={loadPreview}>
        <label>{t("plan.examChoose")}<select value={examId} disabled={disabled} onChange={event => setExamId(event.target.value)}>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.title}</option>)}</select></label>
        <label>{t("plan.examEdition")}<select value={edition} disabled={disabled} onChange={event => setEdition(event.target.value)}><option value="university">{t("plan.examUniversity")}</option><option value="lockin">{t("plan.examLockin")}</option></select></label>
        <button className="btn btn-primary" type="submit" disabled={disabled || state.status === "loading" || !selected}>{t(state.status === "loading" ? "plan.examLoading" : "plan.examPreview")}</button>
      </form>
      {selected && <p className="plan-exam-status">{shownDate(selected.starts_on)} · {t(selected.status === "confirmed" ? "plan.examConfirmed" : "plan.examTentative")}</p>}
      {["error", "denied"].includes(state.status) && <p role="alert">{t(state.status === "denied" ? "plan.examDenied" : "plan.examError")}</p>}
      {state.status === "stale" && <div role="alert"><p>{t("plan.examStale")}</p><button className="btn btn-soft" type="button" onClick={onRefresh}>{t("plan.refresh")}</button></div>}
      {preview && <div className="plan-exam-result" aria-live="polite">
        <p className="plan-note">{t("plan.examEstimate", { minutes: preview.estimate?.minutes_per_page ?? "—" })}</p>
        <dl className="plan-exam-totals"><div><dt>{t("plan.examRequired")}</dt><dd>{t("studyPlan.minutesValue", { count: preview.required_reading_minutes })}</dd></div><div><dt>{t("plan.examScheduled")}</dt><dd>{t("studyPlan.minutesValue", { count: preview.scheduled_reading_minutes })}</dd></div><div><dt>{t("plan.examUnplaced")}</dt><dd>{preview.unscheduled.length}</dd></div></dl>
        {preview.issues.length > 0 && <div className="plan-exam-warning" role="status"><strong>{t("plan.examIncomplete")}</strong><ul>{preview.issues.map((issue, index) => <li key={`${issue.sheet_id}-${index}`}><strong dir="auto">{issue.title}</strong> · {t(reasonKeys[issue.reason] || "plan.examUnknownIssue")}</li>)}</ul></div>}
        <h3>{t("plan.examTasks")}</h3>
        {preview.assignments.length ? <ol className="plan-exam-task-list">{preview.assignments.slice(0, 30).map(task => <li key={task.key}><strong dir="auto">{task.title}</strong><span>{t("plan.examPageRange", { first: task.page_start, last: task.page_end })}</span><small>{shownDate(task.scheduled_date)} · {t("studyPlan.minutesValue", { count: task.estimated_minutes })}</small></li>)}</ol> : <p>{t("plan.examNoTasks")}</p>}
        {preview.assignments.length > 30 && <p>{t("plan.examMoreTasks", { count: preview.assignments.length - 30 })}</p>}
        {!!preview.unscheduled.length && <details className="plan-exam-unplaced"><summary>{t("plan.examUnplacedDetails", { count: preview.unscheduled.length })}</summary><ul>{preview.unscheduled.slice(0, 30).map(task => <li key={task.key}><strong dir="auto">{task.title}</strong> · {t("plan.examPageRange", { first: task.page_start, last: task.page_end })}<p>{t(reasonKeys[task.reason] || "plan.examUnknownIssue")}</p></li>)}</ul>{preview.unscheduled.length > 30 && <p>{t("plan.examMoreTasks", { count: preview.unscheduled.length - 30 })}</p>}</details>}
        <p className="plan-note">{t("plan.examNotFeasibility")}</p>
      </div>}
    </>}
  </section>;
}
