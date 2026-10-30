import { useState } from "react";
import ReadingProgress from "./ReadingProgress.jsx";
import { Link } from "react-router-dom";
import { formatDate } from "../lib/i18n.js";
import { addDays, fromStamp } from "./model.js";

const dateLabel = stamp => formatDate(fromStamp(stamp), { weekday: "long", day: "numeric", month: "short" });
export default function LearningPreview({ preview, t, userId, periodId, onProgress }) {
  const [confirming, setConfirming] = useState(null);
  const [window, setWindow] = useState("week");
  const [limit, setLimit] = useState(20);
  const today = preview.today || preview.assignments[0]?.scheduled_date;
  const end = today ? addDays(today, 6) : "";
  const tasks = preview.assignments.filter(task => window === "all" || window === "today" && task.scheduled_date === today || window === "week" && task.scheduled_date >= today && task.scheduled_date <= end);
  const groups = new Map();
  tasks.slice(0, limit).forEach(task => { const rows = groups.get(task.scheduled_date) || []; rows.push(task); groups.set(task.scheduled_date, rows); });
  const unplaced = preview.unscheduled.reduce((sum, task) => sum + task.estimated_minutes, 0);
  const content = task => <><strong dir="auto">{task.title}</strong><span>{task.activity === "review" ? t("connected.reviewTask") : task.activity === "active_study" ? t("smart.activeRange", { first: task.page_start, last: task.page_end }) : t("plan.examPageRange", { first: task.page_start, last: task.page_end })} · {t("studyPlan.minutesValue", { count: task.estimated_minutes })}</span>{task.priority_reasons?.[0] && <small>{t(`smart.reason.${task.priority_reasons[0]}`)}</small>}{task.start_url && <Link className="btn btn-soft" to={task.start_url}>{t("plan.start")}</Link>}</>;
  return <div className="plan-exam-result">
    <dl className="plan-exam-totals"><div><dt>{t("connected.required")}</dt><dd>{t("studyPlan.minutesValue", { count: preview.required_reading_minutes + (preview.required_review_minutes || 0) + (preview.required_active_study_minutes || 0) })}</dd></div><div><dt>{t("connected.scheduled")}</dt><dd>{t("studyPlan.minutesValue", { count: preview.scheduled_reading_minutes + (preview.scheduled_review_minutes || 0) + (preview.scheduled_active_study_minutes || 0) })}</dd></div><div><dt>{t("plan.examUnplaced")}</dt><dd>{preview.unscheduled.length}</dd></div></dl>
    {preview.habit && <section className="plan-habit-assessment" aria-label={t("smart.habitTitle")}>
      <strong>{t("smart.habitSnapshot")}</strong>
      <p>{preview.habit.baseline_minutes !== null ? t("smart.habitCurrent", { minutes: preview.habit.baseline_minutes }) : t("smart.habitUnknown")}</p>
      <p>{t("smart.habitSource." + preview.habit.source)}</p>
      <p>{t("smart.habitToday", { minutes: preview.habit.target_today_minutes })}</p>
      {preview.habit.required_daily_minutes !== null && <p>{t("smart.habitRequired", { minutes: preview.habit.required_daily_minutes })}</p>}
      <p className="plan-note">{t("smart.habitCaveat")}</p>
    </section>}
    {!!preview.existing_activity_count && <p className="plan-note">{t("connected.alreadyPlanned", { count: preview.existing_activity_count })}</p>}
    {!!unplaced && <p className="plan-capacity-warning" role="status">{t("connected.shortfall", { minutes: unplaced })}</p>}
    {!!preview.issues.length && <div className="plan-exam-warning" role="status"><strong>{t("plan.examIncomplete")}</strong><ul>{preview.issues.map((issue, index) => <li key={index}><bdi>{issue.title}</bdi> · {t(issue.reason === "active_study_unavailable" ? "smart.activeUnavailable" : issue.reason === "existing_task_needs_rescheduling" ? "connected.reschedule" : issue.reason === "page_count_unknown" ? "plan.examPagesUnknown" : issue.reason === "partial_reading_needs_confirmation" ? "plan.examPartial" : "plan.examEditionMissing")} {issue.reason === "partial_reading_needs_confirmation" && issue.version_id && <button className="btn btn-soft" type="button" onClick={() => setConfirming(issue)}>{t("smart.confirmPages")}</button>}</li>)}</ul></div>}
    {confirming && <ReadingProgress userId={userId} issue={confirming} periodId={periodId} onCancel={() => setConfirming(null)} onSaved={async result => { setConfirming(null); await onProgress?.(result); }} />}
    {!!preview.replace_item_ids?.length && <p>{t("smart.replacing", { count: preview.replace_item_ids.length })}</p>}
    {preview.review_truncated && <p role="alert">{t("connected.limit")}</p>}
    <div className="plan-preview-filters" role="group" aria-label={t("connected.view")}>
      {["today", "week", "all"].map(value => <button className="btn btn-soft" key={value} type="button" aria-pressed={window === value} onClick={() => { setWindow(value); setLimit(20); }}>{t(`connected.${value}`)}</button>)}
    </div>
    <div className="plan-preview-days">{[...groups].map(([day, rows]) => <section key={day}><h3>{dateLabel(day)}</h3><ol className="plan-exam-task-list">{rows.map(task => <li key={task.key}>{content(task)}</li>)}</ol></section>)}</div>
    {!tasks.length && <p>{t("plan.examNoTasks")}</p>}
    {tasks.length > limit && <button className="btn btn-soft" type="button" onClick={() => setLimit(limit + 20)}>{t("connected.more", { count: tasks.length - limit })}</button>}
    {!!preview.unscheduled.length && <details className="plan-exam-unplaced"><summary>{t("plan.examUnplacedDetails", { count: preview.unscheduled.length })}</summary><ul>{preview.unscheduled.slice(0, limit).map(task => <li key={task.key}><strong dir="auto">{task.title}</strong><span>{task.activity === "review" ? t("connected.reviewTask") : task.activity === "active_study" ? t("smart.activeRange", { first: task.page_start, last: task.page_end }) : t("plan.examPageRange", { first: task.page_start, last: task.page_end })}</span><p>{t(task.reason === "deadline_before_horizon" ? "plan.examDeadlinePassed" : task.reason === "outside_horizon" ? "plan.examOutside" : "plan.examNoSlot")}</p></li>)}</ul></details>}
    <details><summary>{t("connected.estimates")}</summary><p>{t("connected.scope")}</p><p>{t("plan.examEstimate", { minutes: preview.estimate.minutes_per_page })}</p>{preview.subject_estimates && <ul>{Object.entries(preview.subject_estimates).map(([id, value]) => <li key={id}><bdi>{value.subject_title}</bdi> · {t("smart.estimate", { rate: value.minutes_per_page, count: value.sample_count })}</li>)}</ul>}<p>{t("plan.examNotFeasibility")}</p></details>
  </div>;
}
