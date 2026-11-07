import { useEffect, useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel } from "../components/ui/index.jsx";
import { reminderDefaults, reminderRequest, reminderValidation } from "./studyReminder.js";
import "./StudyReminderSettings.css";

/** Account scheduling and OS push permission remain separate, explicit choices. */
export default function StudyReminderSettings({ userId }) {
  const { t, locale } = useI18n();
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const state = useAsyncData(() => motivationApi.studyReminder(), [userId]);
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (state.data) { setDraft({ ...reminderDefaults, ...state.data }); setSaved(state.data); }
  }, [state.data]);
  const days = Array.from({ length: 7 }, (_, index) => ({
    value: index,
    label: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 26 + index)))
  }));
  const set = (key, value) => { setDraft(current => ({ ...current, [key]: value })); setMessage(""); setError(""); };
  async function save(pauseHours) {
    if (!draft || busy) return;
    const invalid = reminderValidation(draft);
    if (invalid) { setError(t(invalid)); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await motivationApi.saveStudyReminder(reminderRequest(draft, locale, pauseHours), draft.revision);
      setDraft({ ...reminderDefaults, ...result }); setSaved(result);
      setMessage(t("reminder.saved"));
    } catch (failure) { setError(t(failure?.status === 409 ? "reminder.conflict" : "reminder.saveFailed")); }
    finally { setBusy(false); }
  }
  const paused = saved?.paused_until && Date.parse(saved.paused_until) > Date.now();
  const scheduleDate = value => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: saved.timezone }).format(new Date(value));
  const toggle = (key, label) => <label className="ui-row study-alert-toggle"><input type="checkbox" checked={draft[key]} onChange={event => set(key, event.target.checked)} /><span>{t(label)}</span></label>;
  return <div className="ui-group-block settings-v2-block" id="settings-reminder">
    <h3 className="ui-group-title" id="settings-reminder-heading" tabIndex={-1}>{t("reminder.title")}</h3>
    <p className="ui-group-footer">{t("reminder.intro")}</p>
    {state.loading && <p role="status">{t("common.loading")}</p>}
    {state.error && <ErrorPanel message={state.error} onRetry={state.reload} />}
    {draft && !state.error && <form className="ui-group settings-v2-form study-alert-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="study-alert-fields">
        <legend className="sr-only">{t("reminder.title")}</legend>
        {toggle("enabled", "reminder.enabled")}
        <fieldset className="study-alert-types">
          <legend>{t("reminder.types")}</legend>
          {toggle("study_enabled", "reminder.study")}
          {toggle("review_enabled", "reminder.review")}
          {toggle("weekly_enabled", "reminder.weekly")}
        </fieldset>
        {draft.weekly_enabled && <label className="field"><span>{t("reminder.weeklyDay")}</span><select value={draft.weekly_day} onChange={event => set("weekly_day", Number(event.target.value))}>{days.map(day => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>}
        <fieldset className="study-alert-days"><legend>{t("reminder.days")}</legend><div>{days.map(day => <button key={day.value} type="button" aria-pressed={draft.weekdays.includes(day.value)} onClick={() => set("weekdays", draft.weekdays.includes(day.value) ? draft.weekdays.filter(value => value !== day.value) : [...draft.weekdays, day.value].sort())}>{day.label}</button>)}</div></fieldset>
        <p className="ui-group-footer">{t("reminder.daysHint")}</p>
        <div className="study-alert-grid">
          <label className="field"><span>{t("settings.reminderTime")}</span><input type="time" required value={draft.time} onChange={event => set("time", event.target.value)} /></label>
          <label className="field"><span>{t("reminder.timezone")}</span><select value={draft.timezone} onChange={event => set("timezone", event.target.value)}>{[...new Set(["Africa/Tripoli", deviceZone, draft.timezone])].filter(Boolean).map(zone => <option key={zone} value={zone}>{zone === "Africa/Tripoli" ? t("reminder.libyaTimezone") : t("reminder.deviceTimezone", { zone })}</option>)}</select></label>
        </div>
        {toggle("skip_if_studied", "reminder.skipStudied")}
        {toggle("quiet_enabled", "reminder.quiet")}
        {draft.quiet_enabled && <div className="study-alert-grid">
          <label className="field"><span>{t("reminder.quietStart")}</span><input type="time" required value={draft.quiet_start} onChange={event => set("quiet_start", event.target.value)} /></label>
          <label className="field"><span>{t("reminder.quietEnd")}</span><input type="time" required value={draft.quiet_end} onChange={event => set("quiet_end", event.target.value)} /></label>
          <p className="ui-group-footer">{t("reminder.quietHint")}</p>
        </div>}
        {toggle("push_preview", "reminder.preview")}
        <div className="settings-v2-form-actions study-alert-actions"><button type="submit" className="btn btn-primary compact">{t(busy ? "common.loading" : "common.save")}</button>
          {draft.enabled && <button type="button" className="btn btn-soft compact" onClick={() => void save(paused ? 0 : 24)}>{t(paused ? "reminder.resume" : "reminder.pause")}</button>}
        </div>
      </fieldset>
      {saved?.enabled && (paused ? <p className="study-alert-schedule">{t("reminder.pausedUntil", { date: scheduleDate(saved.paused_until) })}</p> : saved.next_due_at && <p className="study-alert-schedule">{t("reminder.nextDue", { date: scheduleDate(saved.next_due_at) })}</p>)}
    </form>}
    <p className="ui-group-footer">{t("reminder.hint")}</p>
    {message && <p role="status">{message}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-soft compact" onClick={state.reload} disabled={busy}>{t("reminder.reload")}</button></div>}
  </div>;
}
