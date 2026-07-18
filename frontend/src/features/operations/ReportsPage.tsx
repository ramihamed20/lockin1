import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import type { ReportDefinition, ReportPreview } from "./types";

export function ReportsPage() {
  const { t } = useI18n();
  const [reports, setReports] = useState<ReportDefinition[] | null>(null);
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.reports(controller.signal).then((response) => setReports(response.results)).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);

  async function createPreview(reportCode: string) {
    setPending(true);
    setMessage("");
    try {
      setPreview(await operationsApi.previewReport(reportCode));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  async function download() {
    if (!preview) return;
    setPending(true);
    setMessage("");
    try {
      const result = await operationsApi.executeReport(preview);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      setPreview(null);
      setMessage(t("reportDownloaded"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (!reports && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  return (
    <div className="operations-page">
      <header className="operations-page-heading"><h2>{t("operationsReports")}</h2><p>{t("reportsCopy")}</p></header>
      {failed ? <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert> : null}
      {reports?.length ? <ul className="report-definition-list">{reports.map((report) => (
        <li key={report.code}><div><h3>{report.name}</h3><p>{report.description}</p>{report.schedule_ready ? <small>{t("scheduleReady")}</small> : null}</div><Button variant="secondary" disabled={pending} onClick={() => void createPreview(report.code)}>{t("previewReport")}</Button></li>
      ))}</ul> : reports ? <EmptyState title={t("noOperationalData")} /> : null}
      {preview ? (
        <section className="operations-confirmation report-confirmation" aria-labelledby="report-preview-title">
          <h3 id="report-preview-title">{t("reportPreviewTitle")}</h3>
          <p><strong>{preview.report_code.replaceAll("_", " ")}</strong></p>
          <dl><div><dt>{t("estimatedRows")}</dt><dd>{preview.estimated_rows}</dd></div><div><dt>{t("currentVersion")}</dt><dd>{preview.status}</dd></div></dl>
          {preview.truncated ? <p className="muted-copy">{t("reportTruncated")}</p> : null}
          <div><Button disabled={pending} onClick={() => void download()}>{t("generateCsv")}</Button><Button variant="quiet" disabled={pending} onClick={() => setPreview(null)}>{t("cancelPreview")}</Button></div>
        </section>
      ) : null}
      {message ? <p className={message === t("reportDownloaded") ? "inline-success" : "inline-error"} role="status">{message}</p> : null}
    </div>
  );
}
