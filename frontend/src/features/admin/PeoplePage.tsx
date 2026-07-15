import { useCallback, useEffect, useState, type FormEvent } from "react";

import { apiRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, EmptyState, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/catalogs";
import type { Role, User } from "../auth/types";

type PaginatedUsers = { count: number; results: User[] };
type ManagedRole = Exclude<Role, "student">;
const editableRoles: ManagedRole[] = ["moderator", "creator", "administrator"];
const roleLabels: Record<ManagedRole, MessageKey> = {
  moderator: "roleModerator",
  creator: "roleCreator",
  administrator: "roleAdministrator"
};

function UserRoles({ user, onSaved }: { user: User; onSaved: (roles: Role[]) => void }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    const data = new FormData(event.currentTarget);
    const roles = editableRoles.filter((role) => data.get(role) === "on");
    try {
      const response = await apiRequest<{ roles: Role[] }>(`/admin/users/${user.id}/roles`, {
        method: "PATCH",
        body: { roles }
      });
      onSaved(response.roles);
      setResult("success");
    } catch {
      setResult("error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="role-form" onSubmit={(event) => void submit(event)}>
      <fieldset><legend>{t("roles")}</legend>
        {editableRoles.map((role) => <label className="check-control" key={role}><input type="checkbox" name={role} defaultChecked={user.roles.includes(role)} /><span>{t(roleLabels[role])}</span></label>)}
      </fieldset>
      <Button variant="secondary" disabled={pending} type="submit">{pending ? t("saving") : t("updateRoles")}</Button>
      {result ? <span className={result === "success" ? "inline-success" : "inline-error"} role="status">{result === "success" ? t("rolesSaved") : t("genericError")}</span> : null}
    </form>
  );
}

export function PeoplePage() {
  const { t } = useI18n();
  const [users, setUsers] = useState<User[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    void apiRequest<PaginatedUsers>("/admin/users")
      .then((response) => setUsers(response.results))
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    let active = true;
    void apiRequest<PaginatedUsers>("/admin/users")
      .then((response) => { if (active) setUsers(response.results); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  return (
    <div className="page">
      <header className="page-heading"><p className="eyebrow">Administration</p><h1>{t("peopleTitle")}</h1><p>{t("peopleCopy")}</p></header>
      {failed ? <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={load}>{t("retry")}</Button></Alert> : null}
      {!users && !failed ? <PageSkeleton label={t("loading")} /> : users?.length === 0 ? <EmptyState title={t("noPeople")} /> : (
        <ul className="people-list">{users?.map((user) => (
          <li key={user.id}>
            <header><span className="avatar" aria-hidden="true">{user.full_name.slice(0, 1).toUpperCase()}</span><div><h2>{user.full_name}</h2><p>{user.email}</p></div><span className={`status-badge status-badge--${user.status}`}>{user.status}</span></header>
            <UserRoles user={user} onSaved={(roles) => setUsers((current) => current?.map((item) => item.id === user.id ? { ...item, roles } : item) ?? [])} />
          </li>
        ))}</ul>
      )}
    </div>
  );
}
