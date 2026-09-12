/**
 * The subscription lifecycle console.
 *
 * The payments console answers "did this card pay"; this one answers "what
 * access does this account actually hold, and until when". They share their
 * badges and table shell on purpose: the same subscription appears in both, and
 * a reviewer moving between them should not have to re-learn what a colour
 * means.
 */
import { useCallback, useState } from "react";
import { adminControlApi } from "../../api/adminControl.js";
import { useAsyncData } from "../../hooks/useAsyncData.js";
import { formatDateTime, formatNumber } from "../../lib/i18n.js";
import { Icon } from "../../lib/icons.jsx";
import { ConfirmDialog } from "../../components/shared/ConfirmDialog.jsx";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { StatusBadge, money, subscriptionState } from "./PaymentsConsole.jsx";

const SUBSCRIPTION_FILTERS = [
  ["", "All", "Every subscription on record"],
  ["active", "Active", "Paid access in its current period"],
  ["trialing", "Free trial", "Accounts inside their seven-day trial"],
  ["grace", "Renewal period", "Paid period ended, access continues briefly"],
  ["expired", "Expired", "Access has ended"],
  ["cancelled", "Cancelled", "Ended at the reader's request"],
  ["suspended", "Suspended", "Access withheld pending administrator review"]
];

const SUBSCRIPTION_SORTS = [
  ["newest", "Newest first"],
  ["expiring", "Expiring soonest"],
  ["oldest", "Oldest first"]
];

/** [code, label, what actually happens] — the third column is shown to the
 *  administrator before they commit, not buried in a help page. */
const SUBSCRIPTION_ACTIONS = [
  ["suspend", "Suspend access", "Access stops immediately. The paid period, payments and progress are all kept."],
  ["reactivate", "Reactivate access", "Access resumes under the period already recorded on this subscription."],
  ["extend", "Extend the period", "Moves the expiry later. The reader keeps every day they already had."],
  ["change_expiration", "Set a new expiry", "Replaces the expiry with the date you choose, earlier or later."],
  ["cancel_period_end", "Cancel at period end", "Access continues until the current period expires, then stops."],
  ["cancel_now", "Cancel immediately", "Paid access ends now. Payment and lifecycle history are preserved."]
];

function when(value) {
  return value ? formatDateTime(value) : "—";
}

function humanize(value) {
  return String(value || "—").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function SubscriptionDetail({ subscriptionId, canManage, onChanged, onClose }) {
  const data = useAsyncData(() => adminControlApi.subscription(subscriptionId), [subscriptionId]);
  const [action, setAction] = useState("suspend");
  const [reason, setReason] = useState("");
  const [expiration, setExpiration] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState("");

  if (data.loading) return <section className="panel ops-detail"><LoadingPanel /></section>;
  if (data.error) return <section className="panel ops-detail"><ErrorPanel message={data.error} onRetry={data.reload} /></section>;

  const item = data.data;
  const education = item.user.education || {};
  const sourcePayment = item.source_payment;


  // Never offer a change the server will refuse. Suspending an already
  // suspended subscription, or reactivating a live one, is not a decision an
  // administrator should have to discover by being told no.
  const availableActions = SUBSCRIPTION_ACTIONS.filter(([value]) => {
    if (value === "suspend") return ["active", "trialing", "grace"].includes(item.status);
    if (value === "reactivate") return ["suspended", "expired", "cancelled"].includes(item.status);
    if (value === "cancel_now") return !["cancelled", "expired", "refunded"].includes(item.status);
    if (value === "cancel_period_end") {
      return ["active", "trialing", "grace"].includes(item.status) && !item.cancel_at_period_end;
    }
    if (value === "extend" || value === "change_expiration") return item.status !== "refunded";
    return true;
  });
  // The stored choice may have been made valid-then-invalid by a change applied
  // in this very panel, so the effective action is always one the list still
  // offers rather than whatever the select last held.
  const effectiveAction = availableActions.some(([value]) => value === action)
    ? action
    : availableActions[0]?.[0] || "";
  const needsDate = ["extend", "change_expiration"].includes(effectiveAction);
  const chosen = SUBSCRIPTION_ACTIONS.find(([value]) => value === effectiveAction);

  async function mutate() {
    setPending(true);
    setError(null);
    setSuccess("");
    try {
      const body = { action: effectiveAction, reason };
      if (needsDate) body.period_ends_at = new Date(expiration).toISOString();
      await adminControlApi.subscriptionAction(subscriptionId, body);
      setSuccess(`${chosen?.[1] || "The change"} is applied and recorded.`);
      setReason("");
      setConfirm(false);
      data.reload();
      onChanged?.();
    } catch (requestError) {
      setError(requestError);
      setConfirm(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel ops-detail" aria-label="Subscription detail">
      <div className="ops-panel-head">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>{item.plan_title || item.plan_code}</h2>
        </div>
        <div className="ops-actions">
          <StatusBadge state={subscriptionState(item)} />
          <button className="btn btn-soft compact" type="button" onClick={onClose}>Close</button>
        </div>
      </div>

      {success && <p className="form-alert success" role="status">{success}</p>}
      {error && <p className="form-alert error" role="alert">{error.message}</p>}

      <dl className="ops-facts">
        <div><dt>Student</dt><dd>{item.user.full_name || "—"}</dd></div>
        <div><dt>Username</dt><dd>{item.user.username ? `@${item.user.username}` : "—"}</dd></div>
        <div><dt>Email</dt><dd>{item.user.email || "—"}</dd></div>
        <div><dt>Education</dt><dd>{[education.program_name_en || education.program_name_ar, education.cohort_name_en || education.cohort_name_ar].filter(Boolean).join(" · ") || "—"}</dd></div>
        <div><dt>Plan</dt><dd>{item.plan_title || item.plan_code}</dd></div>
        <div><dt>Started</dt><dd>{when(item.started_at || item.current_period_started_at)}</dd></div>
        <div><dt>Trial ends</dt><dd>{when(item.trial_ends_at)}</dd></div>
        <div><dt>Period ends</dt><dd>{when(item.current_period_ends_at)}</dd></div>
        <div><dt>Renewal period ends</dt><dd>{when(item.grace_ends_at)}</dd></div>
        <div><dt>Days remaining</dt><dd>{item.remaining_days ?? "—"}</dd></div>
        <div><dt>Payment verification</dt><dd>{humanize(item.payment_verification)}</dd></div>
        <div><dt>Last payment</dt><dd>{when(item.last_payment_at)}</dd></div>
        <div><dt>Ends at period end</dt><dd>{item.cancel_at_period_end ? "Yes" : "No"}</dd></div>
        <div>
          <dt>Source payment</dt>
          <dd>{sourcePayment
            ? `${humanize(sourcePayment.method)} · ${money(sourcePayment.amount_minor, sourcePayment.currency, sourcePayment.currency_exponent)} · ${humanize(sourcePayment.status)}`
            : "No linked payment"}</dd>
        </div>
      </dl>

      <section className="ops-history" aria-labelledby="ops-sub-history">
        <h3 id="ops-sub-history">Administrative history</h3>
        {item.admin_events?.length ? (
          <ol>
            {item.admin_events.map((event) => (
              <li key={event.id}>
                <span>{SUBSCRIPTION_ACTIONS.find(([value]) => value === event.action)?.[1] || humanize(event.action)} · {event.actor_name || "operator"}</span>
                <small>{when(event.created_at)} — {event.reason}</small>
              </li>
            ))}
          </ol>
        ) : <p className="ops-note">No manual administrative change has been made to this subscription.</p>}
      </section>

      {canManage && availableActions.length > 0 && (
        <form className="ops-review" onSubmit={(event) => { event.preventDefault(); setConfirm(true); }}>
          <div className="ops-panel-head"><h3>Change this subscription</h3></div>
          <label className="field">
            <span>Action</span>
            <select value={effectiveAction} onChange={(event) => setAction(event.target.value)}>
              {availableActions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <small>{chosen?.[2]}</small>
          </label>
          {needsDate && (
            <label className="field">
              <span>New expiry</span>
              <input type="datetime-local" value={expiration} onChange={(event) => setExpiration(event.target.value)} required />
            </label>
          )}
          <label className="field">
            <span>Required reason</span>
            <textarea
              minLength={8}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this change required? Saved to immutable history."
              required
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={pending || reason.trim().length < 8 || (needsDate && !expiration)}>
            {pending ? "Applying…" : "Review change"}
          </button>
        </form>
      )}

      <ConfirmDialog
        open={confirm}
        busy={pending}
        title={chosen?.[1] || "Confirm subscription change"}
        message={`${chosen?.[2] || ""} Lock-in validates the transition, recalculates entitlements, and writes an immutable audit record naming you.`}
        confirmLabel={pending ? "Applying…" : chosen?.[1] || "Apply change"}
        onCancel={() => setConfirm(false)}
        onConfirm={mutate}
      />
    </section>
  );
}

export default function SubscriptionsConsole({ canManage }) {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const list = useAsyncData(
    () => adminControlApi.subscriptions({ page, query, status, sort }),
    [page, query, status, sort]
  );
  const summary = useAsyncData(() => adminControlApi.analytics(), []);

  const reload = useCallback(() => {
    list.reload();
    summary.reload();
  }, [list, summary]);

  const stats = summary.data?.subscriptions;

  return (
    <section className="operations-workspace">
      <p className="ops-lead">Who currently has access, on which plan, and until when.</p>
      <section className="ops-metrics" aria-label="Subscription summary">
        <Metric label="With access" value={stats ? formatNumber(stats.active) : "—"} hint="Active, trialing or in renewal period" tone="healthy" icon="layers" />
        <Metric label="On free trial" value={stats ? formatNumber(stats.trial) : "—"} hint="Inside the seven-day trial" tone="info" icon="clock" />
        <Metric label="Expiring soon" value={stats ? formatNumber(stats.upcoming_expirations) : "—"} hint="Next 14 days" tone="warning" icon="alert-triangle" />
        <Metric label="Expired" value={stats ? formatNumber(stats.expired) : "—"} hint="Access has ended" tone="neutral" icon="activity" />
      </section>

      <div className="ops-toolbar">
        <div className="ops-chips" role="group" aria-label="Subscription status filter">
          {SUBSCRIPTION_FILTERS.map(([code, label, description]) => (
            <button
              key={code || "all"}
              type="button"
              className={`ops-chip${status === code ? " is-selected" : ""}`}
              aria-pressed={status === code}
              title={description}
              onClick={() => { setStatus(code); setPage(1); setSelected(null); }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ops-toolbar-inputs">
          <label className="field ops-search">
            <span>Search</span>
            <input
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              placeholder="Name, username, email or plan"
            />
          </label>
          <label className="field">
            <span>Sort</span>
            <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
              {SUBSCRIPTION_SORTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {list.loading ? <LoadingPanel variant="list" /> : list.error ? (
        <ErrorPanel message={list.error} onRetry={list.reload} />
      ) : (
        <section className="panel ops-table-panel">
          <div className="ops-panel-head">
            <h2>{SUBSCRIPTION_FILTERS.find(([code]) => code === status)?.[1] || "Subscriptions"}</h2>
            <span>{formatNumber(list.data.count)} {list.data.count === 1 ? "subscription" : "subscriptions"}</span>
          </div>
          {list.data.results.length ? (
            <div className="ops-table-scroll">
              <table className="ops-table">
                <caption className="visually-hidden">Subscriptions matching the selected filter</caption>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">Status</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Days left</th>
                    <th scope="col">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.results.map((subscription) => (
                    <tr key={subscription.id} className={selected === subscription.id ? "is-selected" : ""}>
                      <th scope="row">
                        <button type="button" className="ops-row-link" onClick={() => setSelected(subscription.id)} aria-expanded={selected === subscription.id}>
                          <b>{subscription.user.full_name || subscription.user.username || subscription.user.email || "Unknown account"}</b>
                          <small>{subscription.user.email || "—"}</small>
                        </button>
                      </th>
                      <td><StatusBadge state={subscriptionState(subscription)} /></td>
                      <td className="ops-cell-plan">{subscription.plan_title || subscription.plan_code}</td>
                      <td>{when(subscription.current_period_ends_at || subscription.trial_ends_at)}</td>
                      <td className="ops-cell-amount">{subscription.remaining_days ?? "—"}</td>
                      <td>{humanize(subscription.payment_verification)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No subscriptions found" text="No subscription matched this filter and search." />
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
        <SubscriptionDetail
          subscriptionId={selected}
          canManage={canManage}
          onChanged={reload}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
