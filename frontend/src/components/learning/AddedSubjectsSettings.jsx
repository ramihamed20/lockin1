import { useCallback, useEffect, useState } from "react";
import { catalogWorkspaceApi } from "../../api/catalogWorkspace.js";
import { ErrorPanel, LoadingPanel } from "../ui/index.jsx";
import { useI18n } from "../I18nProvider.jsx";
import { formatDate } from "../../lib/i18n.js";
import { clearCatalogMaterialsCache } from "../../hooks/useCatalogMaterials.js";

// The server decides; this only avoids asking on behalf of every other year.
export function canAddSubjects(user) {
  return user?.cohort?.code === "year-2" && String(user?.cohort?.program?.code || "").startsWith("dentistry");
}

/**
 * Settings → My subjects. Added First Year subjects are final; this is where a
 * Second Year student asks to swap one, and sees what became of the request.
 */
export default function AddedSubjectsSettings() {
  const { t } = useI18n();
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [remove, setRemove] = useState("");
  const [add, setAdd] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [payload, requests] = await Promise.all([
        catalogWorkspaceApi.addedSubjects(),
        catalogWorkspaceApi.subjectChangeRequests()
      ]);
      setState(payload);
      setHistory(requests.results || []);
      // An approved swap changes the directory; Materials must not show a cached one.
      clearCatalogMaterialsCache();
    } catch {
      setLoadError(t("subjects.loadFailed"));
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (sending || !remove || !add) return;
    setSending(true);
    setFormError("");
    try {
      setState(await catalogWorkspaceApi.requestSubjectChange({ remove, add, note: note.trim() }));
      setRemove("");
      setAdd("");
      setNote("");
      await load();
    } catch {
      setFormError(t("subjects.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <ErrorPanel message={loadError} onRetry={load} />;
  if (!state) return <LoadingPanel />;

  const added = state.available.filter((subject) => subject.added);
  const choices = state.available.filter((subject) => !subject.added);
  const pending = state.pending_request;
  const decided = history.filter((item) => item.status !== "pending");

  return (
    <section className="settings-v2-section added-subjects-settings" id="settings-subjects" aria-labelledby="settings-subjects-heading">
      <p className="muted" dir="auto">{t("subjects.subtitle", { limit: state.limit })}</p>

      <div className="ui-group-block settings-v2-block">
        <h3 className="ui-group-title">{t("subjects.addedTitle")}</h3>
        {added.length
          ? <ul className="ui-group">{added.map((subject) => <li key={subject.slug} className="ui-row"><span className="ui-row-body"><span dir="auto">{subject.title}</span></span></li>)}</ul>
          : <p className="muted" dir="auto">{t("subjects.noneAdded")}</p>}
      </div>

      {pending && (
        <div className="form-alert" role="status" dir="auto">
          {t("subjects.pending", { remove: pending.remove.title, add: pending.add.title })}
        </div>
      )}

      {!pending && added.length > 0 && choices.length > 0 && (
        <form className="panel feedback-form" onSubmit={submit}>
          <h3 className="ui-group-title">{t("subjects.requestTitle")}</h3>
          <label className="field">
            <span>{t("subjects.removeLabel")}</span>
            <select value={remove} onChange={(event) => setRemove(event.target.value)} required>
              <option value="">{t("subjects.choose")}</option>
              {added.map((subject) => <option key={subject.slug} value={subject.slug}>{subject.title}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t("subjects.addLabel")}</span>
            <select value={add} onChange={(event) => setAdd(event.target.value)} required>
              <option value="">{t("subjects.choose")}</option>
              {choices.map((subject) => <option key={subject.slug} value={subject.slug}>{subject.title}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t("subjects.noteLabel")}</span>
            <textarea dir="auto" rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {formError && <div className="form-alert error" role="alert">{formError}</div>}
          <button className="btn btn-primary" type="submit" disabled={sending || !remove || !add}>
            {sending ? t("subjects.sending") : t("subjects.send")}
          </button>
        </form>
      )}

      {decided.length > 0 && (
        <div className="ui-group-block settings-v2-block">
          <h3 className="ui-group-title">{t("subjects.historyTitle")}</h3>
          <ul className="ui-group">
            {decided.map((item) => (
              <li key={item.id} className="ui-row">
                <span className="ui-row-body">
                  <span dir="auto">{item.remove.title} → {item.add.title}</span>
                  <small dir="auto">{t(`subjects.status.${item.status}`)} · {formatDate(item.decided_at || item.created_at)}{item.admin_note ? ` · ${item.admin_note}` : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
