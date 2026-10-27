import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../lib/i18n.js";
import { addDays, fromStamp } from "./model.js";

const dateLabel = stamp => formatDate(fromStamp(stamp), { weekday: "long", day: "numeric", month: "short" });
export default function LearningPreview({ preview, t }) {
  const [window, setWindow] = useState("week");
  const [limit, setLimit] = useState(20);
  const today = preview.today || preview.assignments[0]?.scheduled_date;
  const end = today ? addDays(today, 6) : "";
  const tasks = preview.assignments.filter(task => window === "all" || window === "today" && task.scheduled_date === today || window === "week" && task.scheduled_date >= today && task.scheduled_date <= end);
  const groups = new Map();
  tasks.slice(0, limit).forEach(task => { const rows = groups.get(task.scheduled_date) || []; rows.push(task); groups.set(task.scheduled_date, rows); });
  const unplaced = preview.unscheduled.reduce((sum, task) => sum + task.estimated_minutes, 0);
  const content = task => <><strong dir="auto">{task.title}</strong><span>{task.activity === "review" ? t("connected.reviewTask") : t("plan.examPageRange", { first: task.page_start, last: task.page_end })} · {t("studyPlan.minutesValue", { count: task.estimated_minutes })}</span>{task.start_url && <Link className="btn btn-soft" to={task.start_url}>{t("plan.start")}</Link>}</>;
  return <div className="plan-exam-result">
    <dl className="plan-exam-totals"><div><dt>{t("connected.required")}</dt><dd>{t("studyPlan.minutesValue", { count: preview.required_reading_minutes + (preview.required_review_minutes || 0) })}</dd></div><div><dt>{t("connected.scheduled")}</dt><dd>{t("studyPlan.minutesValue", { count: preview.scheduled_reading_minutes + (preview.scheduled_review_minutes || 0) })}</dd></div><div><dt>{t("plan.examUnplaced")}</dt><dd>{preview.unscheduled.length}</dd></div></dl>
    {!!preview.existing_activity_count && <p className="plan-note">{t("connected.alreadyPlanned", { count: preview.existing_activity_count })}</p>}
    {!!unplaced && <p className="plan-capacity-warning" role="status">{t("connected.shortfall", { minutes: unplaced })}</p>}
    {!!preview.issues.length && <div className="plan-exam-warning" role="status"><strong>{t("plan.examIncomplete")}</strong><ul>{preview.issues.map((issue, index) => <li key={index}><bdi>{issue.title}</bdi> · {t(issue.reason === "existing_task_needs_rescheduling" ? "connected.reschedule" : issue.reason === "page_count_unknown" ? "plan.examPagesUnknown" : issue.reason === "partial_reading_needs_confirmation" ? "plan.examPartial" : "plan.examEditionMissing")}</li>)}</ul></div>}
    {preview.review_truncated && <p role="alert">{t("connected.limit")}</p>}
    <div className="plan-preview-filters" role="group" aria-label={t("connected.view")}>
      {["today", "week", "all"].map(value => <button className="btn btn-soft" key={value} type="button" aria-pressed={window === value} onClick={() => { setWindow(value); setLimit(20); }}>{t(`connected.${value}`)}</button>)}
    </div>
    <div className="plan-preview-days">{[...groups].map(([day, rows]) => <section key={day}><h3>{dateLabel(day)}</h3><ol className="plan-exam-task-list">{rows.map(task => <li key={task.key}>{content(task)}</li>)}</ol></section>)}</div>
    {!tasks.length && <p>{t("plan.examNoTasks")}</p>}
    {tasks.length > limit && <button className="btn btn-soft" type="button" onClick={() => setLimit(limit + 20)}>{t("connected.more", { count: tasks.length - limit })}</button>}
    {!!preview.unscheduled.length && <details className="plan-exam-unplaced"><summary>{t("plan.examUnplacedDetails", { count: preview.unscheduled.length })}</summary><ul>{preview.unscheduled.slice(0, limit).map(task => <li key={task.key}><strong dir="auto">{task.title}</strong><span>{task.activity === "review" ? t("connected.reviewTask") : t("plan.examPageRange", { first: task.page_start, last: task.page_end })}</span><p>{t(task.reason === "deadline_before_horizon" ? "plan.examDeadlinePassed" : task.reason === "outside_horizon" ? "plan.examOutside" : "plan.examNoSlot")}</p></li>)}</ul></details>}
    <details><summary>{t("connected.estimates")}</summary><p>{t("connected.scope")}</p><p>{t("plan.examEstimate", { minutes: preview.estimate.minutes_per_page })}</p><p>{t("plan.examNotFeasibility")}</p></details>
  </div>;
}
