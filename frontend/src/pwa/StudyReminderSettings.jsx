import { useEffect, useState } from "react";
import { motivationApi } from "../api/motivation.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useI18n } from "../components/I18nProvider.jsx";
import { ErrorPanel } from "../components/ui/index.jsx";

/** Scheduling is server-owned; enabling a browser's push permission is a separate action. */
export default function StudyReminderSettings({ userId }) {
  const { t, locale } = useI18n();
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const state = useAsyncData(() => motivationApi.studyReminder(), [userId]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (state.data) setDraft(state.data); }, [state.data]);
  async function save(event) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await motivationApi.saveStudyReminder({ enabled: draft.enabled, time: draft.time, timezone: draft.timezone, locale }, draft.revision);
      setDraft(saved);
      setMessage(t("reminder.saved"));
    } catch (failure) { setError(t(failure?.status === 409 ? "reminder.conflict" : "reminder.saveFailed")); }
    finally { setBusy(false); }
  }
  return <div className="ui-group-block settings-v2-block" id="settings-reminder">
    <h3 className="ui-group-title" id="settings-reminder-heading" tabIndex={-1}>{t("settings.studyReminder")}</h3>
    {state.loading && <p role="status">{t("common.loading")}</p>}
    {state.error && <ErrorPanel message={state.error} onRetry={state.reload} />}
    {draft && !state.error && <form className="ui-group settings-v2-form" onSubmit={save}>
      <label className="ui-row"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /><span>{t("settings.dailyStudyReminder")}</span></label>
      <label className="field"><span>{t("settings.reminderTime")}</span><input type="time" required value={draft.time} disabled={busy} onChange={event => setDraft({ ...draft, time: event.target.value })} /></label>
      <label className="field"><span>{t("reminder.timezone")}</span><select value={draft.timezone} disabled={busy} onChange={event => setDraft({ ...draft, timezone: event.target.value })}>{[...new Set(["Africa/Tripoli", deviceZone, draft.timezone])].filter(Boolean).map(zone => <option key={zone} value={zone}>{zone === "Africa/Tripoli" ? t("reminder.libyaTimezone") : t("reminder.deviceTimezone", { zone })}</option>)}</select></label>
      <div className="settings-v2-form-actions"><button type="submit" className="btn btn-primary compact" disabled={busy}>{t(busy ? "common.loading" : "common.save")}</button></div>
    </form>}
    <p className="ui-group-footer">{t("reminder.hint")}</p>
    {message && <p role="status">{message}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-soft compact" onClick={state.reload} disabled={busy}>{t("common.tryAgain")}</button></div>}
  </div>;
}
