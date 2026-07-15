import { useCallback, useEffect, useState, type FormEvent } from "react";

import { apiRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { FormField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";

type AccountSession = {
  id: string;
  device_label: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  is_current: boolean;
};

export function SecurityPage() {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [notice, setNotice] = useState<"password" | "email" | "error" | null>(null);
  const [pending, setPending] = useState(false);
  const loadSessions = useCallback(() => {
    void apiRequest<{ sessions: AccountSession[] }>("/account/sessions")
      .then((response) => setSessions(response.sessions))
      .catch(() => setNotice("error"));
  }, []);

  useEffect(loadSessions, [loadSessions]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await apiRequest("/account/password", {
        method: "POST",
        body: {
          current_password: formValue(data, "current_password"),
          new_password: formValue(data, "new_password"),
          new_password_confirm: formValue(data, "new_password_confirm")
        }
      });
      form.reset();
      setNotice("password");
      loadSessions();
    } catch {
      setNotice("error");
    } finally {
      setPending(false);
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await apiRequest("/account/email", {
        method: "POST",
        body: {
          new_email: formValue(data, "new_email"),
          current_password: formValue(data, "email_current_password")
        }
      });
      form.reset();
      setNotice("email");
    } catch {
      setNotice("error");
    } finally {
      setPending(false);
    }
  }

  async function revoke(session: AccountSession) {
    try {
      await apiRequest(`/account/sessions/${session.id}`, { method: "DELETE" });
      if (session.is_current) window.location.assign("/login");
      else setSessions((current) => current?.filter((item) => item.id !== session.id) ?? []);
    } catch {
      setNotice("error");
    }
  }

  return (
    <div className="page page--narrow">
      <header className="page-heading"><p className="eyebrow">Lock-in ID</p><h1>{t("securityTitle")}</h1><p>{t("securityCopy")}</p></header>
      {notice ? <Alert tone={notice === "error" ? "error" : "success"}>{notice === "password" ? t("passwordChanged") : notice === "email" ? t("emailChangeSent") : t("genericError")}</Alert> : null}
      <section className="settings-section" aria-labelledby="password-title">
        <h2 id="password-title">{t("changePassword")}</h2>
        <form className="settings-form" onSubmit={(event) => void changePassword(event)}>
          <FormField label={t("currentPassword")} name="current_password" type="password" autoComplete="current-password" required />
          <FormField label={t("newPassword")} name="new_password" type="password" autoComplete="new-password" minLength={10} required />
          <FormField label={t("confirmPassword")} name="new_password_confirm" type="password" autoComplete="new-password" minLength={10} required />
          <Button disabled={pending} type="submit">{pending ? t("saving") : t("changePassword")}</Button>
        </form>
      </section>
      <section className="settings-section" aria-labelledby="email-title">
        <h2 id="email-title">{t("changeEmail")}</h2>
        <form className="settings-form" onSubmit={(event) => void changeEmail(event)}>
          <FormField label={t("newEmail")} name="new_email" type="email" autoComplete="email" required />
          <FormField label={t("currentPassword")} name="email_current_password" type="password" autoComplete="current-password" required />
          <Button disabled={pending} type="submit">{pending ? t("saving") : t("changeEmail")}</Button>
        </form>
      </section>
      <section className="settings-section" aria-labelledby="sessions-title">
        <h2 id="sessions-title">{t("sessionsTitle")}</h2>
        {!sessions ? <PageSkeleton label={t("loading")} /> : sessions.length === 0 ? <EmptyState title={t("noSessions")} /> : (
          <ul className="session-list">{sessions.map((session) => (
            <li key={session.id}>
              <div><strong>{session.device_label}</strong><span>{session.is_current ? t("currentSession") : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.last_seen_at))}</span></div>
              <Button variant="quiet" onClick={() => void revoke(session)}>{t("revoke")}</Button>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
