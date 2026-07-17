import { useState, type FormEvent } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { Alert } from "../../../components/Feedback";
import { FormField } from "../../../components/FormField";
import { formValue } from "../../../components/formValue";
import { useI18n } from "../../../i18n/I18nProvider";
import { createDiscussion } from "../api";
import type { Discussion, LearningContextType } from "../types";

export function DiscussionComposer({
  contextType,
  contextId,
  spaceId,
  onCreated
}: {
  contextType: LearningContextType;
  contextId: string;
  spaceId?: string;
  onCreated: (discussion: Discussion) => void;
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
      const created = await createDiscussion({
        context_type: contextType,
        context_id: contextId,
        ...(spaceId ? { space_id: spaceId } : {}),
        title: formValue(data, "title"),
        body: formValue(data, "body")
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

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{t("communityAskQuestion")}</Button>;
  }

  return (
    <form className="community-composer" onSubmit={(event) => void submit(event)}>
      <header>
        <div><p className="eyebrow">{t("communityContextOnly")}</p><h2>{t("communityStartDiscussion")}</h2></div>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>{t("cancelEditing")}</Button>
      </header>
      {error ? <Alert>{error}</Alert> : null}
      <FormField name="title" label={t("communityDiscussionTitle")} required minLength={8} maxLength={220} />
      <div className="field">
        <label htmlFor="community-discussion-body">{t("communityDiscussionBody")}</label>
        <textarea id="community-discussion-body" name="body" required minLength={20} maxLength={10000} rows={6} />
        <small>{t("communityDiscussionHint")}</small>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("communityPublishQuestion")}</Button>
    </form>
  );
}
