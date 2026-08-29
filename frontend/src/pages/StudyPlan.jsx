import { useCallback, useEffect, useMemo, useState } from "react";
import { studyPlanApi } from "../api/studyPlan.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatDate } from "../lib/i18n.js";
import { useI18n } from "../components/I18nProvider.jsx";
import "./study-plan.css";

function dateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromStamp(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeek(value = new Date()) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// Dates follow the interface language, not the browser's own locale.
function readableDate(value, options = {}) {
  return formatDate(fromStamp(value), options);
}

function initialForm() {
  return { title: "", subject: "", scheduledDate: dateStamp(new Date()), durationMinutes: "25" };
}

export default function StudyPlan() {
  const { t } = useI18n();
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [busyItemId, setBusyItemId] = useState("");
  const [formError, setFormError] = useState("");

  const range = useMemo(() => ({
    from: dateStamp(weekStart),
    to: dateStamp(addDays(weekStart, 6))
  }), [weekStart]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setPlan(await studyPlanApi.getPlan(range));
    } catch (nextError) {
      setError(nextError);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const groupedItems = useMemo(() => {
    const groups = new Map();
    for (let offset = 0; offset < 7; offset += 1) {
      const stamp = dateStamp(addDays(weekStart, offset));
      groups.set(stamp, []);
    }
    for (const item of plan?.results || []) {
      if (groups.has(item.scheduled_date)) groups.get(item.scheduled_date).push(item);
    }
    return [...groups.entries()];
  }, [plan, weekStart]);

  async function submitTask(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      setFormError(t("studyPlan.titleRequired"));
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await studyPlanApi.createItem({
        ...form,
        title: form.title.trim(),
        subject: form.subject.trim(),
        durationMinutes: Number(form.durationMinutes)
      });
      setForm((current) => ({ ...initialForm(), scheduledDate: current.scheduledDate }));
      await load({ silent: true });
    } catch (nextError) {
      setFormError(nextError?.message || t("studyPlan.addError"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(item) {
    setBusyItemId(item.id);
    setFormError("");
    try {
      await studyPlanApi.updateItem(item.id, { status: item.status === "completed" ? "planned" : "completed" });
      await load({ silent: true });
    } catch (nextError) {
      setFormError(nextError?.message || t("studyPlan.updateError"));
    } finally {
      setBusyItemId("");
    }
  }

  async function deleteTask(item) {
    if (!window.confirm(t("studyPlan.deleteConfirm", { name: item.title }))) return;
    setBusyItemId(item.id);
    setFormError("");
    try {
      await studyPlanApi.deleteItem(item.id);
      await load({ silent: true });
    } catch (nextError) {
      setFormError(nextError?.message || t("studyPlan.deleteError"));
    } finally {
      setBusyItemId("");
    }
  }

  const summary = plan?.summary || {};
  const plannedCount = summary.planned_count ?? 0;
  const isCurrentWeek = range.from === dateStamp(startOfWeek());
  return (
    <Page title="Study Plan" showHeading={false} headingHandled>
      <section className="study-plan-summary" aria-label={t("studyPlan.summaryLabel")}>
        <SummaryCard icon="calendar" label={t("studyPlan.thisWeek")} value={t("studyPlan.taskCount", { count: plannedCount })} />
        <SummaryCard icon="clock" label={t("studyPlan.planned")} value={t("studyPlan.minutesValue", { count: summary.planned_minutes ?? 0 })} />
        <SummaryCard icon="check" label={t("studyPlan.completed")} value={t("studyPlan.completedOf", { done: summary.completed_count ?? 0, total: plannedCount })} />
        <SummaryCard icon="target" label={t("studyPlan.today")} value={t("studyPlan.minutesValue", { count: summary.today_minutes ?? 0 })} />
      </section>

      <section className="study-plan-grid">
        <article className="panel study-plan-composer">
          <div className="panel-title"><div><p className="eyebrow">{t("studyPlan.addBlock")}</p><h2>{t("studyPlan.planSession")}</h2></div><span><Icon name="plus" size={16} /></span></div>
          <form onSubmit={submitTask}>
            <label className="study-plan-field study-plan-field--wide">{t("studyPlan.taskTitle")}<input autoComplete="off" maxLength={180} placeholder={t("studyPlan.taskPlaceholder")} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
            <label className="study-plan-field">{t("studyPlan.subject")} <span>{t("studyPlan.optional")}</span><input autoComplete="off" maxLength={120} placeholder={t("studyPlan.subjectPlaceholder")} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label>
            <label className="study-plan-field">{t("studyPlan.date")}<input type="date" value={form.scheduledDate} onChange={(event) => setForm({ ...form, scheduledDate: event.target.value })} /></label>
            <label className="study-plan-field">{t("studyPlan.minutesLabel")}<input type="number" min="5" max="480" step="5" inputMode="numeric" value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label>
            {formError && <p className="study-plan-form-error" role="alert" dir="auto">{formError}</p>}
            <button className="btn btn-primary study-plan-submit" type="submit" disabled={saving}>{saving ? t("studyPlan.adding") : <><Icon name="plus" size={16} /> {t("studyPlan.addToPlan")}</>}</button>
          </form>
        </article>

        <section className="study-plan-week" aria-label={t("studyPlan.weekLabel")}>
          <header className="study-plan-weekbar">
            <div><p className="eyebrow">{t("studyPlan.weekOf")}</p><h2 dir="auto">{readableDate(range.from, { month: "long", day: "numeric" })} – {readableDate(range.to, { month: "short", day: "numeric" })}</h2></div>
            <div className="study-plan-week-actions">
              <button type="button" aria-label={t("studyPlan.previousWeek")} onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="chevron-left" size={18} /></button>
              {!isCurrentWeek && <button className="study-plan-today" type="button" onClick={() => setWeekStart(startOfWeek())}>{t("studyPlan.today")}</button>}
              <button type="button" aria-label={t("studyPlan.nextWeek")} onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="chevron-right" size={18} /></button>
            </div>
          </header>

          {loading ? <LoadingPanel variant="list" /> : error ? <ErrorPanel message={error} onRetry={load} /> : (
            <div className="study-plan-days">
              {groupedItems.map(([stamp, items]) => <DayGroup key={stamp} stamp={stamp} items={items} busyItemId={busyItemId} onToggle={toggleTask} onDelete={deleteTask} />)}
            </div>
          )}
        </section>
      </section>
    </Page>
  );
}

function SummaryCard({ icon, label, value }) {
  return <article className="study-plan-stat"><span><Icon name={icon} size={17} /></span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function DayGroup({ stamp, items, busyItemId, onToggle, onDelete }) {
  const { t } = useI18n();
  const today = stamp === dateStamp(new Date());
  return (
    <article className={`study-plan-day ${today ? "is-today" : ""}`}>
      <header><div><strong dir="auto">{readableDate(stamp, { weekday: "long" })}</strong><span dir="auto">{readableDate(stamp, { month: "short", day: "numeric" })}</span></div>{today && <em>{t("studyPlan.today")}</em>}</header>
      {items.length ? <div className="study-plan-task-list">{items.map((item) => {
        const complete = item.status === "completed";
        const busy = busyItemId === item.id;
        return <div className={`study-plan-task ${complete ? "is-complete" : ""}`} key={item.id}>
          <button className="study-plan-check" type="button" aria-label={t(complete ? "studyPlan.reopenNamed" : "studyPlan.completeNamed", { name: item.title })} aria-pressed={complete} disabled={busy} onClick={() => onToggle(item)}><Icon name={complete ? "check" : "circle"} size={18} /></button>
          <div className="study-plan-task-copy"><strong dir="auto">{item.title}</strong><span dir="auto">{item.subject || t("studyPlan.generalStudy")} · {t("studyPlan.minutesValue", { count: item.duration_minutes })}</span></div>
          <button className="study-plan-delete" type="button" aria-label={t("studyPlan.deleteNamed", { name: item.title })} disabled={busy} onClick={() => onDelete(item)}><Icon name="trash" size={16} /></button>
        </div>;
      })}</div> : <p className="study-plan-day-empty">{t("studyPlan.noTasks")}</p>}
    </article>
  );
}
