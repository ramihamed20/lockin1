import { useMemo, useState } from "react";
import { billingApi } from "../api/billing.js";
import { formatDate, formatDateTime } from "../lib/i18n.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
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
    if (!version || !price) return [];
    return [{ product, plan, version, price }];
  }));
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
  const summary = useAsyncData(() => billingApi.summary(), []);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const offers = useMemo(() => summary.data ? paidOffers(summary.data.catalog) : [], [summary.data]);
  const effectivePlan = selectedPlan || offers[0]?.plan.id || "";

  if (summary.loading) return <LoadingPanel />;
  if (summary.error) return <ErrorPanel message={summary.error} onRetry={summary.reload} />;

  const { subscription, payments, catalog } = summary.data;
  const recentPayments = payments.filter((payment) => payment.method === "libyana").slice(0, 5);
  const periodEnd = subscription?.status === "trialing"
    ? subscription?.trial_ends_at
    : subscription?.current_period_ends_at;
  const paymentLabel = subscription?.payment_verification === "provisional"
    ? t("subscription.pending")
    : subscription?.payment_verification === "verified"
      ? t("subscription.verified")
      : "—";

  async function submitPayment(event) {
    event.preventDefault();
    if (!effectivePlan || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await billingApi.submitLibyana(effectivePlan, code);
      setCode("");
      setNotice(t("subscription.submitted"));
      await summary.reload();
    } catch (requestError) {
      setError(requestError.message || t("subscription.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title={t("subscription.title")} subtitle={t("subscription.subtitle")}>
      {!subscription?.access_allowed && (
        <section className="subscription-saved-banner">
          <div><p className="eyebrow">Lock-in</p><h2>{t("subscription.spaceSaved")}</h2><p>{t("subscription.spaceSavedBody")}</p></div>
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
        ) : (
          <form className="libyana-payment-form" onSubmit={submitPayment}>
            <fieldset className="subscription-plan-options">
              <legend>{t("subscription.choosePlan")}</legend>
              {offers.map(({ plan, version, price }) => (
                <label className={effectivePlan === plan.id ? "selected" : ""} key={plan.id}>
                  <input type="radio" name="subscription-plan" value={plan.id} checked={effectivePlan === plan.id} onChange={() => setSelectedPlan(plan.id)} />
                  <span><strong>{version.title}</strong><small>{version.description}</small></span>
                  <b>{money(price.amount_minor, price.currency, price.currency_exponent, locale)}</b>
                </label>
              ))}
            </fieldset>
            <label className="field libyana-code-field">
              <span>{t("subscription.rechargeCode")}</span>
              <input type="text" inputMode="numeric" autoComplete="off" dir="ltr" minLength={8} maxLength={64} value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("subscription.codePlaceholder")} aria-describedby="libyana-code-hint" required />
              <small id="libyana-code-hint">{t("subscription.codeHint")}</small>
            </label>
            {error && <p className="form-alert error" role="alert">{error}</p>}
            {notice && <p className="form-alert success" role="status">{notice}</p>}
            <button className="btn btn-primary libyana-submit" type="submit" disabled={submitting || code.trim().length < 8}>{submitting ? t("subscription.submitting") : t("subscription.submitCard")}</button>
            <p className="subscription-code-privacy">{t("subscription.codePrivacy")}</p>
          </form>
        )}
      </section>

      <section className="panel subscription-history">
        <div className="panel-title"><div><p className="eyebrow">{t("subscription.history")}</p><h2>{t("subscription.recentPayments")}</h2></div><span>{recentPayments.length}</span></div>
        {recentPayments.length ? (
          <div className="subscription-history-list">
            {recentPayments.map((payment) => <article className="list-row" key={payment.id}><div><h3>{payment.price_snapshot?.plan_title || t("subscription.payLibyana")}</h3><p>{money(payment.amount_minor, payment.currency, payment.currency_exponent, locale)} · {formatDateTime(payment.created_at)}</p><small>{paymentStatus(payment.manual_submission?.status, t)}</small></div><span>{payment.manual_submission?.recharge_code_masked}</span></article>)}
          </div>
        ) : <EmptyState title={t("subscription.noPayments")} text={t("subscription.noPaymentsBody")} />}
      </section>
    </Page>
  );
}
