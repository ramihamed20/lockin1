import { useState, type FormEvent } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { Alert } from "../../../components/Feedback";
import { useI18n } from "../../../i18n/I18nProvider";
import { createComment } from "../api";
import type { Comment } from "../types";

export function CommentComposer({
  discussionId,
  parentId,
  onCreated,
  onCancel
}: {
  discussionId: string;
  parentId?: string;
  onCreated: (comment: Comment) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const created = await createComment(discussionId, body, parentId);
      setBody("");
      onCreated(created);
      onCancel?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="comment-composer" onSubmit={(event) => void submit(event)}>
      {error ? <Alert>{error}</Alert> : null}
      <div className="field">
        <label htmlFor={`comment-body-${parentId ?? "root"}`}>
          {parentId ? t("communityWriteReply") : t("communityAddToDiscussion")}
        </label>
        <textarea
          id={`comment-body-${parentId ?? "root"}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          minLength={3}
          maxLength={6000}
          rows={parentId ? 3 : 5}
        />
      </div>
      <div className="form-actions">
        {onCancel ? <Button type="button" variant="quiet" onClick={onCancel}>{t("cancelEditing")}</Button> : null}
        <Button type="submit" disabled={pending}>{pending ? t("saving") : t("communityPostReply")}</Button>
      </div>
    </form>
  );
}
