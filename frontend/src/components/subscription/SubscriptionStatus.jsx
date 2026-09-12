import { formatDate } from "../../lib/i18n.js";
import { useI18n } from "../I18nProvider.jsx";

function displayState(subscription) {
  if (!subscription) return "expired";
  if (subscription.payment_verification === "provisional") return "pending";
  return subscription.status || "expired";
}

export function SubscriptionStatus({ subscription, compact = false }) {
  const { t } = useI18n();
  const state = displayState(subscription);
  const days = Math.max(0, Number(subscription?.remaining_days || 0));
  const expiresAt = subscription?.status === "trialing"
    ? subscription?.trial_ends_at
    : subscription?.current_period_ends_at;
  // An ended subscription used to render nothing at all, so the card it sits on
  // showed a plan name and no state whatsoever -- indistinguishable from a
  // reader whose access is fine. Say it plainly instead.
  if (state === "suspended") return null;
  const labels = {
    trialing: [t("subscription.freeTrial"), t("subscription.daysRemaining", { count: days })],
    active: [t("subscription.active"), expiresAt ? t("subscription.expires", { date: formatDate(expiresAt, { dateStyle: "medium" }) }) : ""],
    pending: [t("subscription.active"), t("subscription.reviewPending")],
    grace: [t("subscription.renewalPeriod"), t("subscription.daysRemaining", { count: days })],
    expired: [t("subscription.expired"), ""],
    cancelled: [t("subscription.cancelled"), ""]
  };
  // An unrecognised state is an ended state, never an active one: guessing
  // "Active" for a status this component has not been taught (refunded, say)
  // would tell the reader the opposite of the truth.
  const [title, detail] = labels[state] || labels.expired;

  return (
    <span className={`subscription-state subscription-state-${state}${compact ? " compact" : ""}`}>
      <span className="subscription-state-dot" aria-hidden="true" />
      <span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
    </span>
  );
}
