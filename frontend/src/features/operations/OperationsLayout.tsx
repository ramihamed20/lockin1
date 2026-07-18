import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Outlet } from "react-router-dom";

import { ApiError } from "../../api/client";
import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import type { OperationsSession } from "./types";

type OperationsLink = {
  to: string;
  label: string;
  capability: string;
  end?: boolean;
};

export function OperationsLayout() {
  const { t } = useI18n();
  const [session, setSession] = useState<OperationsSession | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.session(controller.signal)
      .then(setSession)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 403) setDenied(true);
        else setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);
  if (denied) return <Navigate to="/" replace />;
  if (!session && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  if (failed) {
    return (
      <div className="page operations-page">
        <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert>
      </div>
    );
  }
  if (!session) return null;

  const links: OperationsLink[] = [
    { to: "/operations", label: t("operationsOverview"), capability: "overview.view", end: true },
    { to: "/operations/content", label: t("operationsContent"), capability: "content.view" },
    { to: "/operations/support", label: t("operationsSupport"), capability: "users.view" },
    { to: "/operations/users", label: t("operationsUsers"), capability: "users.view" },
    { to: "/operations/audit", label: t("operationsAudit"), capability: "audit.view" },
    { to: "/operations/reports", label: t("operationsReports"), capability: "reports.export" },
    { to: "/operations/configuration", label: t("operationsConfiguration"), capability: "configuration.view" }
  ];

  return (
    <div className="operations-workspace">
      <header className="operations-workspace__header">
        <div><h1>{t("operationsTitle")}</h1><p>{t("operationsCopy")}</p></div>
        <span>{session.timezone}</span>
      </header>
      <nav className="operations-tabs" aria-label={t("operationsTitle")}>
        {links.filter((item) => session.capabilities.includes(item.capability)).map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end ?? false}>{item.label}</NavLink>
        ))}
      </nav>
      <Outlet context={session} />
    </div>
  );
}
