import { useCallback, useEffect, useState } from "react";
import { feedbackApi } from "../api/feedback.js";
import { ErrorPanel, LoadingPanel } from "../components/ui/index.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { formatDate } from "../lib/i18n.js";
import "./feedback.css";

export const FEEDBACK_CATEGORIES = ["feature", "improvement", "problem", "general"];
const MAX_LENGTH = 2000;

export default function FeedbackSettings() {
  const { t } = useI18n();
  const [category, setCategory] = useState("feature");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems((await feedbackApi.list()).results);
    } catch (error) {
      setLoadError(error);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setFormError("");
    setSent(false);
    try {
      await feedbackApi.submit({ category, message: message.trim() });
      setMessage("");
      setSent(true);
      await load();
    } catch (error) {
      setFormError(error?.status === 429 ? t("feedback.tooMany") : t("feedback.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  const tooShort = message.trim().length < 5;

  return (
    <section className="settings-v2-section feedback-section" id="settings-suggest" aria-labelledby="settings-suggest-heading">
      <p className="muted" dir="auto">{t("feedback.subtitle")}</p>
      <form className="panel feedback-form" onSubmit={submit}>
        <label className="field">
          <span>{t("feedback.category")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {FEEDBACK_CATEGORIES.map((value) => <option key={value} value={value}>{t(`feedback.category.${value}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("feedback.message")}</span>
          <textarea
            dir="auto"
            rows={5}
            maxLength={MAX_LENGTH}
            value={message}
            placeholder={t("feedback.placeholder")}
            onChange={(event) => { setMessage(event.target.value); setSent(false); }}
          />
          <small className="feedback-count">{message.length}/{MAX_LENGTH}</small>
        </label>
        {formError && <div className="form-alert error" role="alert">{formError}</div>}
        {sent && <div className="form-alert success" role="status">{t("feedback.thanks")}</div>}
        <button className="btn btn-primary" type="submit" disabled={sending || tooShort}>
          {sending ? t("feedback.sending") : t("feedback.send")}
        </button>
      </form>

      <section className="panel feedback-history" aria-labelledby="feedback-history-title">
        <h2 id="feedback-history-title">{t("feedback.yours")}</h2>
        {loadError ? <ErrorPanel message={t("feedback.loadFailed")} onRetry={load} />
          : items === null ? <LoadingPanel />
          : items.length === 0 ? <p className="muted">{t("feedback.empty")}</p>
          : <ul className="feedback-list">
            {items.map((item) => (
              <li key={item.id}>
                <p dir="auto">{item.message}</p>
                <small>
                  {t(`feedback.category.${item.category}`)} · {formatDate(new Date(item.created_at))} · <b>{t(`feedback.status.${item.status}`)}</b>
                </small>
              </li>
            ))}
          </ul>}
      </section>
    </section>
  );
}
