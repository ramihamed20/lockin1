import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, MessageSquare, Send } from "lucide-react";
import { formatTime } from "../../lib/i18n.js";
import { focusApi } from "../../api/focus.js";
import { useI18n } from "../I18nProvider.jsx";

export function TeamDiscussion({ teamId, expanded = false, active = true }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(expanded);
  const inputId = useId();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);
  const listRef = useRef(null);
  const editorRef = useRef(null);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.style.height = "auto";
    editor.style.height = `${Math.min(120, editor.scrollHeight)}px`;
  }, [draft]);
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
      setMessages(Array.isArray(result.messages) ? result.messages : []); setError(""); setLoaded(true);
    } catch (failure) { if (request === requestRef.current) setError(failure.message || t("lockIn.reconnecting")); }
  }, [teamId, t]);
  useEffect(() => {
    if (!open || !active) return undefined;
    let alive = true;
    let timer;
    const poll = async () => {
      if (!document.hidden) await load();
      if (alive) timer = window.setTimeout(poll, 10000);
    };
    const recover = () => { if (!document.hidden) void load(); };
    void poll();
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      alive = false; requestRef.current += 1; window.clearTimeout(timer);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [open, load, active]);
  async function send(event) {
    event.preventDefault(); if (!draft.trim() || busy) return;
    setBusy(true); setSendError("");
    const sent = draft;
    try { await focusApi.sendLockInTeamMessage(teamId, sent.trim()); setDraft((current) => current === sent ? "" : current); followRef.current = true; await load(); }
    catch (failure) { setSendError(failure.message || t("lockIn.updateFailed")); }
    finally { setBusy(false); }
  }
  const content = <>
      {!loaded && !error && <div className="lm-chat-loading" role="status"><span className="visually-hidden">{t("common.loading")}</span><i /><i /><i /></div>}
      {loaded && !messages.length && !error && <div className="lm-chat-empty"><span className="lm-chat-empty-symbol" aria-hidden="true"><MessageSquare size={26} /></span><p>{t("lockIn.chatEmpty")}</p></div>}
      <ol ref={listRef} className="lm-messages" aria-live="polite" onScroll={(event) => { const list = event.currentTarget; followRef.current = list.scrollHeight - list.clientHeight - list.scrollTop < 48; }}>{messages.map((message) => <li key={message.id}>
        <div className="lm-message-meta"><span className="lm-chat-avatar" aria-hidden="true">{String(message.author_name || "?").slice(0, 1)}</span><strong dir="auto">{message.author_name}</strong>{message.created_at && <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>}</div><p dir="auto">{message.body}</p>
      </li>)}</ol>
      <form onSubmit={send}>
        <label className="visually-hidden" htmlFor={inputId}>{t("lockIn.message")}</label>
        <textarea ref={editorRef} id={inputId} rows={1} dir="auto" maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("lockIn.message")} autoComplete="off" enterKeyHint="send" onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.currentTarget.form?.requestSubmit();
          }
        }} />
        <button className="btn btn-primary lm-send" aria-label={t("lockIn.send")} disabled={busy || !draft.trim()} type="submit" aria-busy={busy}>{busy ? <LoaderCircle className="lm-spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}</button>
      </form>
      {error && <div className="lm-chat-error"><AlertCircle size={16} aria-hidden="true" /><p className="lm-error" role="alert">{error}</p><button className="btn btn-soft compact" type="button" onClick={() => void load()}>{t("common.tryAgain")}</button></div>}
      {sendError && <p className="lm-error" role="alert">{sendError}</p>}
  </>;
  if (expanded) return <section className="lm-discussion is-expanded" aria-label={t("lockIn.discussion")}>
    <h2 className="visually-hidden">{t("lockIn.discussion")}</h2>{content}
  </section>;
  return <details className="lm-discussion" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("lockIn.discussion")}</summary>{open && content}
  </details>;
}
