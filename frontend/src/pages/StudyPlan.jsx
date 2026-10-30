import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { studyPlanApi } from "../api/studyPlan.js";
import { ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";
import { ConfirmDialog } from "../components/shared/ConfirmDialog.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { Icon } from "../lib/icons.jsx";
import { formatDate } from "../lib/i18n.js";
import { useCatalogMaterials } from "../hooks/useCatalogMaterials.js";
import ReadingProgress from "../studyPlan/ReadingProgress.jsx";
import DayCapacityEditor from "../studyPlan/DayCapacityEditor.jsx";
import PlanSettings from "../studyPlan/PlanSettings.jsx";
import ReadingPlanPanel from "../studyPlan/ReadingPlanPanel.jsx";
import TaskEditor from "../studyPlan/TaskEditor.jsx";
import { addDays, dateStamp, dayState, dayWorkload, fromStamp, materialFor, mergeSubjects, weekDays, weekOf, weekProgress } from "../studyPlan/model.js";

const displayDate = (stamp, options) => formatDate(fromStamp(stamp), options);
const DAY_MARK = { done: "✓", planned: "•" };

export default function StudyPlan({ user, examPeriods = null }) {
  const { t } = useI18n();
  const { materials } = useCatalogMaterials(user);
  const [start, setStart] = useState(() => weekOf());
  const [day, setDay] = useState(() => dateStamp());
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [settings, setSettings] = useState(false);
  const [initialMode, setInitialMode] = useState("");
  const [editor, setEditor] = useState(null);
  const [progressTask, setProgressTask] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const sequence = useRef(0);
  const initialized = useRef(false);
  const editorAnchor = useRef(null);
  const previewAnchor = useRef(null);
  const dayStrip = useRef(null);
  const configured = Boolean(plan?.profile?.configured);
  const load = useCallback(async (silent = false) => {
    const current = ++sequence.current;
    if (!silent) setLoading(true);
    try {
      const next = await studyPlanApi.getPlan({ from: start, to: addDays(start, 6), user });
      if (current !== sequence.current) return;
      setPlan(next); setError(null);
      if (!initialized.current) {
        initialized.current = true;
        setDay(next.today);
        setStart(weekOf(next.today));
      }
      return next;
    } catch (nextError) { if (current === sequence.current) setError(nextError); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [start, user]);
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);
  useEffect(() => { if (editor) editorAnchor.current?.querySelector("input")?.focus(); }, [editor]);
  useEffect(() => { if (preview) previewAnchor.current?.focus(); }, [preview]);
  useEffect(() => {
    const strip = dayStrip.current;
    if (!strip) return;
    const revealSelected = () => {
      const selected = strip.querySelector('[aria-pressed="true"]');
      if (!selected) return;
      const container = strip.getBoundingClientRect();
      const button = selected.getBoundingClientRect();
      // Scroll only the calendar, keeping the page's reading position intact.
      if (button.left < container.left || button.right > container.right) {
        strip.scrollLeft += button.left - container.left - (strip.clientWidth - button.width) / 2;
      }
    };
    revealSelected();
    const observer = new window.ResizeObserver(revealSelected);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [day, loading, settings, configured]);
  const fail = error => setActionError(error);
  async function action(key, work) {
    if (busy) return;
    setBusy(key); setMessage(""); setActionError(null);
    try { await work(); }
    catch (nextError) { fail(nextError); }
    finally { setBusy(""); }
  }
  async function refreshPlan() {
    const fresh = await load(true);
    if (!fresh) return;
    setPreview(null); setDeleting(null); setMessage(""); setActionError(null);
    setEditor(current => {
      if (!current?.item) return current;
      const latest = [...fresh.results, ...fresh.overdue].find(item => item.id === current.item.id);
      return latest ? { ...current, item: latest } : null;
    });
  }
  function changeWeek(next) { setStart(next); setDay(next === weekOf(plan.today) ? plan.today : next); setPreview(null); }
  const profile = plan?.profile;
  const today = plan?.today || dateStamp();
  const items = plan?.results || [];
  const title = item => item.generated && item.title === "Study session" ? t("plan.sessionTitle") : item.title;
  const next = items.find(item => item.status === "planned" && item.scheduled_date >= today);
  const canGenerate = !plan?.offline && profile?.configured && profile.mode !== "custom" && start >= weekOf(today);
  const nextMaterial = materialFor(next?.subject || next?.title, materials);
  const progress = weekProgress(plan?.summary);
  const workload = profile?.mode === "normal" ? plan?.day_loads?.[day] || dayWorkload(profile, items, day) : null;
  const subjectChoices = mergeSubjects(profile?.subjects || [], materials.map(material => material.title));
  const moveToToday = item => action(`move-${item.id}`, async () => {
    await studyPlanApi.updateItem(item.id, { scheduled_date: today, expected_revision: item.revision });
    setDay(today);
    if (start !== weekOf(today)) setStart(weekOf(today));
    else await load(true);
    setMessage("plan.moved");
  });
  async function previewWeek() {
    await action("preview", async () => { const result = await studyPlanApi.previewWeek(start); setPreview({ ...result, start }); });
  }
  function openEditor(item = null) { setEditor({ item, key: item?.id || globalThis.crypto.randomUUID() }); setPreview(null); }
  function tasks(values, { overdue = false } = {}) {
    return <ul className="plan-task-list">{[...values].sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed")).map(item => <li key={item.id} className={item.status === "completed" ? "is-complete" : ""}>
      <button className="plan-check" type="button" aria-pressed={item.status === "completed"} aria-label={t(item.status === "completed" ? "studyPlan.reopenNamed" : "studyPlan.completeNamed", { name: title(item) })} disabled={Boolean(busy) || plan.offline || item.scheduled_date > today} title={item.scheduled_date > today ? t("plan.future") : undefined} onClick={() => action(item.id, async () => {
        await studyPlanApi.updateItem(item.id, { status: item.status === "completed" ? "planned" : "completed", expected_revision: item.revision }); await load(true); setMessage("plan.saved");
      })}><Icon name={item.status === "completed" ? "check" : "circle"} size={21} /></button>
      <div><strong dir="auto">{title(item)}</strong>{item.activity === "active_study" && <small>{t("smart.activeRange", { first: item.page_start, last: item.page_end })}</small>}<small>{item.subject && item.subject !== item.title ? <><bdi>{item.subject}</bdi>{" · "}</> : ""}{t("studyPlan.minutesValue", { count: item.duration_minutes })}{item.scheduled_date !== day ? ` · ${displayDate(item.scheduled_date, { month: "short", day: "numeric" })}` : ""}</small>{item.start_url && item.status === "planned" && <Link className="plan-text-button" to={item.start_url}>{t("plan.start")}</Link>}{item.activity === "reading" && item.status === "planned" && item.scheduled_date <= today && item.period_id && <button type="button" className="plan-text-button" disabled={Boolean(busy)} onClick={() => setProgressTask(item)}>{t("smart.recordProgress")}</button>}{!plan.offline && item.planning_key && item.status === "planned" && <button type="button" className="plan-text-button" aria-pressed={Boolean(item.pinned)} disabled={Boolean(busy)} onClick={() => action(item.id, async () => { await studyPlanApi.updateItem(item.id, { pinned: !item.pinned, expected_revision: item.revision }); await load(true); })}>{t(item.pinned ? "smart.unpin" : "smart.pin")}</button>}{overdue && !plan.offline && <button type="button" className="plan-text-button plan-move" disabled={Boolean(busy)} onClick={() => moveToToday(item)}>{t("plan.moveToday")}</button>}</div>
      <button className="plan-edit" type="button" disabled={Boolean(busy) || plan.offline} aria-label={t("plan.editNamed", { title: title(item) })} onClick={() => openEditor(item)}><Icon name="pencil" size={18} /></button>
    </li>)}</ul>;
  }
  return <Page title="Study Plan" headingHandled>
    <div className="study-plan-v2">
      <header className="plan-heading"><div><p className="plan-date"><Icon name="calendar" size={16} />{displayDate(today, { weekday: "long", month: "long", day: "numeric" })}</p><h1>{t("nav.studyPlan")}</h1></div>{profile?.configured && <button className="btn btn-soft" type="button" disabled={Boolean(busy) || plan?.offline} onClick={() => { setSettings(!settings); setInitialMode(""); }}><Icon name={settings ? "x" : "settings"} size={17} />{t(settings ? "plan.backToPlan" : "plan.settings")}</button>}</header>
      {loading && !plan ? <LoadingPanel variant="list" /> : !plan && error ? <ErrorPanel message={error} onRetry={() => load()} /> : plan && <>
        {plan.offline && <p className="plan-notice" role="status">{t("smart.offlineSnapshot", { date: new Date(plan.saved_at).toLocaleString() })}</p>}
        {message && <div className={`plan-notice ${["plan.stale", "plan.invalid", "plan.saveFailed"].includes(message) ? "plan-error" : ""}`} role="status"><span>{t(message)}</span>{message === "plan.stale" && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => { void action("refresh", refreshPlan); }}>{t("plan.refresh")}</button>}</div>}
        {error && <ErrorPanel message={error} onRetry={() => load(true)} />}
        {actionError && <><ErrorPanel message={actionError} />{actionError.code === "plan_changed" && <button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => { void action("refresh", refreshPlan); }}>{t("plan.refresh")}</button>}</>}
        {(settings || !profile.configured) && <PlanSettings key={`${profile.configured}-${initialMode}`} profile={profile} materials={materials} initialMode={initialMode} busy={Boolean(busy)} onCancel={() => setSettings(false)} onSave={draft => action("profile", async () => {
          await studyPlanApi.saveProfile(draft, profile.revision); await load(true); setSettings(false); setPreview(null); setMessage("plan.saved");
        })} />}
        {profile.configured && !settings && <>
        {examPeriods && <ReadingPlanPanel userId={user.id} key={user.id} exams={examPeriods} profile={profile} disabled={Boolean(busy) && busy !== "exam-apply"} onApplying={value => setBusy(value ? "exam-apply" : "")} onApplied={async receipt => { setDay(receipt.first_date); if (weekOf(receipt.first_date) !== start) setStart(weekOf(receipt.first_date)); else await load(true); }} onRefresh={() => load(true)} onSetup={() => { setInitialMode("normal"); setSettings(true); }} />}
        <section className="plan-hero" aria-labelledby="plan-next-title">
          <div><div className="plan-hero-top"><span className="plan-book-mark" aria-hidden="true"><Icon name="book-open" size={25} /></span><span className="plan-mode-label">{t(`plan.${profile.mode}`)}</span></div><p className="plan-eyebrow">{t("plan.next")}</p><h2 id="plan-next-title" dir="auto">{next ? title(next) : t("plan.emptyTitle")}</h2><p className="plan-session-meta">{next ? <><Icon name="clock" size={16} />{t("studyPlan.minutesValue", { count: next.duration_minutes })}<span aria-hidden="true">·</span>{displayDate(next.scheduled_date, { weekday: "long", day: "numeric", month: "short" })}</> : t("plan.emptyHint")}</p>
          {profile.mode === "beginning" && <p>{t("plan.beginnerProgress", { days: plan.progress.completed_days, minutes: plan.progress.session_minutes })}</p>}
          {profile.mode === "beginning" && plan.progress.ready_for_normal && <p>{t("plan.ready")} <button type="button" className="plan-text-button" onClick={() => { setInitialMode("normal"); setSettings(true); }}>{t("plan.switch")}</button></p>}
          </div><div className="plan-actions">{next && <Link className="btn btn-primary plan-start-link" aria-label={next?.start_url ? t("plan.start") : nextMaterial ? t("plan.studySubject", { subject: nextMaterial.title }) : t("plan.openMaterials")} to={next?.start_url || (nextMaterial ? `/materials/catalog/${encodeURIComponent(nextMaterial.slug)}` : "/materials")}>{t("plan.start")}<Icon name="chevron-right" size={18} /></Link>}{canGenerate && <button type="button" className={`btn ${next ? "btn-soft" : "btn-primary"}`} disabled={Boolean(busy)} onClick={previewWeek}>{t("plan.preview")}</button>}<button type="button" className={`btn ${next || canGenerate ? "btn-soft" : "btn-primary"}`} disabled={Boolean(busy) || plan.offline} onClick={() => openEditor()}>{t("plan.add")}</button></div>
        </section>
        <div className="plan-stats" aria-label={t("studyPlan.summaryLabel")}>
          <div><span>{t("plan.completed")}</span><strong dir="ltr">{plan.summary.completed_count} / {plan.summary.planned_count}</strong></div><div><span>{t("plan.planned")}</span><strong>{t("studyPlan.minutesValue", { count: plan.summary.planned_minutes })}</strong></div><div><span>{t("plan.today")}</span><strong>{t("studyPlan.minutesValue", { count: plan.summary.today_minutes })}</strong></div>
          {progress.total > 0 && <div className="plan-progress"><div className="plan-progress-ring" aria-hidden="true"><svg viewBox="0 0 100 100"><circle className="plan-ring-track" cx="50" cy="50" r="42" /><circle className="plan-ring-value" cx="50" cy="50" r="42" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progress.percent} /></svg><strong dir="ltr">{Math.round(progress.percent)}<small>%</small></strong></div><div className="plan-progress-copy"><strong>{t("plan.week")}</strong><span>{t("plan.weekProgress", { done: progress.done, total: progress.total })}</span><progress max={100} value={progress.percent} aria-label={t("plan.weekProgress", { done: progress.done, total: progress.total })}>{progress.percent}%</progress></div></div>}
        </div>
        <section className="plan-week" aria-labelledby="plan-week-title">
          <header className="plan-week-heading"><div><h2 id="plan-week-title">{t("plan.week")}</h2><p>{displayDate(start, { month: "short", day: "numeric" })} – {displayDate(addDays(start, 6), { month: "short", day: "numeric" })}</p></div><div className="plan-actions"><button type="button" className="plan-icon-button" disabled={Boolean(busy)} aria-label={t("studyPlan.previousWeek")} onClick={() => changeWeek(addDays(start, -7))}><Icon name="chevron-left" size={20} /></button><button className="btn btn-soft" type="button" disabled={Boolean(busy)} onClick={() => changeWeek(weekOf(today))}>{t("plan.today")}</button><button type="button" className="plan-icon-button" disabled={Boolean(busy)} aria-label={t("studyPlan.nextWeek")} onClick={() => changeWeek(addDays(start, 7))}><Icon name="chevron-right" size={20} /></button></div></header>
          <div ref={dayStrip} className="plan-day-strip" role="group" aria-label={t("plan.weekDays")}>{weekDays(start).map(stamp => <button key={stamp} type="button" disabled={Boolean(busy)} aria-pressed={day === stamp} aria-label={`${displayDate(stamp, { dateStyle: "full" })}${dayState(items, stamp) === "done" ? ` · ${t("plan.dayAllDone")}` : ""}`} data-state={dayState(items, stamp)} onClick={() => setDay(stamp)}><small>{t(`plan.${["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(fromStamp(stamp).getDay() + 6) % 7]}`)}</small><strong>{fromStamp(stamp).getDate()}</strong><span aria-hidden="true">{DAY_MARK[dayState(items, stamp)] || " "}</span></button>)}</div>
          <div className="plan-day-heading"><h3>{displayDate(day, { weekday: "long", day: "numeric", month: "short" })}</h3><button type="button" className="plan-day-add" disabled={Boolean(busy)} aria-label={t("plan.addForDay")} onClick={() => openEditor()}><Icon name="plus" size={18} />{t("plan.add")}</button></div>
          {workload && !loading && <div className={`plan-day-workload${workload.overflow ? " is-over-budget" : ""}`} role="status">
            <strong>{t("plan.dayBudget", workload)}</strong>
            <p>{t(workload.overflow ? "plan.dayOverBudget" : "plan.dayRemaining", workload)}</p>
          </div>}
          {loading ? <LoadingPanel variant="list" /> : items.some(item => item.scheduled_date === day) ? tasks(items.filter(item => item.scheduled_date === day)) : <p className="plan-empty-day">{t("plan.emptyDay")}</p>}
        </section>
        {preview && <section className="plan-preview" aria-labelledby="plan-preview-title"><h2 id="plan-preview-title" ref={previewAnchor} tabIndex={-1}>{t("plan.previewTitle")}</h2><p>{t(preview.count ? "plan.previewHint" : "plan.previewEmpty", { count: preview.count, minutes: preview.minutes })}</p>
          <ul>{weekDays(preview.start).filter(stamp => preview.items.some(item => item.scheduled_date === stamp)).map(stamp => <li key={stamp}><strong>{displayDate(stamp, { weekday: "long", day: "numeric", month: "short" })}</strong><span>{preview.items.filter(item => item.scheduled_date === stamp).map(item => `${item.subject || t("plan.sessionTitle")} (${item.duration_minutes})`).join(" · ")}</span></li>)}</ul>
          <div className="plan-actions">{preview.count > 0 && <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => action("generate", async () => { await studyPlanApi.generateWeek(preview.start, preview.preview_token); setPreview(null); await load(true); setMessage("plan.added"); })}>{t("plan.generate")}</button>}<button type="button" className="btn btn-soft" disabled={Boolean(busy)} onClick={() => setPreview(null)}>{t("plan.cancel")}</button></div>
        </section>}
        {profile.mode === "normal" && <DayCapacityEditor key={`${day}:${profile.revision}`} day={day} profile={profile} disabled={Boolean(busy) || plan.offline} onSave={minutes => action("capacity", async () => { const { configured: ignored, revision, ...fields } = profile; void ignored; await studyPlanApi.saveProfile({ ...fields, date_minutes: { ...profile.date_minutes, [day]: minutes } }, revision); await load(true); })} />}
        {progressTask && <ReadingProgress key={progressTask.id} userId={user.id} task={progressTask} onCancel={() => setProgressTask(null)} onSaved={async result => { setProgressTask(null); setMessage(result.pending ? "smart.pending" : "smart.progressSaved"); if (!result.pending) await load(true); }} />}
        {editor && <div ref={editorAnchor}><TaskEditor key={editor.key} item={editor.item} day={day} subjects={subjectChoices} busy={Boolean(busy)} onCancel={() => setEditor(null)} onDelete={() => setDeleting(editor.item)} onSave={draft => action("save", async () => {
          if (editor.item) await studyPlanApi.updateItem(editor.item.id, { title: draft.title, subject: draft.subject, scheduled_date: draft.scheduledDate, duration_minutes: draft.durationMinutes, expected_revision: editor.item.revision });
          else await studyPlanApi.createItem({ ...draft, clientRequestId: editor.key });
          setEditor(null); await load(true); setMessage("plan.saved");
        })} /></div>}
        {plan.overdue_count > 0 && <details className="plan-overdue"><summary>{t("plan.overdue")} · {plan.overdue_count}</summary><p>{t("plan.overdueHint")}</p>{tasks(plan.overdue, { overdue: true })}</details>}
        <p className="plan-note">{t("connected.completionNote")}</p>
        <ConfirmDialog open={Boolean(deleting)} busy={Boolean(busy)} title={t("plan.deleteTitle")} message={deleting ? title(deleting) : ""} onCancel={() => setDeleting(null)} onConfirm={() => action("delete", async () => { await studyPlanApi.deleteItem(deleting.id, deleting.revision); setDeleting(null); setEditor(null); await load(true); setMessage("plan.saved"); })} />
        </>}
      </>}
    </div>
  </Page>;
}
