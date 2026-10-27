import { useCallback, useEffect, useState } from "react";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../I18nProvider.jsx";

export function TeamDiscussion({ teamId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await focusApi.getLockInTeamMessages(teamId);
      setMessages(Array.isArray(result.messages) ? result.messages : []); setError("");
    } catch (failure) { setError(failure.message || t("lockIn.reconnecting")); }
  }, [teamId, t]);
  useEffect(() => {
    if (!open) return undefined;
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => window.clearInterval(timer);
  }, [open, load]);
  async function send(event) {
    event.preventDefault(); if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    try { await focusApi.sendLockInTeamMessage(teamId, draft.trim()); setDraft(""); await load(); }
    catch (failure) { setError(failure.message || t("lockIn.updateFailed")); }
    finally { setBusy(false); }
  }
  return <details className="lm-discussion" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("lockIn.discussion")}</summary>
    {open && <div>
      <ol className="lm-messages">{messages.map((message) => <li key={message.id}>
        <strong dir="auto">{message.author_name}</strong><p dir="auto">{message.body}</p>
      </li>)}</ol>
      <form onSubmit={send}>
        <label className="visually-hidden" htmlFor="lm-message">{t("lockIn.message")}</label>
        <input id="lm-message" maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("lockIn.message")} autoComplete="off" />
        <button className="btn btn-soft compact" disabled={busy || !draft.trim()} type="submit">{t("lockIn.send")}</button>
      </form>
      {error && <p className="lm-error" role="alert">{error}</p>}
    </div>}
  </details>;
}
