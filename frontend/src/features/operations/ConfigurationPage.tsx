import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import { useOperationsSession } from "./useOperationsSession";
import type { ConfigurationEntry } from "./types";

export function ConfigurationPage() {
  const { t } = useI18n();
  const session = useOperationsSession();
  const [entries, setEntries] = useState<ConfigurationEntry[] | null>(null);
  const [pendingKey, setPendingKey] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.configuration(controller.signal).then((response) => setEntries(response.results)).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);

  async function save(event: FormEvent<HTMLFormElement>, entry: ConfigurationEntry) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const raw = formValue(data, "value");
    const value = entry.value_type === "integer" ? Number(raw) : raw;
    setPendingKey(entry.key);
    setMessage("");
    try {
      const updated = await operationsApi.updateConfiguration(entry, value, formValue(data, "reason"));
      setEntries((current) => current?.map((item) => item.key === updated.key ? updated : item) ?? []);
      setMessage(t("configurationSaved"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPendingKey("");
    }
  }

  if (!entries && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  return (
    <div className="operations-page">
      <header className="operations-page-heading"><h2>{t("operationsConfiguration")}</h2><p>{t("configurationCopy")}</p></header>
      {failed ? <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert> : null}
      {entries?.length ? <div className="configuration-list">{entries.map((entry) => (
        <form key={`${entry.key}-${entry.version}`} onSubmit={(event) => void save(event, entry)}>
          <header><div><h3>{entry.name}</h3><p>{entry.description}</p></div><code>{entry.key}</code></header>
          <div className="configuration-fields">
            <label><span>{entry.name}</span><input name="value" type={entry.value_type === "integer" ? "number" : "text"} defaultValue={String(entry.value)} min={entry.minimum ?? undefined} max={entry.maximum ?? undefined} disabled={!session.capabilities.includes("configuration.manage")} required /></label>
            <label><span>{t("configurationReason")}</span><input name="reason" type="text" minLength={8} maxLength={500} disabled={!session.capabilities.includes("configuration.manage")} required /></label>
          </div>
          <dl><div><dt>{t("currentVersion")}</dt><dd>{entry.version}</dd></div><div><dt>{t("minimumValue")}</dt><dd>{entry.minimum ?? "—"}</dd></div><div><dt>{t("maximumValue")}</dt><dd>{entry.maximum ?? "—"}</dd></div></dl>
          {session.capabilities.includes("configuration.manage") ? <Button variant="secondary" type="submit" disabled={pendingKey === entry.key}>{t("saveConfiguration")}</Button> : null}
        </form>
      ))}</div> : entries ? <EmptyState title={t("noOperationalData")} /> : null}
      {message ? <p className={message === t("configurationSaved") ? "inline-success" : "inline-error"} role="status">{message}</p> : null}
    </div>
  );
}
