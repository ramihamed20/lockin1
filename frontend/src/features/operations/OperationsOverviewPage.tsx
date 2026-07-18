import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import { Metric, MetricStrip, OperationsSection, StatusList } from "./components";
import { formatDateTime } from "./format";
import { useOperationsSession } from "./useOperationsSession";
import type { OverviewDashboard, SystemHealth } from "./types";

export function OperationsOverviewPage() {
  const { t, locale } = useI18n();
  const session = useOperationsSession();
  const [overview, setOverview] = useState<OverviewDashboard | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    const requests: Promise<unknown>[] = [operationsApi.overview(controller.signal).then(setOverview)];
    if (session.capabilities.includes("system_health.view")) {
      requests.push(operationsApi.health(controller.signal).then(setHealth));
    }
    void Promise.all(requests).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [session.capabilities]);

  useEffect(() => load(), [load]);
  if (!overview && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  if (failed) return <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert>;
  if (!overview) return null;

  return (
    <div className="operations-page">
      <div className="operations-period">
        <span>{t("operationalPeriod")}</span>
        <strong>{overview.period.from} – {overview.period.to}</strong>
        <span>{t("projectedFreshness")}: {overview.analytics_freshness ? formatDateTime(overview.analytics_freshness, locale) : t("noProjectedData")}</span>
      </div>

      <OperationsSection id="learning-activity" title={t("learnerActivity")}>
        <MetricStrip>
          <Metric label={t("activeLearners")} value={overview.metrics.daily_active_learners ?? 0} />
          <Metric label={t("lessonsCompleted")} value={overview.metrics.lesson_completions ?? 0} />
          <Metric label={t("quizzesSubmitted")} value={overview.metrics.quiz_submissions ?? 0} />
          <Metric label={t("focusMinutes")} value={overview.metrics.focus_minutes ?? 0} />
          <Metric label={t("subscriptionsStarted")} value={overview.metrics.subscriptions_started ?? 0} />
        </MetricStrip>
      </OperationsSection>

      <div className="operations-split">
        <OperationsSection id="queue-health" title={t("queueHealth")}>
          <dl className="operations-queue-list">
            <div><dt>{t("moderationQueue")}</dt><dd>{overview.queues.moderation}</dd></div>
            <div><dt>{t("failedPayments")}</dt><dd>{overview.queues.failed_payments}</dd></div>
            <div><dt>{t("failedNotifications")}</dt><dd>{overview.queues.failed_notifications}</dd></div>
          </dl>
        </OperationsSection>
        <OperationsSection id="subscription-health" title={t("subscriptionHealth")}>
          <StatusList values={overview.subscriptions} />
        </OperationsSection>
      </div>

      {health ? (
        <OperationsSection id="system-health" title={t("systemHealth")} copy={health.status === "ok" ? t("systemHealthy") : t("systemDegraded")}>
          <ul className="operations-health-list">
            {health.components.map((component) => (
              <li key={component.code}><span>{component.code.replaceAll("_", " ")}</span><strong data-status={component.status}>{component.status.replaceAll("_", " ")}</strong></li>
            ))}
          </ul>
        </OperationsSection>
      ) : null}

      <OperationsSection id="operational-workspaces" title={t("operationsWorkspaces")}>
        <ul className="operations-resource-list">
          {overview.resources.map((resource) => (
            <li key={resource.code}><div><strong>{resource.label}</strong><small>{resource.code}</small></div><Link to={resource.path}>{t("openWorkspace")}</Link></li>
          ))}
        </ul>
      </OperationsSection>
    </div>
  );
}
