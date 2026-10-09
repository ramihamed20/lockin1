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

function lydOffers(catalog) {
  return catalog.results.flatMap((product) => (product.plans || []).flatMap((plan) => {
    const version = plan.current_version;
    // The server sends each reader only the one price they would pay.
    const price = version?.prices?.find((item) => String(item.currency).toUpperCase() === "LYD");
    if (!version || !price || (price.first_subscription_only && !catalog.firstSubscriptionOfferEligible)) return [];
    return [{ product, plan, version, price }];
  })).sort((left, right) => Number(left.price.amount_minor) - Number(right.price.amount_minor));
}

// What the server would refuse is not offered: a term already covered, or a
// new plan while installments are still open.
function paidOffers(catalog) {
  return lydOffers(catalog).filter(({ price }) => !price.purchase_blocked_reason);
}

const MAX_CARDS = 5;

function addMonths(date, count) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + count);
  next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  return next;
}

function RechargeCodeFields({ codes, setCodes, oneCardOnly, idPrefix, t }) {
  const visible = oneCardOnly ? codes.slice(0, 1) : codes;
  function update(index, value) {
    setCodes(codes.map((code, position) => position === index ? value.replace(/\D/g, "").slice(0, 13) : code));
  }
  return (
    <div className="libyana-code-stack">
      {visible.map((code, index) => (
        <label className="field libyana-code-field" key={`${idPrefix}-${index}`}>
          <span>{index === 0 ? t("subscription.rechargeCode") : t("subscription.additionalRechargeCode")}</span>
          <input type="text" inputMode="numeric" autoComplete="off" dir="ltr" pattern="[0-9]{13}" minLength={13} maxLength={13} value={code} onChange={(event) => update(index, event.target.value)} placeholder={t("subscription.codePlaceholder")} aria-describedby={index === 0 ? `${idPrefix}-hint` : undefined} required={index === 0} />
          {index === 0 && <small id={`${idPrefix}-hint`}>{t("subscription.codeHint")}</small>}
        </label>
      ))}
      {!oneCardOnly && codes.length < MAX_CARDS && (
        <button className="btn btn-soft compact libyana-add-card" type="button" onClick={() => setCodes([...codes, ""])}>{t("subscription.addCard")}</button>
      )}
    </div>
  );
}

function codesReady(codes, oneCardOnly) {
  const used = oneCardOnly ? codes.slice(0, 1) : codes.filter(Boolean);
  return used.length > 0 && codes[0].length === 13 && used.every((code) => code.length === 13);
}

function submittedCodes(codes, oneCardOnly) {
  return oneCardOnly ? [codes[0]] : codes.filter(Boolean);
}

/**
 * A term bought in parts: what is paid, what is next, and -- when an
 * installment is late -- why access is paused and how to get it back.
 */
function InstallmentPlan({ plan, pendingManualReview, locale, t, onPay }) {
  const [codes, setCodes] = useState([""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const attemptKey = useRef("");
  if (!plan || plan.state === "completed" || plan.state === "cancelled") return null;
  const amount = (value) => money(value, plan.currency, plan.currency_exponent, locale);
  const next = plan.next_amount_minor != null ? amount(plan.next_amount_minor) : "";
  const tone = { overdue: "rejected", defaulted: "rejected", in_review: "pending" }[plan.state] || "approved";
  const message = {
    overdue: [t("subscription.installmentOverdueTitle"), t("subscription.installmentOverdueBody", { amount: next, date: plan.payment_window_ends_at ? formatDateTime(plan.payment_window_ends_at) : "—" })],
    defaulted: plan.pending_number != null
      ? [t("subscription.installmentReviewTitle"), t("subscription.installmentLateReviewBody")]
      : [t("subscription.installmentDefaultedTitle"), t("subscription.installmentDefaultedBody", { amount: next })],
    in_review: [t("subscription.installmentReviewTitle"), t("subscription.installmentReviewBody")],
    current: [t("subscription.installmentPlanTitle"), plan.next_due_at ? t("subscription.installmentNextBody", { amount: next, date: formatDate(plan.next_due_at, { dateStyle: "medium" }) }) : ""]
  }[plan.state] || [t("subscription.installmentPlanTitle"), ""];
  const canPay = plan.next_number != null && plan.pending_number == null && !pendingManualReview;

  async function pay(event) {
    event.preventDefault();
    if (submitting || !codesReady(codes, false)) return;
    setSubmitting(true);
    setError("");
    if (!attemptKey.current) attemptKey.current = generateIdempotencyKey();
    try {
      await onPay(plan.agreement_id, submittedCodes(codes, false), attemptKey.current);
      attemptKey.current = "";
      setCodes([""]);
    } catch (requestError) {
      setError(requestError.message || t("subscription.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`subscription-review-banner subscription-installments is-${tone}`} role={tone === "rejected" ? "alert" : "status"} aria-labelledby="installment-plan-title">
      <div>
        <h2 id="installment-plan-title">{message[0]}</h2>
        {message[1] && <p>{message[1]}</p>}
        <p className="subscription-installment-progress">{t("subscription.installmentProgress", { paid: amount(plan.paid_amount_minor), total: amount(plan.total_amount_minor) })}</p>
        <ol className="subscription-installment-list">
          {plan.installments.map((item) => (
            <li key={item.number} className={`is-${item.status}`}>
              <span>{amount(item.amount_minor)}</span>
              <span>{formatDate(item.due_at, { dateStyle: "medium" })}</span>
              <strong>{t(`subscription.installmentStatus.${item.status}`)}</strong>
            </li>
          ))}
        </ol>
        {canPay && (
          <form className="subscription-installment-pay" onSubmit={pay}>
            <h3>{t("subscription.payInstallment", { amount: next })}</h3>
            <RechargeCodeFields codes={codes} setCodes={setCodes} oneCardOnly={false} idPrefix="installment-code" t={t} />
            {error && <p className="form-alert error" role="alert">{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={submitting || !codesReady(codes, false)}>{submitting ? t("subscription.submitting") : t("subscription.submitCard")}</button>
          </form>
        )}
      </div>
    </section>
  );
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

// What each dentistry price cost before the 2026-10-09 reduction, shown struck
// through beside the new one. Keyed by price code; amounts are in minor units.
const PREVIOUS_PRICE_MINOR = {
  dentistry_pre_midterm_30_lyd: 45_000,
  dentistry_pre_midterm_loyalty_25_lyd: 35_000,
  dentistry_full_year_80_lyd: 90_000,
  dentistry_full_year_loyalty_70_lyd: 90_000,
  dentistry_full_year_upgrade_20_lyd: 40_000
};

function isFiveLyd(price) {
  return Number(price?.amount_minor) === 5 * (10 ** Number(price?.currency_exponent || 0));
}

const PLAN_COPY = {
  lockin_first_month: { en: ["First month", "One-month subscription"], ar: ["الشهر الأول", "اشتراك لمدة شهر"] },
  lockin_two_months: { en: ["Two months", "Two-month subscription"], ar: ["شهران", "اشتراك لمدة شهرين"] },
  lockin_three_months: { en: ["Three months", "Three-month subscription"], ar: ["3 أشهر", "اشتراك لمدة ثلاثة أشهر"] },
  lockin_four_months: { en: ["Four months", "Four-month subscription"], ar: ["4 أشهر", "اشتراك لمدة أربعة أشهر"] },
  dentistry_pre_midterm: { en: ["Pre-midterm", "Access until 25 January 2027"], ar: ["قبل النصفي", "اشتراك حتى 25 يناير 2027"] },
  dentistry_post_midterm: { en: ["Post-midterm", "Access until 21 May 2027"], ar: ["بعد النصفي", "اشتراك حتى 21 مايو 2027"] },
  dentistry_full_year: { en: ["Full year", "Access until 21 May 2027"], ar: ["العام الكامل", "اشتراك حتى 21 مايو 2027"] }
};

function priceBadge(price, t) {
  if (price.first_subscription_only) return t("subscription.firstOffer");
  if (price.eligibility === "loyalty_2026") return t("subscription.loyaltyPrice");
  if (price.eligibility === "four_month_upgrade") return t("subscription.upgradePrice");
  return "";
}

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
function ReviewBanner({ review, t, onRetry = undefined }) {
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
  const [codes, setCodes] = useState([""]);
  const [payInInstallments, setPayInInstallments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Survives re-renders and failed submissions; cleared only once an attempt
  // has actually been accepted. See submitPayment.
  const paymentAttemptKey = useRef("");
  const offers = useMemo(() => details.data ? paidOffers(details.data.catalog) : [], [details.data]);
  const coveredOffers = useMemo(() => details.data ? lydOffers(details.data.catalog).length - offers.length : 0, [details.data, offers]);
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

  if (details.loading) return <Page width="reading" title={t("subscription.title")} showHeading><LoadingPanel variant="list" /></Page>;
  if (details.error) return <Page width="reading" title={t("subscription.title")} showHeading><ErrorPanel message={details.error} onRetry={details.reload} /></Page>;

  const { subscription, directAccess, accessExempt } = subscriptionSession;
  const { payments, catalog } = details.data;
  const recentPayments = payments.filter((payment) => payment.method === "libyana").slice(0, 5);
  const selectedOffer = offers.find(({ plan }) => plan.id === effectivePlan) || offers[0];
  const oneCardOnly = isFiveLyd(selectedOffer?.price);
  const installmentsOffered = Boolean(selectedOffer?.price?.installments_available);
  const installmentMode = installmentsOffered && payInInstallments;
  const installmentAmounts = selectedOffer?.price?.installment_amounts_minor || [];
  const dueNowMinor = installmentMode ? installmentAmounts[0] : selectedOffer?.price?.amount_minor;
  const installmentPlan = subscription?.installment_plan || null;
  const installmentHold = installmentPlan?.state === "overdue" || installmentPlan?.state === "defaulted";
  // Asked of the access session, not of the payment list this screen loaded
  // when it opened. The list cannot know that a reviewer decided thirty seconds
  // ago, so readers whose card was approved -- or rejected -- sat in front of
  // "a payment is already under review" with the form hidden, unable to pay and
  // with nothing on the screen telling them why.
  const pendingManualReview = subscriptionSession.pendingManualPayment;
  // Whether a plan can be bought now is decided per price by the server (a
  // term already covered, installments still open, the legacy seven-day
  // renewal window); only offers it would accept reach this screen.
  const canSubmit = review?.status === "rejected" || !pendingManualReview;
  const periodEnd = subscription?.status === "trialing"
    ? subscription?.trial_ends_at
    : subscription?.current_period_ends_at;
  const paymentLabel = subscription?.payment_verification === "provisional"
    ? t("subscription.pending")
    : subscription?.payment_verification === "verified"
      ? t("subscription.verified")
      : "—";

  if (directAccess || accessExempt) {
    const freeUntil = subscription?.free_access_until || "";
    const heading = freeUntil ? t("subscription.freeAccess") : t("subscription.directAccess");
    const body = freeUntil
      ? t("subscription.freeAccessBody", { date: formatDate(freeUntil, { dateStyle: "long" }) })
      : t("subscription.directAccessBody");
    return (
      <Page title={heading} subtitle={body}>
        <section className="subscription-saved-banner subscription-direct-access">
          <div><h2>{heading}</h2><p>{body}</p></div>
        </section>
        <ComingSoonPlans offers={comingSoon} t={t} />
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
        submittedCodes(codes, oneCardOnly),
        paymentAttemptKey.current,
        installmentMode
      );
      paymentAttemptKey.current = "";
      subscriptionSession.setAuthoritativeSubscription(result.subscription);
      setCodes([""]);
      setPayInInstallments(false);
      setNotice(t("subscription.submitted"));
      details.reload();
    } catch (requestError) {
      setError(requestError.message || t("subscription.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function payInstallment(agreementId, rechargeCodes, attemptKey) {
    setNotice("");
    const result = await billingApi.payInstallment(agreementId, rechargeCodes, attemptKey);
    subscriptionSession.setAuthoritativeSubscription(result.subscription);
    setNotice(t("subscription.installmentSubmitted"));
    details.reload();
  }

  return (
    <Page title={t("subscription.title")} headingHandled>
      <div className="subscription-premium subscription-v2">
        {/* While an installment holds access back, the review banner's "your
            access is on" is not true; the installment panel says what is. */}
        {!installmentHold && <ReviewBanner review={review} t={t} />}

        <InstallmentPlan plan={installmentPlan} pendingManualReview={pendingManualReview} locale={locale} t={t} onPay={payInstallment} />

        {!subscription?.access_allowed && !pendingManualReview && !installmentHold && (
          <section className="subscription-review-banner is-expired" role="status">
            <div><h2>{t("subscription.expiredTitle")}</h2><p>{t("subscription.expiredBody")}</p></div>
            <a className="btn btn-primary" href="#libyana-payment">{t("subscription.renew")}</a>
          </section>
        )}

        {subscription?.early_renewal_available && (
          <section className="subscription-saved-banner subscription-early-renewal">
            <div><h2>{t("subscription.earlyRenewalDays", { count: subscription.remaining_days })}</h2><p>{t("subscription.earlyRenewalPromise")}</p></div>
            <a className="btn btn-primary" href="#libyana-payment">{t("subscription.renew")}</a>
          </section>
        )}

        {/* What you have comes first; what you could buy follows it. The
            facts that used to sit in a collapsed "Current access" block are
            the card itself now. */}
        <header className="subscription-premium-header">
          <div>
            <h1>{t("subscription.title")}</h1>
          </div>
          <div className="subscription-current-summary">
            <span>{t("subscription.currentPlan")}</span>
            <strong>{PLAN_COPY[subscription?.plan_code]?.[locale]?.[0] || subscription?.plan_title || t("subscription.noPlan")}</strong>
            <SubscriptionStatus subscription={subscription} compact />
            {subscription && <dl className="subscription-v2-facts">
              <div><dt>{subscription.status === "trialing" ? t("subscription.trialExpiration") : t("subscription.subscriptionExpiration")}</dt><dd>{periodEnd ? formatDate(periodEnd, { dateStyle: "medium" }) : "—"}</dd></div>
              <div><dt>{t("subscription.remaining")}</dt><dd>{t("subscription.daysRemaining", { count: subscription.remaining_days || 0 })}</dd></div>
              <div><dt>{t("subscription.paymentVerification")}</dt><dd>{paymentLabel}</dd></div>
            </dl>}
            {subscription?.status === "grace" && <p className="subscription-grace-note">{t("subscription.graceMessage", { count: subscription.remaining_days })}</p>}
          </div>
        </header>

        <section className="subscription-purchase" id="libyana-payment" dir={direction} aria-labelledby="subscription-plan-heading">
          {!offers.length && coveredOffers > 0 ? (
            <div className="subscription-payment-unavailable">
              <h2>{t("subscription.nothingToBuyTitle")}</h2>
              <p>{t("subscription.nothingToBuyBody")}</p>
              {notice && <p className="form-alert success" role="status">{notice}</p>}
            </div>
          ) : !catalog.manualPaymentAvailable || !offers.length ? (
            <EmptyState title={t("subscription.noOffers")} text={t("subscription.noOffersBody")} />
          ) : !canSubmit ? (
            <div className="subscription-payment-unavailable">
              <h2>{pendingManualReview ? t("subscription.pendingPaymentTitle") : t("subscription.renewalNotYet")}</h2>
              <p>{pendingManualReview ? t("subscription.pendingPaymentBody") : t("subscription.renewalNotYetBody")}</p>
            </div>
          ) : (
            <form className="subscription-checkout subscription-quick-checkout" onSubmit={submitPayment}>
              <h2 className="subscription-v2-heading" id="subscription-plan-heading">{t("subscription.choosePlan")}</h2>
              <fieldset className="subscription-plan-options">
                <legend className="visually-hidden">{t("subscription.choosePlan")}</legend>
                <div className="subscription-plan-grid">
                  {offers.map(({ plan, version, price }) => {
                    const copy = offerCopy(plan, version, locale);
                    return (
                    <label className={effectivePlan === plan.id ? "selected" : ""} key={plan.id}>
                      <input type="radio" name="subscription-plan" value={plan.id} aria-label={copy.title} checked={effectivePlan === plan.id} onChange={() => { setSelectedPlan(plan.id); setCodes([""]); setPayInInstallments(false); setError(""); }} />
                      <span className="subscription-plan-copy">
                        <strong>{copy.title}</strong>
                        <small>{copy.description}</small>
                      </span>
                      <span className="subscription-plan-price">
                        {PREVIOUS_PRICE_MINOR[price.code] && <s className="subscription-plan-was"><span className="visually-hidden">{t("subscription.wasPrice")} </span>{money(PREVIOUS_PRICE_MINOR[price.code], price.currency, price.currency_exponent, locale)}</s>}
                        <b>{money(price.amount_minor, price.currency, price.currency_exponent, locale)}</b>
                        {priceBadge(price, t) && <small>{priceBadge(price, t)}</small>}
                      </span>
                      <span className="subscription-plan-check" aria-hidden="true">✓</span>
                    </label>
                    );
                  })}
                </div>
              </fieldset>

              {selectedOffer && <div className="subscription-pay-box">
                {installmentsOffered && (
                  <fieldset className="subscription-pay-toggle">
                    <legend className="visually-hidden">{t("subscription.howToPay")}</legend>
                    <label className={!payInInstallments ? "selected" : ""}>
                      <input type="radio" name="subscription-payment-option" aria-label={t("subscription.payOnce")} checked={!payInInstallments} onChange={() => setPayInInstallments(false)} />
                      <strong>{t("subscription.payOnce")}</strong>
                    </label>
                    <label className={payInInstallments ? "selected" : ""}>
                      <input type="radio" name="subscription-payment-option" aria-label={t("subscription.payInInstallments")} checked={payInInstallments} onChange={() => setPayInInstallments(true)} />
                      <strong>{t("subscription.payInInstallments")}</strong>
                    </label>
                  </fieldset>
                )}
                {installmentMode && (
                  <ol className="subscription-installment-preview" aria-label={t("subscription.payInInstallments")}>
                    {installmentAmounts.map((value, index) => <li key={index}><b>{money(value, selectedOffer.price.currency, selectedOffer.price.currency_exponent, locale)}</b><small>{index === 0 ? t("subscription.installmentNow") : formatDate(addMonths(new Date(), index), { dateStyle: "medium" })}</small></li>)}
                  </ol>
                )}
                <RechargeCodeFields codes={codes} setCodes={setCodes} oneCardOnly={oneCardOnly} idPrefix="libyana-code" t={t} />
                {error && <p className="form-alert error" role="alert">{error}</p>}
                {notice && <p className="form-alert success" role="status">{notice}</p>}
                <button className="btn btn-primary libyana-submit" type="submit" disabled={submitting || !codesReady(codes, oneCardOnly)}>
                  {submitting ? t("subscription.submitting") : t("subscription.payAmount", { amount: money(dueNowMinor, selectedOffer.price.currency, selectedOffer.price.currency_exponent, locale) })}
                </button>
                <p className="subscription-terms-note">
                  {t("subscription.agreeToTerms")} <a href="#/terms">{t("subscription.termsLink")}</a>
                </p>
              </div>}
            </form>
          )}
        </section>

        <ComingSoonPlans offers={comingSoon} t={t} />

        <p className="subscription-terms-footer"><a href="#/terms">{t("subscription.termsFooter")}</a></p>

        <div className="subscription-secondary-sections">
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
