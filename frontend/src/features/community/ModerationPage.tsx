import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { SelectField } from "../../components/FormField";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { moderationAudit, reports, transitionReport } from "./api";
import type { ModerationAudit, Report } from "./types";

function evidenceExcerpt(report: Report): string | null {
  const evidence = report.evidence_snapshot;
  if (!evidence) return null;
  for (const key of ["body", "prompt", "explanation", "summary", "title"]) {
    const value = evidence[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function ReportAction({ report, onUpdated }: { report: Report; onUpdated: (report: Report) => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"triaged" | "in_progress" | "resolved" | "rejected">("triaged");
  const closed = status === "resolved" || status === "rejected";
  const communityTarget = report.target_type === "discussion" || report.target_type === "comment";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const contentAction = formValue(data, "content_action");
      const updated = await transitionReport(report, {
        status,
        resolution_notes: formValue(data, "resolution_notes"),
        ...(contentAction ? { content_action: contentAction as "remove" | "restore" | "lock" | "unlock" } : {})
      });
      onUpdated(updated);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="moderation-action" onSubmit={(event) => void submit(event)}>
      {error ? <Alert>{error}</Alert> : null}
      <SelectField
        name="status"
        label={t("moderationDecision")}
        value={status}
        onChange={(event) => setStatus(event.target.value as typeof status)}
      >
        <option value="triaged">{t("moderationTriaged")}</option>
        <option value="in_progress">{t("moderationInProgress")}</option>
        <option value="resolved">{t("moderationResolved")}</option>
        <option value="rejected">{t("moderationRejected")}</option>
      </SelectField>
      {communityTarget ? (
        <SelectField name="content_action" label={t("moderationContentAction")} defaultValue="">
          <option value="">{t("moderationNoContentAction")}</option>
          <option value="remove">{t("moderationRemoveContent")}</option>
          {report.target_type === "discussion" ? <option value="lock">{t("moderationLockDiscussion")}</option> : null}
        </SelectField>
      ) : null}
      <div className="field">
        <label htmlFor={`resolution-${report.id}`}>{t("moderationNotes")}</label>
        <textarea
          id={`resolution-${report.id}`}
          name="resolution_notes"
          required={closed}
          minLength={closed ? 10 : undefined}
          maxLength={4000}
          rows={3}
        />
        <small>{closed ? t("moderationNotesRequired") : t("moderationNotesOptional")}</small>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t("saving") : t("moderationApplyDecision")}</Button>
    </form>
  );
}

export function ModerationPage() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<Report[]>([]);
  const [audit, setAudit] = useState<ModerationAudit[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [targetFilter, setTargetFilter] = useState("");
  const requestKey = `${statusFilter}:${targetFilter}`;
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void reports({ status: statusFilter, targetType: targetFilter }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setItems(page.results);
          setError("");
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof ApiError ? caught.message : t("moderationLoadError"));
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoadedKey(requestKey); });
    void moderationAudit(controller.signal)
      .then((page) => { if (!controller.signal.aborted) setAudit(page.results); })
      .catch(() => { if (!controller.signal.aborted) setAudit([]); });
    return () => controller.abort();
  }, [requestKey, statusFilter, targetFilter, t]);

  if (loadedKey !== requestKey) return <PageSkeleton label={t("moderationLoading")} />;

  return (
    <div className="page moderation-page">
      <header className="page-heading page-heading--wide">
        <p className="eyebrow">{t("moderationLearningQuality")}</p>
        <h1>{t("moderationTitle")}</h1>
        <p>{t("moderationCopy")}</p>
      </header>
      {error ? <Alert>{error}</Alert> : null}
      <div className="moderation-filters" aria-label={t("moderationFilters")}>
        <SelectField label={t("moderationStatus")} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="open">{t("moderationOpen")}</option>
          <option value="triaged">{t("moderationTriaged")}</option>
          <option value="in_progress">{t("moderationInProgress")}</option>
          <option value="resolved">{t("moderationResolved")}</option>
          <option value="rejected">{t("moderationRejected")}</option>
        </SelectField>
        <SelectField label={t("moderationTarget")} value={targetFilter} onChange={(event) => setTargetFilter(event.target.value)}>
          <option value="">{t("moderationAllTargets")}</option>
          <option value="discussion">{t("moderationDiscussion")}</option>
          <option value="comment">{t("moderationComment")}</option>
          <option value="question">{t("moderationQuestion")}</option>
          <option value="answer">{t("moderationAnswer")}</option>
          <option value="explanation">{t("moderationExplanation")}</option>
          <option value="learning_object">{t("moderationLearningObject")}</option>
        </SelectField>
      </div>

      <div className="moderation-layout">
        <section aria-labelledby="moderation-queue-title">
          <header className="study-section__heading"><h2 id="moderation-queue-title">{t("moderationQueue")}</h2><span>{items.length}</span></header>
          {items.length ? (
            <div className="moderation-list">
              {items.map((report) => {
                const excerpt = evidenceExcerpt(report);
                return (
                  <article className={`moderation-card moderation-card--${report.priority}`} key={report.id}>
                    <header>
                      <div><span className="resource-type">{report.target_type.replace("_", " ")}</span><h3>{report.target_label}</h3></div>
                      <span className="moderation-status">{report.status.replace("_", " ")}</span>
                    </header>
                    <dl>
                      <div><dt>{t("moderationReportedBy")}</dt><dd>{report.reporter_name}</dd></div>
                      <div><dt>{t("communityReportReason")}</dt><dd>{report.reason.replaceAll("_", " ")}</dd></div>
                      <div><dt>{t("moderationSubmitted")}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.created_at))}</dd></div>
                    </dl>
                    <p>{report.description}</p>
                    {excerpt ? <blockquote><span>{t("moderationEvidenceSnapshot")}</span>{excerpt}</blockquote> : null}
                    {report.can_manage && !["resolved", "rejected", "duplicate"].includes(report.status) ? (
                      <ReportAction report={report} onUpdated={(updated) => setItems((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))} />
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : <EmptyState title={t("moderationQueueClear")}>{t("moderationQueueClearCopy")}</EmptyState>}
        </section>
        <aside className="moderation-audit" aria-labelledby="moderation-audit-title">
          <p className="eyebrow">{t("moderationAccountability")}</p>
          <h2 id="moderation-audit-title">{t("moderationAudit")}</h2>
          <p>{t("moderationAuditCopy")}</p>
          {audit.length ? (
            <ol>
              {audit.slice(0, 12).map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.action.replaceAll("_", " ")}</strong>
                  <span>{entry.actor_name}</span>
                  <small>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(entry.created_at))}</small>
                </li>
              ))}
            </ol>
          ) : <p className="muted-copy">{t("moderationNoAudit")}</p>}
        </aside>
      </div>
    </div>
  );
}
