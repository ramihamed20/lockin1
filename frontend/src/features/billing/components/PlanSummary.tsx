import { Button } from "../../../components/Button";
import { useI18n } from "../../../i18n/I18nProvider";
import { formatDate } from "../format";
import type { Subscription } from "../types";

const statusKeys = {
  pending: "billingStatusPending",
  trialing: "billingStatusTrial",
  active: "billingStatusActive",
  grace: "billingStatusGrace",
  expired: "billingStatusExpired",
  cancelled: "billingStatusCancelled",
  suspended: "billingStatusSuspended",
  refunded: "billingStatusRefunded"
} as const;

type Props = {
  subscription: Subscription | null;
  confirmingCancellation: boolean;
  cancelling: boolean;
  onBeginCancellation: () => void;
  onCancelCancellation: () => void;
  onConfirmCancellation: () => void;
};

export function PlanSummary({
  subscription,
  confirmingCancellation,
  cancelling,
  onBeginCancellation,
  onCancelCancellation,
  onConfirmCancellation
}: Props) {
  const { locale, t } = useI18n();
  if (!subscription) {
    return (
      <section className="billing-plan billing-plan--empty" aria-labelledby="current-plan-heading">
        <div>
          <p className="billing-kicker">{t("currentPlan")}</p>
          <h2 id="current-plan-heading">{t("noCurrentPlan")}</h2>
          <p>{t("noCurrentPlanCopy")}</p>
        </div>
      </section>
    );
  }

  const ending =
    subscription.status === "trialing"
      ? subscription.trial_ends_at
      : subscription.current_period_ends_at;
  const canCancel = ["trialing", "active", "grace"].includes(subscription.status);

  return (
    <section className="billing-plan" aria-labelledby="current-plan-heading">
      <div className="billing-plan__identity">
        <p className="billing-kicker">{t("currentPlan")}</p>
        <div className="billing-title-row">
          <h2 id="current-plan-heading">{subscription.plan_title}</h2>
          <span className={`status-chip status-chip--${subscription.status}`}>
            {t(statusKeys[subscription.status])}
          </span>
        </div>
        <p>{t("serverAuthoritativeAccess")}</p>
      </div>
      <dl className="billing-plan__dates">
        <div>
          <dt>{subscription.status === "trialing" ? t("trialEnds") : t("renewalDate")}</dt>
          <dd>{ending ? formatDate(ending, locale) : t("notApplicable")}</dd>
        </div>
        <div>
          <dt>{t("planReference")}</dt>
          <dd>{subscription.plan_code}</dd>
        </div>
      </dl>
      {subscription.cancel_at_period_end ? (
        <p className="billing-notice" role="status">
          {t("cancellationScheduled")} {ending ? formatDate(ending, locale) : ""}
        </p>
      ) : canCancel && !confirmingCancellation ? (
        <Button variant="quiet" onClick={onBeginCancellation}>
          {t("manageCancellation")}
        </Button>
      ) : null}
      {confirmingCancellation ? (
        <div className="cancel-confirmation" role="group" aria-labelledby="cancel-heading">
          <div>
            <h3 id="cancel-heading">{t("confirmCancellationTitle")}</h3>
            <p>{t("confirmCancellationCopy")}</p>
          </div>
          <div className="cancel-confirmation__actions">
            <Button variant="danger" disabled={cancelling} onClick={onConfirmCancellation}>
              {cancelling ? t("saving") : t("confirmCancellation")}
            </Button>
            <Button variant="quiet" disabled={cancelling} onClick={onCancelCancellation}>
              {t("keepPlan")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
