import { useState, type FormEvent } from "react";

import { ApiError } from "../../../api/client";
import { Button } from "../../../components/Button";
import { Alert } from "../../../components/Feedback";
import { SelectField } from "../../../components/FormField";
import { formValue } from "../../../components/formValue";
import { useI18n } from "../../../i18n/I18nProvider";
import { createReport } from "../api";
import type { Report, ReportReason } from "../types";

export function ReportComposer({
  targetType,
  targetId,
  compact = false
}: {
  targetType: Report["target_type"];
  targetId: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    setFailed(false);
    try {
      await createReport({
        target_type: targetType,
        target_id: targetId,
        reason: formValue(data, "reason") as ReportReason,
        description: formValue(data, "description")
      });
      setMessage(t("communityReportReceived"));
      setOpen(false);
    } catch (caught) {
      setFailed(true);
      setMessage(caught instanceof ApiError ? caught.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`report-composer${compact ? " report-composer--compact" : ""}`}>
      {message ? <Alert tone={failed ? "error" : "success"}>{message}</Alert> : null}
      {open ? (
        <form onSubmit={(event) => void submit(event)}>
          <SelectField name="reason" label={t("communityReportReason")} defaultValue="spam">
            <option value="spam">{t("communityReasonSpam")}</option>
            <option value="abuse">{t("communityReasonAbuse")}</option>
            <option value="duplicate">{t("communityReasonDuplicate")}</option>
            <option value="other">{t("report_other")}</option>
          </SelectField>
          <div className="field">
            <label htmlFor={`report-description-${targetId}`}>{t("reportDetails")}</label>
            <textarea id={`report-description-${targetId}`} name="description" required minLength={10} maxLength={4000} rows={3} />
          </div>
          <div className="form-actions">
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>{t("cancelEditing")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("saving") : t("sendReport")}</Button>
          </div>
        </form>
      ) : (
        <Button variant="quiet" onClick={() => setOpen(true)}>{t("communityReportContent")}</Button>
      )}
    </div>
  );
}
