import { useState, type FormEvent } from "react";

import { apiRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { FormField, SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { useAuth } from "../auth/AuthProvider";
import type { SessionResponse } from "../auth/types";

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const { t, setLocale } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<"success" | "error" | null>(null);

  if (!user) return <PageSkeleton label={t("loading")} />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await apiRequest<SessionResponse>("/account/profile", {
        method: "PATCH",
        body: {
          full_name: formValue(data, "full_name"),
          preferred_language: formValue(data, "preferred_language")
        }
      });
      updateUser(response.user);
      setLocale(response.user.preferred_language);
      setMessage("success");
    } catch {
      setMessage("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page page--narrow">
      <header className="page-heading"><p className="eyebrow">Lock-in ID</p><h1>{t("profileTitle")}</h1><p>{t("profileCopy")}</p></header>
      {message ? <Alert tone={message}>{message === "success" ? t("profileSaved") : t("genericError")}</Alert> : null}
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <FormField label={t("fullName")} name="full_name" autoComplete="name" defaultValue={user.full_name} required />
        <FormField label={t("email")} value={user.email} disabled readOnly />
        <SelectField label={t("preferredLanguage")} name="preferred_language" defaultValue={user.preferred_language}>
          <option value="en">{t("english")}</option><option value="ar">{t("arabic")}</option>
        </SelectField>
        <Button disabled={pending} type="submit">{pending ? t("saving") : t("saveChanges")}</Button>
      </form>
    </div>
  );
}
