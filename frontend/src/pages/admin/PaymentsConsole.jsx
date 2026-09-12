/**
 * The payments review console.
 *
 * A reviewer opens this screen to answer one question — what is waiting on me,
 * and is this card genuine — so the queue leads, the filters are one click
 * each, and every row carries the four facts a decision needs before the detail
 * panel is even opened: who, how much, which plan, how long they have waited.
 *
 * Two rules hold the screen together:
 *
 *  - **No action is offered that cannot be taken.** An already-reviewed payment
 *    shows its outcome and who recorded it, never an approve button that would
 *    be refused by the server.
 *  - **A decision refreshes what it changed.** The list, the queue counters and
 *    the open payment are all re-read from the server after a review, because
 *    the review moves a payment between the very filters the reviewer is
 *    looking at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { formatDateTime, formatNumber } from "../../lib/i18n.js";
import { Icon } from "../../lib/icons.jsx";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.jsx";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";

const SEARCH_DEBOUNCE_MS = 300;

/** Queue-first: the filter a reviewer needs most is the one they land on. */
export const PAYMENT_FILTERS = [
  ["pending_review", "Awaiting review", "Manual cards a reviewer has not decided yet"],
  ["", "All payments", "Every payment, however it was made"],
  ["approved", "Approved", "Manual cards verified by a reviewer"],
  ["rejected", "Rejected", "Manual cards a reviewer refused"],
  ["succeeded", "Succeeded", "Payments the ledger counts as collected"],
  ["failed", "Failed", "Payments that did not complete"],
  ["refunded", "Refunded", "Fully refunded payments"]
];

const PAYMENT_SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Longest waiting"],
  ["amount_high", "Largest amount"],
  ["amount_low", "Smallest amount"]
];

/**
 * The single state a row should be read by.
 *
 * A manual card has two statuses — the payment's and the review's — and showing
 * both invites the reader to reconcile them. The review is the one a person
 * acted on, so it wins wherever it exists.
 */
export function paymentState(payment) {
  const review = payment?.manual_submission?.status;
  if (review === "pending") return { code: "pending", label: "Awaiting review", tone: "warning" };
  if (review === "approved") return { code: "approved", label: "Approved", tone: "healthy" };
  if (review === "rejected") return { code: "rejected", label: "Rejected", tone: "danger" };
  if (review === "cancelled") return { code: "cancelled", label: "Cancelled", tone: "neutral" };
  const tones = {
    succeeded: ["Succeeded", "healthy"],
    refunded: ["Refunded", "neutral"],
    partially_refunded: ["Partly refunded", "neutral"],
    failed: ["Failed", "danger"],
    cancelled: ["Cancelled", "neutral"],
    pending: ["Pending", "warning"],
    initiated: ["Initiated", "neutral"]
  };
  const [label, tone] = tones[payment?.status] || ["Unknown", "neutral"];
  return { code: payment?.status || "unknown", label, tone };
}

export function subscriptionState(subscription) {
  const tones = {
    active: ["Active", "healthy"],
    trialing: ["Free trial", "info"],
    grace: ["Renewal period", "warning"],
    pending: ["Awaiting payment", "warning"],
    expired: ["Expired", "danger"],
    cancelled: ["Cancelled", "neutral"],
    suspended: ["Suspended", "danger"],
    refunded: ["Refunded", "neutral"]
  };
  const [label, tone] = tones[subscription?.status] || ["No subscription", "neutral"];
  return { code: subscription?.status || "none", label, tone };
}

/** "3 days" — how long a card has been waiting, in the units a person uses. */
export function waitedFor(since, now = Date.now()) {
  const started = Date.parse(since || "");
  if (!Number.isFinite(started)) return "";
  const minutes = Math.max(0, Math.round((now - started) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function money(value, currency = "LYD", exponent = 3) {
  const amount = Number(value) / (10 ** Number(exponent));
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-LY", {
      style: "currency",
      currency: String(currency || "LYD").toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: Number(exponent)
    }).format(amount);
  } catch {
    return `${amount} ${String(currency || "LYD").toUpperCase()}`;
  }
}

function when(value) {
  return value ? formatDateTime(value) : "—";
}

function humanize(value) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatusBadge({ state, size = "" }) {
  return (
    <span className={`ops-badge is-${state.tone}${size ? ` ${size}` : ""}`}>
      <span className="ops-badge-dot" aria-hidden="true" />
      {state.label}
    </span>
  );
}

function Metric({ label, value, hint, tone = "neutral", icon }) {
  return (
    <article className={`ops-metric is-${tone}`}>
      <span className="ops-metric-icon"><Icon name={icon} size={18} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </article>
  );
}

function FilterChips({ value, onChange, counts }) {
  return (
    <div className="ops-chips" role="group" aria-label="Payment status filter">
      {PAYMENT_FILTERS.map(([code, label, description]) => (
        <button
          key={code || "all"}
          type="button"
          className={`ops-chip${value === code ? " is-selected" : ""}`}
          aria-pressed={value === code}
          title={description}
          onClick={() => onChange(code)}
        >
          {label}
          {code === "pending_review" && counts?.pending > 0 && (
            <span className="ops-chip-count">{formatNumber(counts.pending)}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A search box that reports only when the reviewer stops typing.
 *
 * Sending a request per keystroke re-renders the list under the cursor and
 * makes the count flicker through answers to queries nobody asked.
 */
function DebouncedSearch({ label, value, onChange, placeholder }) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (draft === value) return undefined;
    const timer = window.setTimeout(() => onChangeRef.current(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, value]);
  return (
    <label className="field ops-search">
      <span>{label}</span>
      <input type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function PaymentRow({ payment, selected, onSelect }) {
  const state = paymentState(payment);
  const manual = payment.manual_submission;
  const person = payment.user.full_name || payment.user.username || payment.user.email || "Unknown account";
  const waiting = state.code === "pending" ? waitedFor(manual?.submitted_at) : "";
  return (
    <tr className={selected ? "is-selected" : ""}>
      <th scope="row">
        <button type="button" className="ops-row-link" onClick={() => onSelect(payment.id)} aria-expanded={selected}>
          <b>{person}</b>
          <small>
            {payment.user.username ? `@${payment.user.username}` : ""}
            {payment.user.username && payment.user.email ? " · " : ""}
            {payment.user.email || ""}
          </small>
        </button>
      </th>
      <td><StatusBadge state={state} /></td>
      <td className="ops-cell-plan">{payment.plan_title || payment.plan_code || "—"}</td>
      <td className="ops-cell-amount">{money(payment.amount_minor, payment.currency, payment.currency_exponent)}</td>
      <td>{humanize(payment.method)}</td>
      <td>
        {when(manual?.submitted_at || payment.created_at)}
        {waiting && <small className="ops-cell-note">waiting {waiting}</small>}
      </td>
      <td>
        {manual?.reviewed_at ? (
          <>
            {when(manual.reviewed_at)}
            <small className="ops-cell-note">{manual.reviewed_by_name || "Reviewer"}</small>
          </>
        ) : "—"}
      </td>
    </tr>
  );
}

/** Approve or reject, with the evidence a reviewer needs next to the buttons. */
function ReviewActions({ payment, canManage, onReviewed }) {
  const submission = payment.manual_submission;
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function review() {
    if (!decision) return;
    setPending(true);
    setError(null);
    try {
      await adminControlApi.reviewManualPayment(payment.id, decision, reason);
      setDecision(null);
      setReason("");
      onReviewed(decision === "approve"
        ? "Payment approved. The subscription is verified and the reader has access."
        : "Payment rejected. No access was granted and the reader can submit another card.");
    } catch (requestError) {
      setError(requestError);
      setDecision(null);
    } finally {
      setPending(false);
    }
  }

  const codes = submission.recharge_codes || submission.recharge_codes_masked || [];
  const reviewable = submission.status === "pending";

  return (
    <section className="ops-review" aria-labelledby="ops-review-title">
      <div className="ops-panel-head">
        <h3 id="ops-review-title">Recharge card</h3>
        <StatusBadge state={paymentState(payment)} />
      </div>

      <dl className="ops-facts">
        <div>
          <dt>Card {codes.length > 1 ? "numbers" : "number"}</dt>
          <dd className="ops-code" dir="ltr">{codes.join(" · ") || "—"}</dd>
        </div>
        <div>
          <dt>Reserved period</dt>
          <dd>{when(submission.subscription_period_started_at)} → {when(submission.subscription_period_ends_at)}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{when(submission.submitted_at)}</dd>
        </div>
        <div>
          <dt>Processed by</dt>
          <dd>{submission.reviewed_by_name ? `${submission.reviewed_by_name} · ${when(submission.reviewed_at)}` : "Not yet reviewed"}</dd>
        </div>
      </dl>

      {submission.is_early_renewal && (
        <p className="ops-note is-info">
          Early renewal. Approving adds this period after the reader&apos;s current one; rejecting removes only the
          added segment.
        </p>
      )}
      {submission.repeat_submission_count > 0 && (
        <p className="ops-note is-warning">
          This card number has been submitted {submission.repeat_submission_count} time
          {submission.repeat_submission_count === 1 ? "" : "s"} before. Check the earlier submission before deciding.
        </p>
      )}
      {submission.rejection_reason && (
        <p className="ops-note is-danger"><strong>Rejection reason:</strong> {submission.rejection_reason}</p>
      )}
      {error && <p className="form-alert error" role="alert">{error.message}</p>}

      {!canManage && reviewable && (
        <p className="ops-note">Reviewing a payment needs the payments management capability.</p>
      )}

      {canManage && reviewable && (
        <div className="ops-review-actions">
          <label className="field">
            <span>Review reason</span>
            <input
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What did you check? Saved to immutable history."
              aria-describedby="ops-review-reason-hint"
            />
            <small id="ops-review-reason-hint">At least 3 characters. Shown to the reader when a card is rejected.</small>
          </label>
          <div className="ops-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || reason.trim().length < 3}
              onClick={() => setDecision("approve")}
            >
              {pending ? "Working…" : "Approve payment"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() => setDecision("reject")}
            >
              Reject payment
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(decision)}
        busy={pending}
        title={decision === "approve" ? "Approve this payment?" : "Reject this payment?"}
        message={decision === "approve"
          ? "The payment is marked succeeded, the subscription is verified for the period already reserved at submission, and the reader keeps access. The period is not extended a second time if this is repeated."
          : "The payment is marked failed, the provisional access granted at submission is removed, and the reader is told why and invited to submit another card."}
        confirmLabel={pending ? "Working…" : decision === "approve" ? "Approve payment" : "Reject payment"}
        onCancel={() => setDecision(null)}
        onConfirm={review}
      />
    </section>
  );
}

/**
 * Refunds and dual-controlled corrections, for payments taken by a provider.
 *
 * A manual card is settled by approving or rejecting it, so these are offered
 * only where they are the actual mechanism. Payment status is never edited
 * directly: a correction is a request that a second administrator reviews
 * against provider evidence.
 */
function ProviderPaymentActions({ payment, onChanged }) {
  const [amount, setAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [requestedStatus, setRequestedStatus] = useState("failed");
  const [reference, setReference] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [reviewReasons, setReviewReasons] = useState({});
  const [pending, setPending] = useState("");
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);

  async function run(kind, action) {
    setPending(kind);
    setError(null);
    try {
      await action();
      setConfirm(null);
      onChanged();
    } catch (requestError) {
      setError(requestError);
      setConfirm(null);
    } finally {
      setPending("");
    }
  }

  const corrections = payment.status_corrections || [];

  return (
    <section className="ops-review" aria-labelledby="ops-provider-title">
      <div className="ops-panel-head"><h3 id="ops-provider-title">Refunds and corrections</h3></div>
      <p className="ops-note">
        Payment status is never edited directly. A correction must cite provider evidence and a different
        administrator must approve it.
      </p>
      {error && <p className="form-alert error" role="alert">{error.message}</p>}

      <form className="ops-form" onSubmit={(event) => { event.preventDefault(); setConfirm({ kind: "refund" }); }}>
        <label className="field">
          <span>Refund amount in minor units</span>
          <input inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label className="field">
          <span>Administrative reason</span>
          <input minLength={8} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} required />
        </label>
        <button className="btn btn-outline" type="submit" disabled={Boolean(pending) || refundReason.trim().length < 8}>
          {pending === "refund" ? "Requesting…" : "Request refund"}
        </button>
      </form>

      <form className="ops-form" onSubmit={(event) => { event.preventDefault(); setConfirm({ kind: "correction" }); }}>
        <label className="field">
          <span>Requested status</span>
          <select value={requestedStatus} onChange={(event) => setRequestedStatus(event.target.value)}>
            {["succeeded", "failed", "cancelled"].map((value) => <option value={value} key={value}>{humanize(value)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Verified provider reference</span>
          <input minLength={3} value={reference} onChange={(event) => setReference(event.target.value)} required />
        </label>
        <label className="field">
          <span>Request reason</span>
          <input minLength={8} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} required />
        </label>
        <button
          className="btn btn-outline"
          type="submit"
          disabled={Boolean(pending) || reference.trim().length < 3 || correctionReason.trim().length < 8}
        >
          {pending === "correction" ? "Submitting…" : "Request independent review"}
        </button>
      </form>

      {corrections.map((correction) => (
        <article className="ops-correction" key={correction.id}>
          <div>
            <h4>{humanize(correction.requested_status)} correction · {humanize(correction.status)}</h4>
            <p>{correction.requested_by_name || "Operator"} · {when(correction.created_at)}</p>
            <small>{correction.reason}</small>
          </div>
          {correction.status === "pending" && (
            <div className="ops-correction-review">
              <label className="field">
                <span>Independent review reason</span>
                <input
                  minLength={8}
                  value={reviewReasons[correction.id] || ""}
                  onChange={(event) => setReviewReasons({ ...reviewReasons, [correction.id]: event.target.value })}
                />
              </label>
              <div className="ops-actions">
                <button
                  className="btn btn-soft compact"
                  type="button"
                  disabled={Boolean(pending) || (reviewReasons[correction.id] || "").trim().length < 8}
                  onClick={() => setConfirm({ kind: "review", id: correction.id, decision: "approve" })}
                >
                  Approve
                </button>
                <button
                  className="btn btn-danger compact"
                  type="button"
                  disabled={Boolean(pending) || (reviewReasons[correction.id] || "").trim().length < 8}
                  onClick={() => setConfirm({ kind: "review", id: correction.id, decision: "reject" })}
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </article>
      ))}

      <ConfirmDialog
        open={Boolean(confirm)}
        busy={Boolean(pending)}
        title={confirm?.kind === "refund" ? "Request refund"
          : confirm?.kind === "correction" ? "Request independent correction review"
            : "Confirm correction review"}
        message={confirm?.kind === "refund"
          ? "Lock-in will validate the refundable balance, call the configured provider, and audit this request."
          : confirm?.kind === "correction"
            ? "This does not change payment status. It creates an audited request another administrator must review."
            : "Lock-in will enforce separation of duties, validate the payment transition, and record this review."}
        confirmLabel={pending ? "Working…" : "Confirm"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "refund") {
            return run("refund", () => adminControlApi.refund(payment.id, { amountMinor: amount, refundReason }));
          }
          if (confirm?.kind === "correction") {
            return run("correction", () => adminControlApi.requestPaymentCorrection(payment.id, {
              requestedStatus, providerReference: reference, reason: correctionReason
            }));
          }
          return run(confirm.id, () => adminControlApi.reviewPaymentCorrection(confirm.id, {
            decision: confirm.decision, reason: reviewReasons[confirm.id] || ""
          }));
        }}
      />
    </section>
  );
}

function PaymentDetail({ paymentId, canManage, onReviewed, onClose }) {
  const data = useAsyncData(() => adminControlApi.purchase(paymentId), [paymentId]);
  const [notice, setNotice] = useState("");

  if (data.loading) return <section className="panel ops-detail"><LoadingPanel /></section>;
  if (data.error) return <section className="panel ops-detail"><ErrorPanel message={data.error} onRetry={data.reload} /></section>;

  const payment = data.data;
  const manual = payment.manual_submission;
  const education = payment.user.education || {};
  const subscription = payment.subscription;

  function reviewed(message = "") {
    setNotice(message);
    data.reload();
    onReviewed?.();
  }

  return (
    <section className="panel ops-detail" aria-label="Payment detail">
      <div className="ops-panel-head">
        <div>
          <p className="eyebrow">{payment.method === "libyana" ? "Libyana recharge card" : "Payment"}</p>
          <h2>{money(payment.amount_minor, payment.currency, payment.currency_exponent)}</h2>
        </div>
        <div className="ops-actions">
          <StatusBadge state={paymentState(payment)} />
          <button className="btn btn-soft compact" type="button" onClick={onClose}>Close</button>
        </div>
      </div>

      {notice && <p className="form-alert success" role="status">{notice}</p>}

      <dl className="ops-facts">
        <div><dt>Student</dt><dd>{payment.user.full_name || "—"}</dd></div>
        <div><dt>Username</dt><dd>{payment.user.username ? `@${payment.user.username}` : "—"}</dd></div>
        <div><dt>Email</dt><dd>{payment.user.email || "—"}</dd></div>
        <div><dt>College</dt><dd>{education.program_name_en || education.program_name_ar || "—"}</dd></div>
        <div><dt>Year</dt><dd>{education.cohort_name_en || education.cohort_name_ar || "—"}</dd></div>
        <div><dt>Plan</dt><dd>{payment.plan_title || payment.plan_code || "—"}</dd></div>
        <div><dt>Method</dt><dd>{humanize(payment.method)}</dd></div>
        <div><dt>Reference</dt><dd className="ops-code" dir="ltr">{String(payment.id).slice(0, 8)}</dd></div>
        <div><dt>Subscription</dt><dd><StatusBadge state={subscriptionState(subscription)} size="compact" /></dd></div>
        <div><dt>Subscription expiry</dt><dd>{when(subscription?.current_period_ends_at || subscription?.trial_ends_at)}</dd></div>
        <div><dt>Verification</dt><dd>{humanize(subscription?.payment_verification)}</dd></div>
        <div><dt>Invoice</dt><dd>{payment.invoice_number || "—"}</dd></div>
      </dl>

      {manual && <ReviewActions payment={payment} canManage={canManage} onReviewed={reviewed} />}
      {!manual && canManage && <ProviderPaymentActions payment={payment} onChanged={reviewed} />}
      {!manual && !canManage && (
        <p className="ops-note">This payment was taken by an online provider. Changing it needs the payments management capability.</p>
      )}

      <section className="ops-history" aria-labelledby="ops-history-title">
        <h3 id="ops-history-title">History</h3>
        <ol>
          {(payment.transitions || []).map((entry) => (
            <li key={entry.id}>
              <span>{humanize(entry.from_status || "created")} → {humanize(entry.to_status)}</span>
              <small>{when(entry.effective_at)}</small>
            </li>
          ))}
          {(payment.refunds || []).map((item) => (
            <li key={item.id}>
              <span>Refund {money(item.amount_minor, payment.currency, payment.currency_exponent)}</span>
              <small>{humanize(item.status)}</small>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

export default function PaymentsConsole({ canManage }) {
  const [status, setStatus] = useState("pending_review");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const list = useAsyncData(
    () => adminControlApi.purchases({ page, query, status, sort }),
    [page, query, status, sort]
  );
  const summary = useAsyncData(() => adminControlApi.analytics(), []);

  const reload = useCallback(() => {
    list.reload();
    summary.reload();
  }, [list, summary]);

  const reviews = summary.data?.manual_reviews;
  const revenue = summary.data?.revenue;
  const oldestWait = useMemo(() => waitedFor(reviews?.oldest_pending_at), [reviews?.oldest_pending_at]);

  function changeStatus(next) {
    setStatus(next);
    setPage(1);
    setSelected(null);
  }

  return (
    <section className="operations-workspace">
      <p className="ops-lead">Review Libyana recharge cards and follow every payment through to the access it grants.</p>
      <section className="ops-metrics" aria-label="Payment summary">
        <Metric
          label="Awaiting review"
          value={reviews ? formatNumber(reviews.pending) : "—"}
          hint={reviews?.pending ? `Longest waiting ${oldestWait}` : "Nothing is waiting on you"}
          tone={reviews?.pending ? "warning" : "healthy"}
          icon="clock"
        />
        <Metric label="Approved" value={reviews ? formatNumber(reviews.approved) : "—"} hint="In the reporting period" tone="healthy" icon="check" />
        <Metric label="Rejected" value={reviews ? formatNumber(reviews.rejected) : "—"} hint="In the reporting period" tone="danger" icon="alert-triangle" />
        <Metric label="Collected" value={revenue ? money(revenue.gross_minor) : "—"} hint="Successful payments" tone="neutral" icon="coins" />
      </section>

      <div className="ops-toolbar">
        <FilterChips value={status} onChange={changeStatus} counts={reviews} />
        <div className="ops-toolbar-inputs">
          <DebouncedSearch
            label="Search"
            value={query}
            onChange={(value) => { setQuery(value); setPage(1); }}
            placeholder="Name, username, email, plan or reference"
          />
          <label className="field">
            <span>Sort</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
              {PAYMENT_SORTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {list.loading ? <LoadingPanel variant="list" /> : list.error ? (
        <ErrorPanel message={list.error} onRetry={list.reload} />
      ) : (
        <section className="panel ops-table-panel">
          <div className="ops-panel-head">
            <h2>{PAYMENT_FILTERS.find(([code]) => code === status)?.[1] || "Payments"}</h2>
            <span>{formatNumber(list.data.count)} {list.data.count === 1 ? "payment" : "payments"}</span>
          </div>
          {list.data.results.length ? (
            <div className="ops-table-scroll">
              <table className="ops-table">
                <caption className="visually-hidden">
                  Payments matching the selected filter, sorted by {PAYMENT_SORTS.find(([value]) => value === sort)?.[1]}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Status</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Method</th>
                    <th scope="col">Submitted</th>
                    <th scope="col">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.results.map((payment) => (
                    <PaymentRow
                      key={payment.id}
                      payment={payment}
                      selected={selected === payment.id}
                      onSelect={setSelected}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={status === "pending_review" ? "The review queue is empty" : "No payments found"}
              text={status === "pending_review"
                ? "Every submitted recharge card has been decided. New submissions appear here straight away."
                : "No payment matched this filter and search."}
            />
          )}
          {list.data.count > list.data.results.length && (
            <div className="ops-pager">
              <button className="btn btn-soft compact" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page}</span>
              <button className="btn btn-soft compact" type="button" disabled={page * 25 >= list.data.count} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </section>
      )}

      {selected && (
        <PaymentDetail
          paymentId={selected}
          canManage={canManage}
          onReviewed={reload}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
