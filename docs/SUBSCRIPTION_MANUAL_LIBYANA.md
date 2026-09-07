# Lock-in subscription and manual Libyana payments

## Architecture

The backend is the subscription authority. Study APIs pass through the global
subscription permission in `apps.entitlements.access_permissions`, which maps an
API domain to an entitlement. React performs the same check only to present a
friendly paused-access screen; it cannot grant access or change dates.

Both manual Libyana payments and a future payment gateway feed the existing
`Subscription`, `Payment`, transition, entitlement, invoice, notification, and
audit services. The Libyana-specific workflow is isolated in
`apps.payments.manual_services`; Telegram delivery is an optional adapter in
`apps.payments.telegram`.

## User lifecycle

- A verified new account receives one seven-day trial. Creating another session,
  reconnecting OAuth, selecting/changing a username, cancelling, or returning
  later never creates a second trial.
- A newly created Google account without a username must choose a unique
  3–30-character lowercase username before proceeding. Validation and uniqueness
  are enforced by Django and the database.
- The first-login welcome is completed through the server and stored in
  `welcome_completed_at`; local storage is not authoritative.
- Paid access uses `active`; a submitted but unverified Libyana payment is
  represented separately by `payment_verification=provisional` and a pending
  manual submission. The user sees active access plus “payment being reviewed.”
- At a paid period end, the scheduler moves the subscription into a seven-day
  `grace` period. At the grace deadline it becomes `expired`. Account and study
  records are never deleted by these transitions.
- Suspended, cancelled, and expired accounts can still sign in and access account,
  settings, help, notifications, and subscription/renewal screens.

Backend states are `pending`, `trialing`, `active`, `grace`, `expired`,
`suspended`, `cancelled`, and `refunded`. User-facing components translate them
into Free Trial, Active, Payment being reviewed, Renewal period, or Subscription
paused.

## Billing accounting

Price and duration always come from the active immutable catalog `Price` attached
to the submitted `plan_id`. Clients cannot send an amount, duration, status, or
expiration date.

- Paying during a trial anchors the paid period to the trial expiration, so none
  of the seven trial days are lost.
- An active paid subscription can renew only during its final seven days. An
  early renewal is anchored to the existing paid expiration, so none of its
  remaining days are lost. Each extension stores its previous end, extension
  start, extension end, and payment request. If that request is rejected, only
  its extension is rolled back; the original paid period remains intact.
- Renewing during a grace window extends from the existing paid expiration. For
  example, a 30-day plan expiring September 1 and renewed on September 8 ends
  October 1. The grace period is access tolerance, not free time.
- Renewing after grace starts a fresh period at the server submission time.
- Provisional approval verifies the period already granted and is idempotent; it
  never adds the duration a second time. Rejection transactionally restores the
  exact pre-submission subscription snapshot and entitlement state.

## Libyana code protection

Each code is exactly 13 ASCII digits: no letters, spaces, or symbols. Codes are
validated in the browser and server, encrypted at rest with AES-GCM, and indexed
only by a keyed HMAC digest plus the final four digits. The digest has a unique
database constraint, and a user can have only one pending submission. A 5 LYD
plan accepts one code; other plans accept one required code plus one optional
second code. The separate `ManualRechargeCode` records allow more cards to be
supported later without redesigning a payment request. Normal payment APIs expose
only masked values. Only administrators with `payments.manage` can reveal a
pending code. On approval or rejection, Lock-in deletes reversible ciphertext
while retaining digests and final four digits for duplicate prevention and audit
history.

Recharge codes are excluded from normal logs and audit payloads. The audit
sanitizer also redacts keys containing recharge, payment-code, token, cookie,
password, or secret fragments.

## Operations and configuration

Creator Studio → Payments provides pending/approved/rejected filters, protected
pending-code detail, approve/reject actions, reasons, and payment/subscription
context. Creator Studio → Subscriptions provides activate, suspend, cancel,
restore, extend, expiration-date, history, and plan-version/price controls. Every
sensitive mutation uses permission checks, idempotency, transactions, and an audit
record.

Required production configuration:

- `PAYMENT_CODE_ENCRYPTION_KEY`: a dedicated random secret of at least 32
  characters, supplied through the configured secret file. Keep it stable while
  pending codes exist.
- `SUBSCRIPTION_SCHEDULER_INTERVAL_SECONDS`: 60–86400; default 900. The dedicated
  `subscription-scheduler` service runs `process_subscription_lifecycle` without
  requiring a browser session.
- Seeded Libyana offers are 5 LYD for an eligible user's first month, then 10
  LYD for one month, 20 LYD for two months, 25 LYD for three months, and 30 LYD
  for four months. The offer eligibility is computed by the backend from prior
  successful payments; it is never trusted from the client.

Optional Telegram configuration:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID` (preferred; `TELEGRAM_PAYMENT_CHAT_ID` remains a
  backwards-compatible alias)
- `TELEGRAM_HTTP_TIMEOUT_SECONDS` (default 5)

Both Telegram identifiers must be provided together in production. With neither
configured, submissions remain fully functional and Telegram is a safe no-op.
The adapter sends the request ID, username, user ID, plan, amount, submitted
time, and the submitted card code(s) so the authorized payment reviewer can act
from the alert. It never sends passwords, sessions, or authentication tokens.

## Existing-user migration policy

The migration is additive and does not touch study data. Existing users receive a
deterministic unique username when missing and have the welcome marked complete at
their original join time, so deployment does not force old accounts through new
onboarding. Existing subscription rows keep their plan version, status, and dates;
they are neither granted nor denied access by a bulk backfill. Only newly verified
eligible accounts receive the new seven-day trial plan. The monthly catalog seed
is owner-editable through immutable plan versions, so later price changes do not
rewrite historical payments or subscriptions.
