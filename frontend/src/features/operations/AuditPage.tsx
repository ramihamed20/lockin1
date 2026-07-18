import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import { formatDateTime } from "./format";
import type { AuditRecord } from "./types";

const domains = ["", "administration", "operational_actions", "reporting", "system_configuration"];

export function AuditPage() {
  const { t, locale } = useI18n();
  const [domain, setDomain] = useState("");
  const [records, setRecords] = useState<AuditRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.audit(domain, controller.signal).then((response) => setRecords(response.results)).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [domain]);
  useEffect(() => load(), [load]);
  return (
    <div className="operations-page">
      <header className="operations-page-heading"><h2>{t("operationsAudit")}</h2><p>{t("auditCopy")}</p></header>
      <label className="operations-filter"><span>{t("filterByDomain")}</span><select value={domain} onChange={(event) => { setFailed(false); setRecords(null); setDomain(event.target.value); }}>{domains.map((item) => <option key={item || "all"} value={item}>{item ? item.replaceAll("_", " ") : t("allDomains")}</option>)}</select></label>
      {failed ? <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert> : null}
      {!records && !failed ? <PageSkeleton label={t("operationsLoading")} /> : records?.length ? (
        <ol className="audit-timeline">
          {records.map((record) => (
            <li key={record.id}>
              <div className="audit-timeline__marker" aria-hidden="true" />
              <article>
                <header><div><strong>{record.action}</strong><span>{record.domain}</span></div><time dateTime={record.occurred_at}>{formatDateTime(record.occurred_at, locale)}</time></header>
                <p>{record.reason}</p>
                <dl><div><dt>{t("roleAdministrator")}</dt><dd>{record.actor_name}</dd></div><div><dt>Target</dt><dd>{record.target_type} · {record.target_id}</dd></div><div><dt>Source</dt><dd>{record.source}</dd></div></dl>
                <details><summary>{t("previousState")} / {t("newState")}</summary><div className="audit-state"><section><h4>{t("previousState")}</h4><pre>{JSON.stringify(record.previous_state, null, 2)}</pre></section><section><h4>{t("newState")}</h4><pre>{JSON.stringify(record.new_state, null, 2)}</pre></section></div></details>
              </article>
            </li>
          ))}
        </ol>
      ) : records ? <EmptyState title={t("noAuditRecords")} /> : null}
    </div>
  );
}
