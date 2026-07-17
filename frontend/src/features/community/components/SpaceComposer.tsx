import { useState, type FormEvent } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { Alert } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { formValue } from "../../../components/formValue";
import { useI18n } from "../../../i18n/I18nProvider";
import { createSpace } from "../api";
import type { CommunitySpace } from "../types";

export function SpaceComposer({
  contextType,
  contextId,
  onCreated
}: {
  contextType: "lesson" | "learning_object";
  contextId: string;
  onCreated: (space: CommunitySpace) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError("");
    try {
      const created = await createSpace({
        context_type: contextType,
        context_id: contextId,
        title: formValue(data, "title"),
        description: formValue(data, "description")
      });
      form.reset();
      setOpen(false);
      onCreated(created);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return open ? (
    <form className="space-composer" onSubmit={(event) => void submit(event)}>
      <h3>{t("communityCreateSpace")}</h3>
      <p>{t("communityCreateSpaceCopy")}</p>
      {error ? <Alert>{error}</Alert> : null}
      <FormField name="title" label={t("communitySpaceName")} required minLength={4} maxLength={180} />
      <div className="field">
        <label htmlFor="community-space-description">{t("communitySpaceDescription")}</label>
        <textarea id="community-space-description" name="description" maxLength={4000} rows={3} />
      </div>
      <div className="form-actions">
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>{t("cancelEditing")}</Button>
        <Button type="submit" disabled={pending}>{pending ? t("saving") : t("communityCreateSpace")}</Button>
      </div>
    </form>
  ) : (
    <Button variant="secondary" onClick={() => setOpen(true)}>{t("communityCreatePrivateSpace")}</Button>
  );
}
