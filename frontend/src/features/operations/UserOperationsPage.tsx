import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { formValue } from "../../components/formValue";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/catalogs";
import { operationsApi } from "./api";
import { useOperationsSession } from "./useOperationsSession";
import type { ActionPreview, OperationalUser } from "./types";

const operationalRoles: Array<{ code: string; label: MessageKey }> = [
  { code: "platform_administrator", label: "platformAdministrator" },
  { code: "support", label: "supportRole" },
  { code: "content_manager", label: "contentManagerRole" },
  { code: "moderator", label: "moderatorRole" },
  { code: "finance", label: "financeRole" },
  { code: "analytics_viewer", label: "analyticsViewerRole" }
];

export function UserOperationsPage() {
  const { t } = useI18n();
  const session = useOperationsSession();
  const [users, setUsers] = useState<OperationalUser[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.users(query.trim(), controller.signal).then((response) => setUsers(response.results)).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [query]);
  useEffect(() => load(), [load]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (users ?? []).filter((user) => !normalized || `${user.full_name} ${user.email}`.toLowerCase().includes(normalized));
  }, [query, users]);
  const selected = users?.find((user) => user.id === selectedId) ?? null;

  async function previewStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      setPreview(await operationsApi.previewUserStatus(
        selected.id,
        data.get("status") === "active" ? "active" : "suspended",
        formValue(data, "reason")
      ));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  async function confirmStatus() {
    if (!preview) return;
    setPending(true);
    setMessage("");
    try {
      await operationsApi.executeAction(preview);
      setPreview(null);
      setMessage(t("actionComplete"));
      load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const roles = operationalRoles.filter(({ code }) => data.get(code) === "on").map(({ code }) => code);
    setPending(true);
    setMessage("");
    try {
      const result = await operationsApi.updateRoles(selected.id, roles, formValue(data, "reason"));
      setUsers((current) => current?.map((user) => user.id === selected.id ? { ...user, operational_roles: result.roles } : user) ?? []);
      setMessage(t("rolesSaved"));
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : t("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (!users && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  if (failed) return <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert>;
  return (
    <div className="operations-page">
      <header className="operations-page-heading"><h2>{t("operationsUsers")}</h2><p>{t("userOperationsCopy")}</p></header>
      <label className="operations-search"><span>{t("searchUsers")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="operations-user-workspace">
        <ul className="operations-user-list">
          {visibleUsers.length ? visibleUsers.map((user) => (
            <li key={user.id}><button type="button" aria-pressed={selectedId === user.id} onClick={() => { setSelectedId(user.id); setPreview(null); setMessage(""); }}>
              <span className="avatar" aria-hidden="true">{user.full_name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{user.full_name}</strong><small>{user.email}</small></span>
              <span className={`status-badge status-badge--${user.status}`}>{user.status}</span>
            </button></li>
          )) : <EmptyState title={t("noMatchingUsers")} />}
        </ul>
        <aside className="operations-user-detail" aria-label={t("userDetails")} aria-live="polite">
          {selected ? <>
            <header><div><h3>{selected.full_name}</h3><p>{selected.email}</p></div><Button variant="quiet" onClick={() => setSelectedId(null)}>{t("closeDetails")}</Button></header>
            <dl className="operations-user-facts">
              <div><dt>{t("emailVerifiedLabel")}</dt><dd>{selected.email_verified ? t("verified") : t("notVerified")}</dd></div>
              <div><dt>{t("productRoles")}</dt><dd>{selected.product_roles.join(", ")}</dd></div>
              <div><dt>{t("operationalRoles")}</dt><dd>{selected.operational_roles.join(", ") || "—"}</dd></div>
            </dl>
            {session.capabilities.includes("operational_roles.manage") ? (
              <form key={`roles-${selected.id}`} className="operations-inline-form" onSubmit={(event) => void saveRoles(event)}>
                <fieldset><legend>{t("roleAssignment")}</legend>{operationalRoles.map((role) => (
                  <label className="check-control" key={role.code}><input type="checkbox" name={role.code} defaultChecked={selected.operational_roles.includes(role.code)} /><span>{t(role.label)}</span></label>
                ))}</fieldset>
                <label><span>{t("rolesReason")}</span><textarea name="reason" required minLength={8} maxLength={500} rows={2} /></label>
                <Button type="submit" variant="secondary" disabled={pending}>{t("saveOperationalRoles")}</Button>
              </form>
            ) : null}
            {session.capabilities.includes("users.manage") && session.capabilities.includes("operational_actions.execute") ? (
              <form key={`status-${selected.id}`} className="operations-inline-form" onSubmit={(event) => void previewStatus(event)}>
                <fieldset><legend>{t("changeAccountStatus")}</legend>
                  <label className="choice-row"><input type="radio" name="status" value="active" defaultChecked={selected.status !== "active"} /><span>{t("activateAccount")}</span></label>
                  <label className="choice-row"><input type="radio" name="status" value="suspended" defaultChecked={selected.status === "active"} /><span>{t("suspendAccount")}</span></label>
                </fieldset>
                <label><span>{t("actionReason")}</span><small>{t("actionReasonHint")}</small><textarea name="reason" required minLength={8} maxLength={500} rows={3} /></label>
                <Button type="submit" variant="secondary" disabled={pending}>{t("previewAction")}</Button>
              </form>
            ) : null}
            {preview ? (
              <section className="operations-confirmation" aria-labelledby="action-preview-title">
                <h4 id="action-preview-title">{t("actionPreviewTitle")}</h4>
                {preview.preview.changes.map((change) => <p key={change.user_id}><strong>{change.full_name}</strong> · {change.from_status} → {change.to_status}</p>)}
                <div><Button variant="danger" disabled={pending} onClick={() => void confirmStatus()}>{t("confirmAction")}</Button><Button variant="quiet" disabled={pending} onClick={() => setPreview(null)}>{t("cancelPreview")}</Button></div>
              </section>
            ) : null}
            {message ? <p className={message === t("actionComplete") || message === t("rolesSaved") ? "inline-success" : "inline-error"} role="status">{message}</p> : null}
          </> : <EmptyState title={t("operationsUsers")}>{t("userOperationsCopy")}</EmptyState>}
        </aside>
      </div>
    </div>
  );
}
