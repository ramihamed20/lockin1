import { useMemo, useRef, useState } from "react";
import { billingApi } from "../api/billing.js";
import { generateIdempotencyKey } from "../api/pagination.js";
import { formatDate, formatDateTime } from "../lib/i18n.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useSubscriptionSession } from "../lib/SubscriptionSessionContext.jsx";
import { useI18n } from "../components/I18nProvider.jsx";
import { SubscriptionStatus } from "../components/subscription/SubscriptionStatus.jsx";
import { EmptyState, ErrorPanel, LoadingPanel, Page } from "../components/ui/index.jsx";

function money(amountMinor, currency, exponent = 3, locale = "en") {
  const amount = Number(amountMinor) / (10 ** Number(exponent));
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "en-LY", {
      style: "currency",
      currency: String(currency || "LYD").toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: Number(exponent)
    }).format(amount);
  } catch {
    return `${amount} ${String(currency || "LYD").toUpperCase()}`;
  }
}

function paidOffers(catalog) {
  return catalog.results.flatMap((product) => (product.plans || []).flatMap((plan) => {
    const version = plan.current_version;
    const price = version?.prices?.find((item) => String(item.currency).toUpperCase() === "LYD");
    if (!version || !price || (price.first_subscription_only && !catalog.firstSubscriptionOfferEligible)) return [];
    return [{ product, plan, version, price }];
  })).sort((left, right) => Number(left.price.amount_minor) - Number(right.price.amount_minor));
}

function isFiveLyd(price) {
  return Number(price?.amount_minor) === 5 * (10 ** Number(price?.currency_exponent || 0));
}

function paymentStatus(value, t) {
  const labels = {
    pending: t("subscription.pending"),
    approved: t("subscription.approved"),
    rejected: t("subscription.rejected"),
    cancelled: t("subscription.cancelled")
  };
  return labels[value] || "—";
}

export default function Subscription() {
  const { locale, direction, t } = useI18n();
  const subscriptionSession = useSubscriptionSession();
  const details = useAsyncData(() => billingApi.details(), []);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [codes, setCodes] = useState(["", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Survives re-renders and failed submissions; cleared only once an attempt
  // has actually been accepted. See submitPayment.
  const paymentAttemptKey = useRef("");
  const offers = useMemo(() => details.data ? paidOffers(details.data.catalog) : [], [details.data]);
  const effectivePlan = selectedPlan || offers[0]?.plan.id || "";

  if (details.loading) return <LoadingPanel />;
  if (details.error) return <ErrorPanel message={details.error} onRetry={details.reload} />;

  const { subscription, directAccess, accessExempt } = subscriptionSession;
  const { payments, catalog } = details.data;
  const recentPayments = payments.filter((payment) => payment.method === "libyana").slice(0, 5);
  const selectedOffer = offers.find(({ plan }) => plan.id === effectivePlan) || offers[0];
  const oneCardOnly = isFiveLyd(selectedOffer?.price);
  const pendingManualReview = recentPayments.some((payment) => payment.manual_submission?.status === "pending");
  const renewalBlocked = subscription?.status === "active" && !subscription?.early_renewal_available;
  const canSubmit = !renewalBlocked && !pendingManualReview;
  const periodEnd = subscription?.status === "trialing"
    ? subscription?.trial_ends_at
    : subscription?.current_period_ends_at;
  const paymentLabel = subscription?.payment_verification === "provisional"
    ? t("subscription.pending")
    : subscription?.payment_verification === "verified"
      ? t("subscription.verified")
      : "—";

  if (directAccess || accessExempt) {
    return (
      <Page title={t("subscription.directAccess")} subtitle={t("subscription.directAccessBody")}>
        <section className="subscription-saved-banner subscription-direct-access">
          <div><p className="eyebrow">Lock-in</p><h2>{t("subscription.directAccess")}</h2><p>{t("subscription.directAccessBody")}</p></div>
        </section>
      </Page>
    );
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (!effectivePlan || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    // One attempt, one key, however many times the transport is retried.
    //
    // A key minted per call made a retry after a lost response look like a
    // second payment to the server, which is the case the key exists to cover.
    // The key is kept until the attempt actually succeeds; only then does the
    // next submission become a new attempt with a new key.
    if (!paymentAttemptKey.current) paymentAttemptKey.current = generateIdempotencyKey();
    try {
      const result = await billingApi.submitLibyana(
        effectivePlan,
        oneCardOnly ? [codes[0]] : codes.filter(Boolean),
        paymentAttemptKey.current
      );
      paymentAttemptKey.current = "";
      subscriptionSession.setAuthoritativeSubscription(result.subscription);
      setCodes(["", ""]);
      setNotice(t("subscription.submitted"));
      details.reload();
    } catch (requestError) {
      setError(requestError.message || t("subscription.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title={t("subscription.title")} subtitle={t("subscription.subtitle")}>
      {subscription?.early_renewal_available && (
        <section className="subscription-saved-banner subscription-early-renewal">
          <div><h2>{t("subscription.earlyRenewalDays", { count: subscription.remaining_days })}</h2><p>{t("subscription.earlyRenewalPromise")}</p></div>
          <a className="btn btn-primary" href="#libyana-payment">{t("subscription.renew")}</a>
        </section>
      )}

      <section className="subscription-overview">
        <article className="panel subscription-current-card">
          <div className="panel-title">
            <div><p className="eyebrow">{t("subscription.currentAccess")}</p><h2>{subscription?.plan_title || t("subscription.noPlan")}</h2></div>
            <SubscriptionStatus subscription={subscription} />
          </div>
          {subscription?.status === "grace" && <p className="subscription-grace-note">{t("subscription.graceMessage", { count: subscription.remaining_days })}</p>}
          <dl className="subscription-facts">
            <div><dt>{t("subscription.currentPlan")}</dt><dd>{subscription?.plan_title || "—"}</dd></div>
            <div><dt>{subscription?.status === "trialing" ? t("subscription.trialExpiration") : t("subscription.subscriptionExpiration")}</dt><dd>{periodEnd ? formatDate(periodEnd, { dateStyle: "medium" }) : "—"}</dd></div>
            <div><dt>{t("subscription.remaining")}</dt><dd>{t("subscription.daysRemaining", { count: subscription?.remaining_days || 0 })}</dd></div>
            <div><dt>{t("subscription.paymentVerification")}</dt><dd>{paymentLabel}</dd></div>
          </dl>
        </article>

        <article className="panel subscription-steps-card">
          <p className="eyebrow">{t("subscription.howItWorks")}</p>
          <ol className="subscription-steps">
            <li><span>1</span><strong>{t("subscription.buyCard")}</strong></li>
            <li><span>2</span><strong>{t("subscription.enterCode")}</strong></li>
            <li><span>3</span><strong>{t("subscription.keepStudying")}</strong></li>
          </ol>
        </article>
      </section>

      <section className="panel subscription-payment" id="libyana-payment" dir={direction}>
        <div className="panel-title">
          <div><p className="eyebrow">{t("subscription.renewAccess")}</p><h2>{t("subscription.payLibyana")}</h2><p>{t("subscription.continueImmediately")}</p></div>
        </div>
        {!catalog.manualPaymentAvailable || !offers.length ? (
          <EmptyState title={t("subscription.noOffers")} text={t("subscription.noOffersBody")} />
        ) : !canSubmit ? (
          <div className="subscription-payment-unavailable">
            <h3>{pendingManualReview ? t("subscription.pendingPaymentTitle") : t("subscription.renewalNotYet")}</h3>
            <p>{pendingManualReview ? t("subscription.pendingPaymentBody") : t("subscription.renewalNotYetBody")}</p>
          </div>
        ) : (
          <form className="libyana-payment-form" onSubmit={submitPayment}>
            <fieldset className="subscription-plan-options">
              <legend>{t("subscription.choosePlan")}</legend>
              {offers.map(({ plan, version, price }) => (
                <label className={effectivePlan === plan.id ? "selected" : ""} key={plan.id}>
                  <input type="radio" name="subscription-plan" value={plan.id} checked={effectivePlan === plan.id} onChange={() => { setSelectedPlan(plan.id); setCodes(["", ""]); }} />
                  <span><strong>{version.title}</strong><small>{version.description}</small></span>
                  <b>{money(price.amount_minor, price.currency, price.currency_exponent, locale)}</b>
                </label>
              ))}
            </fieldset>
            <div className="libyana-code-stack">
              <label className="field libyana-code-field">
                <span>{t("subscription.rechargeCode")}</span>
                <input type="text" inputMode="numeric" autoComplete="off" dir="ltr" pattern="[0-9]{13}" minLength={13} maxLength={13} value={codes[0]} onChange={(event) => setCodes([event.target.value.replace(/\D/g, "").slice(0, 13), codes[1]])} placeholder={t("subscription.codePlaceholder")} aria-describedby="libyana-code-hint" required />
                <small id="libyana-code-hint">{t("subscription.codeHint")}</small>
              </label>
              {!oneCardOnly && <label className="field libyana-code-field">
                <span>{t("subscription.additionalRechargeCode")}</span>
                <input type="text" inputMode="numeric" autoComplete="off" dir="ltr" pattern="[0-9]{13}" minLength={13} maxLength={13} value={codes[1]} onChange={(event) => setCodes([codes[0], event.target.value.replace(/\D/g, "").slice(0, 13)])} placeholder={t("subscription.codePlaceholder")} />
              </label>}
            </div>
            {error && <p className="form-alert error" role="alert">{error}</p>}
            {notice && <p className="form-alert success" role="status">{notice}</p>}
            <button className="btn btn-primary libyana-submit" type="submit" disabled={submitting || codes[0].length !== 13 || (!oneCardOnly && codes[1] && codes[1].length !== 13)}>{submitting ? t("subscription.submitting") : t("subscription.submitCard")}</button>
            <p className="subscription-code-privacy">{t("subscription.codePrivacy")}</p>
          </form>
        )}
      </section>

      <section className="panel subscription-history">
        <div className="panel-title"><div><p className="eyebrow">{t("subscription.history")}</p><h2>{t("subscription.recentPayments")}</h2></div><span>{recentPayments.length}</span></div>
        {recentPayments.length ? (
          <div className="subscription-history-list">
            {recentPayments.map((payment) => <article className="list-row" key={payment.id}><div><h3>{payment.price_snapshot?.plan_title || t("subscription.payLibyana")}</h3><p>{money(payment.amount_minor, payment.currency, payment.currency_exponent, locale)} · {formatDateTime(payment.created_at)}</p><small>{paymentStatus(payment.manual_submission?.status, t)}</small>{payment.manual_submission?.status === "rejected" && <p className="subscription-rejection"><span>{t("subscription.paymentRejected")}: {payment.manual_submission?.rejection_reason}</span><a href="#libyana-payment">{t("subscription.retryPayment")}</a></p>}</div><span>{(payment.manual_submission?.recharge_codes_masked || []).join(" · ")}</span></article>)}
          </div>
        ) : <EmptyState title={t("subscription.noPayments")} text={t("subscription.noPaymentsBody")} />}
      </section>
    </Page>
  );
}
