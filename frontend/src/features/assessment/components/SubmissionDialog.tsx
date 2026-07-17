import { useEffect } from "react";

import { Button } from "../../../components/Button";
import { useI18n } from "../../../i18n/I18nProvider";

export function SubmissionDialog({
  unanswered,
  pending,
  onCancel,
  onConfirm
}: {
  unanswered: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel, pending]);

  return (
    <div className="dialog-backdrop">
      <section className="submission-dialog" role="dialog" aria-modal="true" aria-labelledby="submit-title">
        <p className="eyebrow">{t("finalSubmission")}</p>
        <h2 id="submit-title">{t("submitAttemptTitle")}</h2>
        <p>{unanswered ? `${unanswered} ${t("unansweredWarning")}` : t("allAnswersReady")}</p>
        <p className="muted-copy">{t("submissionFinalCopy")}</p>
        <div className="form-actions">
          <Button autoFocus variant="secondary" onClick={onCancel} disabled={pending}>{t("keepReviewing")}</Button>
          <Button onClick={onConfirm} disabled={pending}>{pending ? t("submittingAttempt") : t("submitAttempt")}</Button>
        </div>
      </section>
    </div>
  );
}
