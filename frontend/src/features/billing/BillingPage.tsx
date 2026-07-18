import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { Alert, PageSkeleton } from "../../components/Feedback";
import { useI18n } from "../../i18n/I18nProvider";
import { billingApi } from "./api";
import { AvailablePlans } from "./components/AvailablePlans";
import { BillingHistory } from "./components/BillingHistory";
import { EntitlementList } from "./components/EntitlementList";
import { PlanSummary } from "./components/PlanSummary";
import type { BillingState } from "./types";

export function BillingPage() {
  const { t } = useI18n();
  const [data, setData] = useState<BillingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    void Promise.all([
      billingApi.currentSubscription(controller.signal),
      billingApi.entitlements(controller.signal),
      billingApi.catalog(controller.signal),
      billingApi.payments(controller.signal),
      billingApi.invoices(controller.signal),
      billingApi.refunds(controller.signal)
    ])
      .then(([subscription, entitlements, catalog, payments, invoices, refunds]) => {
        if (controller.signal.aborted) return;
        setData({
          subscription: subscription.subscription,
          entitlements: entitlements.results,
          products: catalog.results,
          checkoutAvailable: catalog.checkout_available,
          payments: payments.results,
          invoices: invoices.results,
          refunds: refunds.results
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => load(), [load]);

  const confirmCancellation = async () => {
    setCancelling(true);
    setActionError(false);
    try {
      const subscription = await billingApi.cancelCurrent();
      setData((current) => (current ? { ...current, subscription } : current));
      setConfirmingCancellation(false);
    } catch {
      setActionError(true);
    } finally {
      setCancelling(false);
    }
  };

  if (!data && !failed) return <PageSkeleton label={t("loadingBilling")} />;
  if (!data) {
    return (
      <Alert>
        {t("billingLoadError")} {" "}
        <Button onClick={() => { setFailed(false); load(); }}>{t("retry")}</Button>
      </Alert>
    );
  }

  return (
    <div className="page billing-page">
      <header className="page-heading page-heading--wide billing-heading">
        <p className="eyebrow">Lock-in</p>
        <h1>{t("billingTitle")}</h1>
        <p>{t("billingCopy")}</p>
      </header>

      {actionError ? <Alert>{t("cancellationError")}</Alert> : null}
      <PlanSummary
        subscription={data.subscription}
        confirmingCancellation={confirmingCancellation}
        cancelling={cancelling}
        onBeginCancellation={() => setConfirmingCancellation(true)}
        onCancelCancellation={() => setConfirmingCancellation(false)}
        onConfirmCancellation={() => void confirmCancellation()}
      />
      <EntitlementList entitlements={data.entitlements} />
      <AvailablePlans
        products={data.products}
        checkoutAvailable={data.checkoutAvailable}
      />
      <BillingHistory
        invoices={data.invoices}
        payments={data.payments}
        refunds={data.refunds}
      />
    </div>
  );
}
