import { useRef, useState } from "react";
import { accountsApi } from "../../api/accounts.js";
import { normalizeAuthError } from "../../lib/authValidation.js";
import { AccountFieldErrors, AccountFormAlert, fieldErrorAttributes } from "../account/AccountFormErrors.jsx";
import { useI18n } from "../I18nProvider.jsx";

export default function EmailChangeSettings({ email }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage(""); setError(null);
    try {
      await accountsApi.requestEmailChange(form.email.trim(), form.password);
      setForm({ email: "", password: "" });
      setMessage(t("settings.emailChangeRequested"));
    } catch (failure) { setError(normalizeAuthError(failure, { t })); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="ui-group-block settings-v2-block" id="settings-email">
    <h3 className="ui-group-title">{t("settings.changeEmail")}</h3>
    <form className="ui-group settings-v2-form" onSubmit={submit}>
      <p className="settings-v2-note" dir="auto">{email}</p>
      <label className="field"><span>{t("settings.newEmail")}</span><input type="email" autoComplete="email" dir="ltr" required disabled={busy} value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} {...fieldErrorAttributes(error, "new_email", "settings-email-error")} /><AccountFieldErrors error={error} field="new_email" id="settings-email-error" /></label>
      <label className="field"><span>{t("settings.currentPassword")}</span><input type="password" autoComplete="current-password" required disabled={busy} value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} {...fieldErrorAttributes(error, "current_password", "settings-email-password-error")} /><AccountFieldErrors error={error} field="current_password" id="settings-email-password-error" /></label>
      <p className="settings-v2-note">{t("settings.emailChangeHint")}</p>
      <AccountFormAlert error={error} />
      {message && <p className="save-hint" role="status">{message}</p>}
      <div className="settings-v2-form-actions"><button className="btn btn-primary compact" type="submit" aria-busy={busy || undefined} disabled={busy || !form.email.trim() || !form.password || form.email.trim().toLowerCase() === email?.toLowerCase()}>{t(busy ? "settings.saving" : "settings.changeEmail")}</button></div>
    </form>
  </div>;
}
