import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { operationsApi } from "./api";
import { Metric, MetricStrip, OperationsSection, StatusList } from "./components";
import type { SupportDashboard } from "./types";

export function SupportOperationsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<SupportDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    const controller = new AbortController();
    void operationsApi.support(controller.signal).then(setData).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => load(), [load]);
  if (!data && !failed) return <PageSkeleton label={t("operationsLoading")} />;
  if (failed) return <Alert><span>{t("genericError")}</span> <Button variant="secondary" onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button></Alert>;
  if (!data) return null;
  return (
    <div className="operations-page">
      <OperationsSection id="account-signals" title={t("accountSignals")}>
        <MetricStrip>
          <Metric label={t("totalAccounts")} value={data.accounts.total} />
          <Metric label={t("suspendedAccounts")} value={data.accounts.suspended} />
          <Metric label={t("unverifiedAccounts")} value={data.accounts.unverified} />
          <Metric label={t("failedNotifications")} value={data.notifications.failed_deliveries} />
          <Metric label={t("discussions")} value={data.community.discussions} />
          <Metric label={t("comments")} value={data.community.comments} />
        </MetricStrip>
      </OperationsSection>
      <div className="operations-domain-grid">
        <OperationsSection id="moderation-states" title={t("moderationQueue")}><StatusList values={data.moderation} /></OperationsSection>
        <OperationsSection id="payment-states" title={t("paymentHealth")}><StatusList values={data.payments} /></OperationsSection>
        <OperationsSection id="subscription-states" title={t("subscriptionHealth")}><StatusList values={data.subscriptions} /></OperationsSection>
        <OperationsSection id="notification-volume" title={t("notificationHealth")}>
          <StatusList values={{ total: data.notifications.total, failed: data.notifications.failed_deliveries }} />
        </OperationsSection>
      </div>
    </div>
  );
}
