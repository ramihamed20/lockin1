import { useCallback, useEffect, useId, useRef, useState } from "react";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../I18nProvider.jsx";

export function TeamDiscussion({ teamId, expanded = false }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(expanded);
  const inputId = useId();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);
  const listRef = useRef(null);
  const followRef = useRef(true);
  useEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);
  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const result = await focusApi.getLockInTeamMessages(teamId);
      if (request !== requestRef.current) return;
      setMessages(Array.isArray(result.messages) ? result.messages : []); setError("");
    } catch (failure) { if (request === requestRef.current) setError(failure.message || t("lockIn.reconnecting")); }
  }, [teamId, t]);
  useEffect(() => {
    if (!open) return undefined;
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { requestRef.current += 1; window.clearInterval(timer); };
  }, [open, load]);
  async function send(event) {
    event.preventDefault(); if (!draft.trim() || busy) return;
    setBusy(true); setError("");
    const sent = draft;
    try { await focusApi.sendLockInTeamMessage(teamId, sent.trim()); setDraft((current) => current === sent ? "" : current); followRef.current = true; await load(); }
    catch (failure) { setError(failure.message || t("lockIn.updateFailed")); }
    finally { setBusy(false); }
  }
  const content = <>
      {!messages.length && !error && <p className="lm-chat-empty">{t("lockIn.chatEmpty")}</p>}
      <ol ref={listRef} className="lm-messages" aria-live="polite" onScroll={(event) => { const list = event.currentTarget; followRef.current = list.scrollHeight - list.clientHeight - list.scrollTop < 48; }}>{messages.map((message) => <li key={message.id}>
        <strong dir="auto">{message.author_name}</strong><p dir="auto">{message.body}</p>
      </li>)}</ol>
      <form onSubmit={send}>
        <label className="visually-hidden" htmlFor={inputId}>{t("lockIn.message")}</label>
        <input id={inputId} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("lockIn.message")} autoComplete="off" />
        <button className="btn btn-soft compact" disabled={busy || !draft.trim()} type="submit">{t("lockIn.send")}</button>
      </form>
      {error && <p className="lm-error" role="alert">{error}</p>}
  </>;
  if (expanded) return <section className="lm-discussion is-expanded" aria-label={t("lockIn.discussion")}>
    <h2>{t("lockIn.discussion")}</h2>{content}
  </section>;
  return <details className="lm-discussion" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("lockIn.discussion")}</summary>{open && content}
  </details>;
}
