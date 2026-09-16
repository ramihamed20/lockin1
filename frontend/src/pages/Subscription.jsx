import { useEffect, useMemo, useRef, useState } from "react";
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
    return new Intl.NumberFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "en-LY", {
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

function comingSoonOffers(catalog) {
  return catalog.results.flatMap((product) => (product.plans || []).flatMap((plan) => {
    const version = plan.current_version;
    return version?.availability === "coming_soon" ? [{ product, plan, version }] : [];
  }));
}

function ComingSoonPlans({ offers, t }) {
  if (!offers.length) return null;
  return <section className="panel subscription-coming-soon" aria-labelledby="coming-soon-title">
    <div className="panel-title"><div><h2 id="coming-soon-title">{t("subscription.comingSoonPlans")}</h2><p>{t("subscription.comingSoonPlansBody")}</p></div></div>
    <div className="subscription-offer-grid">
      {offers.map(({ plan, version }) => <article className="subscription-offer is-coming-soon" key={plan.code}>
        <span className="subscription-coming-soon-badge">{t("subscription.comingSoon")}</span>
        <div><h3>{version.title}</h3><p>{version.description}</p></div>
        <ul><li><span>{t("subscription.dentistry")}</span><strong>{t("subscription.allCollegesYears")}</strong></li></ul>
        <button className="btn btn-soft" type="button" disabled aria-disabled="true">{t("subscription.comingSoon")}</button>
      </article>)}
    </div>
  </section>;
}

function isFiveLyd(price) {
  return Number(price?.amount_minor) === 5 * (10 ** Number(price?.currency_exponent || 0));
}

const PLAN_COPY = {
  lockin_first_month: { en: ["First month", "One-month subscription"], ar: ["الشهر الأول", "اشتراك لمدة شهر"] },
  lockin_two_months: { en: ["Two months", "Two-month subscription"], ar: ["شهران", "اشتراك لمدة شهرين"] },
  lockin_three_months: { en: ["Three months", "Three-month subscription"], ar: ["3 أشهر", "اشتراك لمدة ثلاثة أشهر"] },
  lockin_four_months: { en: ["Four months", "Four-month subscription"], ar: ["4 أشهر", "اشتراك لمدة أربعة أشهر"] }
};

function offerCopy(plan, version, locale) {
  const translated = PLAN_COPY[plan.code]?.[locale];
  return translated ? { title: translated[0], description: translated[1] } : { title: version.title, description: version.description };
}

/**
 * The one banner that says where this reader's last card actually stands.
 *
 * It reads the review carried on the subscription snapshot, which the access
 * session re-reads on a timer, so an approval or a rejection made by an
 * administrator reaches this screen on its own. The payment-history list below
 * is a record; this is the live state.
 */
function ReviewBanner({ review, t, onRetry }) {
  if (!review) return null;
  const tone = { pending: "pending", approved: "approved", rejected: "rejected" }[review.status];
  if (!tone) return null;
  const when = tone === "pending" ? review.submitted_at : review.reviewed_at;
  const date = when ? formatDateTime(when) : "—";
  const copy = {
    pending: [t("subscription.reviewPendingTitle"), t("subscription.reviewPendingBody", { date })],
    approved: [t("subscription.reviewApprovedTitle"), t("subscription.reviewApprovedBody", { date })],
    rejected: [t("subscription.reviewRejectedTitle"), t("subscription.reviewRejectedBody")]
  }[tone];
  return (
    <section
      className={`subscription-review-banner is-${tone}`}
      role={tone === "rejected" ? "alert" : "status"}
      aria-live="polite"
    >
      <div>
        <h2>{copy[0]}</h2>
        <p>{copy[1]}</p>
        {tone === "rejected" && review.rejection_reason && (
          <p className="subscription-review-reason">
            <strong>{t("subscription.reviewReason")}:</strong> {review.rejection_reason}
          </p>
        )}
      </div>
      {tone === "rejected" && (
        <a className="btn btn-primary" href="#libyana-payment" onClick={onRetry}>{t("subscription.submitAnotherCard")}</a>
      )}
    </section>
  );
}

const CHECKOUT_STEPS = ["plan", "review", "pay"];

/**
 * Where the reader is in the purchase: choose a plan, see what it costs and
 * includes, then pay. Earlier steps stay clickable so a plan can be changed
 * without starting over.
 */
function CheckoutStepper({ step, onStep, t }) {
  const current = CHECKOUT_STEPS.indexOf(step);
  const labels = { plan: t("subscription.stepPlan"), review: t("subscription.stepReview"), pay: t("subscription.stepPay") };
  return (
    <ol className="subscription-stepper" aria-label={t("subscription.stepsLabel")}>
      {CHECKOUT_STEPS.map((key, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={key} className={`is-${state}`}>
            <button type="button" disabled={index > current} aria-current={state === "current" ? "step" : undefined} onClick={() => onStep(key)}>
              <span className="subscription-stepper-index" aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>
              <span>{labels[key]}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
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
  const [step, setStep] = useState("plan");
  const purchaseRef = useRef(null);
  const [codes, setCodes] = useState(["", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Survives re-renders and failed submissions; cleared only once an attempt
  // has actually been accepted. See submitPayment.
  const paymentAttemptKey = useRef("");
  const offers = useMemo(() => details.data ? paidOffers(details.data.catalog) : [], [details.data]);
  const comingSoon = useMemo(() => details.data ? comingSoonOffers(details.data.catalog) : [], [details.data]);
  const effectivePlan = selectedPlan || offers[0]?.plan.id || "";
  const review = subscriptionSession.manualPaymentReview;

  // The payment history and the plan catalogue are loaded once, when the screen
  // opens. The access session keeps re-reading the review state on its own, so
  // when it reports a different decision than the one this screen was rendered
  // with, the loaded-once half is out of date and has to catch up -- otherwise
  // the history keeps showing "pending review" under a banner that already says
  // approved, and the first-subscription offer stays priced for a payment that
  // has since been rejected.
  const reviewStamp = review ? `${review.payment_id}:${review.status}` : "";
  const lastReviewStamp = useRef(reviewStamp);
  const reloadDetails = details.reload;
  useEffect(() => {
    if (lastReviewStamp.current === reviewStamp) return;
    lastReviewStamp.current = reviewStamp;
    reloadDetails();
  }, [reloadDetails, reviewStamp]);

  if (details.loading) return <LoadingPanel />;
  if (details.error) return <ErrorPanel message={details.error} onRetry={details.reload} />;

  const { subscription, directAccess, accessExempt } = subscriptionSession;
  const { payments, catalog } = details.data;
  const recentPayments = payments.filter((payment) => payment.method === "libyana").slice(0, 5);
  const selectedOffer = offers.find(({ plan }) => plan.id === effectivePlan) || offers[0];
  const oneCardOnly = isFiveLyd(selectedOffer?.price);
  // Asked of the access session, not of the payment list this screen loaded
  // when it opened. The list cannot know that a reviewer decided thirty seconds
  // ago, so readers whose card was approved -- or rejected -- sat in front of
  // "a payment is already under review" with the form hidden, unable to pay and
  // with nothing on the screen telling them why.
  const pendingManualReview = subscriptionSession.pendingManualPayment;
  const renewalBlocked = subscription?.status === "active" && subscription?.access_allowed && !subscription?.early_renewal_available;
  const canSubmit = review?.status === "rejected" || (!renewalBlocked && !pendingManualReview);
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
        <ComingSoonPlans offers={comingSoon} t={t} />
      </Page>
    );
  }

  // Moving between steps keeps the purchase in view: on a phone the next step
  // would otherwise open below the fold with nothing telling the reader it did.
  function goToStep(next) {
    setStep(next);
    setError("");
    window.requestAnimationFrame(() => purchaseRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  async function submitPayment(event) {
    event.preventDefault();
    if (step !== "pay") { goToStep(step === "plan" ? "review" : "pay"); return; }
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
      setStep("plan");
      setNotice(t("subscription.submitted"));
      details.reload();
    } catch (requestError) {
      setError(requestError.message || t("subscription.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Page title={t("subscription.title")} headingHandled>
      <div className="subscription-premium">
        <ReviewBanner review={review} t={t} onRetry={() => setStep("plan")} />

        {!subscription?.access_allowed && !pendingManualReview && (
          <section className="subscription-review-banner is-expired" role="status">
            <div><h2>{t("subscription.expiredTitle")}</h2><p>{t("subscription.expiredBody")}</p></div>
            <a className="btn btn-primary" href="#libyana-payment" onClick={() => setStep("plan")}>{t("subscription.renew")}</a>
          </section>
        )}

        {subscription?.early_renewal_available && (
          <section className="subscription-saved-banner subscription-early-renewal">
            <div><h2>{t("subscription.earlyRenewalDays", { count: subscription.remaining_days })}</h2><p>{t("subscription.earlyRenewalPromise")}</p></div>
            <a className="btn btn-primary" href="#libyana-payment" onClick={() => setStep("plan")}>{t("subscription.renew")}</a>
          </section>
        )}

        <header className="subscription-premium-header">
          <div>
            <p className="subscription-brand-label">Lock-in <span>{t("subscription.premium")}</span></p>
            <h1>{t("subscription.choosePlan")}</h1>
            <p>{t("subscription.premiumLead")}</p>
          </div>
          <div className="subscription-current-summary">
            <span>{t("subscription.currentAccess")}</span>
            <strong>{subscription?.plan_title || t("subscription.noPlan")}</strong>
            <SubscriptionStatus subscription={subscription} compact />
          </div>
        </header>

        <section className="subscription-purchase" id="libyana-payment" ref={purchaseRef} dir={direction} aria-labelledby="subscription-plan-heading">
          {!catalog.manualPaymentAvailable || !offers.length ? (
            <EmptyState title={t("subscription.noOffers")} text={t("subscription.noOffersBody")} />
          ) : !canSubmit ? (
            <div className="subscription-payment-unavailable">
              <h2>{pendingManualReview ? t("subscription.pendingPaymentTitle") : t("subscription.renewalNotYet")}</h2>
              <p>{pendingManualReview ? t("subscription.pendingPaymentBody") : t("subscription.renewalNotYetBody")}</p>
            </div>
          ) : (
            <form className="subscription-checkout" onSubmit={submitPayment}>
              <CheckoutStepper step={step} onStep={goToStep} t={t} />

              {step === "plan" && <fieldset className="subscription-plan-options">
                <legend id="subscription-plan-heading">{t("subscription.choosePlan")}</legend>
                <p className="subscription-step-lead">{t("subscription.stepPlanLead")}</p>
                <div className="subscription-plan-grid">
                  {offers.map(({ plan, version, price }) => {
                    const copy = offerCopy(plan, version, locale);
                    return (
                    <label className={effectivePlan === plan.id ? "selected" : ""} key={plan.id}>
                      <input type="radio" name="subscription-plan" value={plan.id} checked={effectivePlan === plan.id} onChange={() => { setSelectedPlan(plan.id); setCodes(["", ""]); }} />
                      <span className="subscription-plan-copy">
                        <strong>{copy.title}</strong>
                        <small>{copy.description}</small>
                      </span>
                      <span className="subscription-plan-price">
                        <b>{money(price.amount_minor, price.currency, price.currency_exponent, locale)}</b>
                        {price.first_subscription_only && <small>{t("subscription.firstOffer")}</small>}
                      </span>
                      <span className="subscription-plan-check" aria-hidden="true">✓</span>
                    </label>
                    );
                  })}
                </div>
              </fieldset>}

              {step !== "plan" && selectedOffer && (
                <section className="subscription-order-summary" aria-labelledby="subscription-order-title">
                  <div className="subscription-order-plan">
                    <span>{t("subscription.selectedPlan")}</span>
                    <h2 id="subscription-order-title">{offerCopy(selectedOffer.plan, selectedOffer.version, locale).title}</h2>
                    <p>{offerCopy(selectedOffer.plan, selectedOffer.version, locale).description}</p>
                  </div>
                  <div className="subscription-order-price">
                    <span>{t("subscription.total")}</span>
                    <b>{money(selectedOffer.price.amount_minor, selectedOffer.price.currency, selectedOffer.price.currency_exponent, locale)}</b>
                    {selectedOffer.price.first_subscription_only && <small>{t("subscription.firstOffer")}</small>}
                  </div>
                  {step === "pay" && <button className="btn btn-soft compact subscription-change-plan" type="button" onClick={() => goToStep("plan")}>{t("subscription.changePlan")}</button>}
                </section>
              )}

              {step === "review" && selectedOffer && (
                <div className="subscription-review-step">
                  <ul className="subscription-benefits" aria-label={t("subscription.included")}>
                    {[offerCopy(selectedOffer.plan, selectedOffer.version, locale).description, t("subscription.allCollegesYears")]
                      .filter(Boolean)
                      .map((benefit, index) => <li key={`${benefit}-${index}`}><span aria-hidden="true">✓</span><span>{benefit}</span></li>)}
                  </ul>
                  <section className="subscription-how" aria-labelledby="subscription-how-title">
                    <h3 id="subscription-how-title">{t("subscription.howItWorks")}</h3>
                    <ol>
                      <li>{oneCardOnly ? t("subscription.howBuyOneCard") : t("subscription.howBuyCards")}</li>
                      <li>{t("subscription.howEnterCode")}</li>
                      <li>{t("subscription.howReview")}</li>
                    </ol>
                  </section>
                </div>
              )}

              {step !== "pay" && (
                <div className="subscription-step-actions">
                  {step === "review" && <button className="btn btn-soft" type="button" onClick={() => goToStep("plan")}>{t("subscription.back")}</button>}
                  <button className="btn btn-primary" type="submit" disabled={!selectedOffer}>{step === "plan" ? t("subscription.continueToDetails") : t("subscription.continueToPayment")}</button>
                </div>
              )}

              {step === "pay" && <div className="subscription-payment-step">
                <div className="subscription-payment-heading">
                  <span>{t("subscription.paymentStep")}</span>
                  <h2>{t("subscription.payLibyana")}</h2>
                </div>
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
              </div>}
              {step !== "pay" && notice && <p className="form-alert success" role="status">{notice}</p>}
            </form>
          )}
        </section>

        <ComingSoonPlans offers={comingSoon} t={t} />

        <div className="subscription-secondary-sections">
          <details className="subscription-secondary">
            <summary><span>{t("subscription.currentAccess")}</span><strong>{subscription?.plan_title || t("subscription.noPlan")}</strong></summary>
            {subscription?.status === "grace" && <p className="subscription-grace-note">{t("subscription.graceMessage", { count: subscription.remaining_days })}</p>}
            <dl className="subscription-facts">
              <div><dt>{t("subscription.currentPlan")}</dt><dd>{subscription?.plan_title || "—"}</dd></div>
              <div><dt>{subscription?.status === "trialing" ? t("subscription.trialExpiration") : t("subscription.subscriptionExpiration")}</dt><dd>{periodEnd ? formatDate(periodEnd, { dateStyle: "medium" }) : "—"}</dd></div>
              <div><dt>{t("subscription.remaining")}</dt><dd>{t("subscription.daysRemaining", { count: subscription?.remaining_days || 0 })}</dd></div>
              <div><dt>{t("subscription.paymentVerification")}</dt><dd>{paymentLabel}</dd></div>
            </dl>
          </details>

          <details className="subscription-secondary">
            <summary><span>{t("subscription.recentPayments")}</span><strong>{recentPayments.length}</strong></summary>
            {recentPayments.length ? (
              <div className="subscription-history-list">
                {recentPayments.map((payment) => <article className="list-row" key={payment.id}><div><h3>{payment.price_snapshot?.plan_title || t("subscription.payLibyana")}</h3><p>{money(payment.amount_minor, payment.currency, payment.currency_exponent, locale)} · {formatDateTime(payment.created_at)}</p><small>{paymentStatus(payment.manual_submission?.status, t)}</small>{payment.manual_submission?.status === "rejected" && <p className="subscription-rejection"><span>{t("subscription.paymentRejected")}: {payment.manual_submission?.rejection_reason}</span><a href="#libyana-payment">{t("subscription.retryPayment")}</a></p>}</div><span>{(payment.manual_submission?.recharge_codes_masked || []).join(" · ")}</span></article>)}
              </div>
            ) : <EmptyState title={t("subscription.noPayments")} text={t("subscription.noPaymentsBody")} />}
          </details>
        </div>
      </div>
    </Page>
  );
}
