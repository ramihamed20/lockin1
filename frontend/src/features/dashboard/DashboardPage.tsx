import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { apiRequest } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useAuth } from "../auth/AuthProvider";
import type { Role } from "../auth/types";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/catalogs";

type Dashboard = {
  roles: Role[];
  account: { email_verified: boolean; active_sessions: number; preferred_language: "en" | "ar" };
  workspaces: Role[];
  administration?: { total: number; verified: number; suspended: number };
};

const roleKeys: Record<Role, MessageKey> = {
  student: "roleStudent",
  moderator: "roleModerator",
  creator: "roleCreator",
  administrator: "roleAdministrator"
};

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [data, setData] = useState<Dashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    void apiRequest<Dashboard>("/dashboard")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<Dashboard>("/dashboard")
      .then((response) => { if (active) setData(response); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  if (!data && !failed) return <PageSkeleton label={t("loading")} />;
  if (failed) return <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={load}>{t("retry")}</Button></Alert>;
  if (!data) return null;

  return (
    <div className="page page--dashboard">
      <header className="page-heading page-heading--wide">
        <p className="eyebrow">{t("dashboardGreeting")}, {user?.full_name.split(" ")[0]}</p>
        <h1>{t("dashboardTitle")}</h1>
        <p>{t("dashboardCopy")}</p>
      </header>
      <section className="next-action" aria-labelledby="next-action-title">
        <div>
          <span className="section-index">01</span>
          <h2 id="next-action-title">{t("nextAction")}</h2>
          <p>{t("completeProfile")}</p>
        </div>
        <Link className="button button--primary" to="/security">{t("reviewSecurity")}</Link>
      </section>
      <div className="dashboard-columns">
        <section className="data-section" aria-labelledby="account-ready-title">
          <header><span className="section-index">02</span><h2 id="account-ready-title">{t("accountReady")}</h2></header>
          <dl className="data-list">
            <div><dt>{t("emailVerifiedLabel")}</dt><dd>{data.account.email_verified ? t("yes") : t("no")}</dd></div>
            <div><dt>{t("activeSessions")}</dt><dd>{data.account.active_sessions}</dd></div>
            <div><dt>{t("languageLabel")}</dt><dd>{data.account.preferred_language === "ar" ? t("arabic") : t("english")}</dd></div>
          </dl>
        </section>
        <section className="data-section" aria-labelledby="workspaces-title">
          <header><span className="section-index">03</span><h2 id="workspaces-title">{t("availableWorkspaces")}</h2></header>
          {data.workspaces.length ? (
            <ul className="role-list">{data.roles.map((role) => <li key={role}>{t(roleKeys[role])}</li>)}</ul>
          ) : <p className="muted-copy">{t("noRoleWorkspaces")}</p>}
        </section>
      </div>
      {data.administration ? (
        <section className="admin-strip" aria-labelledby="admin-summary-title">
          <h2 id="admin-summary-title">{t("adminSummary")}</h2>
          <dl>
            <div><dt>{t("totalUsers")}</dt><dd>{data.administration.total}</dd></div>
            <div><dt>{t("verifiedUsers")}</dt><dd>{data.administration.verified}</dd></div>
            <div><dt>{t("suspendedUsers")}</dt><dd>{data.administration.suspended}</dd></div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
