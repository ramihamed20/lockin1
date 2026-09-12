# Lock-in payment, subscription, entitlement and free-trial repair

Branch: `fix/payment-subscription-entitlement-lifecycle`

> **Live QA addendum (2026-09-13).** Running the seeded browser validation found
> three further faults that the unit and component suites could not see. They
> are described in §10 at the end of this document, which also carries the live
> results. §1–§9 describe the first pass and are unchanged.

## 1. Root causes found

**R1 — The access snapshot was cached as fresh for ever, for exactly the readers
who needed it to change.** `isSubscriptionSnapshotFresh` returned an
unconditional `true` whenever the snapshot did not carry time-bounded access —
a pending card, a lapsed trial, no subscription at all. The 30-second age check
applied only to readers who already had access. A reader waiting on a decision
therefore never re-read `/subscriptions/current`, and the sessionStorage entry
outlived the decision.

**R2 — The polling refresh was gated on already having access.** The provider's
interval/focus/visibility refresh ran only `if (state.subscription?.access_allowed)`.
Combined with R1, an approval landed in the database and reached the reader's
open tab never — only a new tab or a cleared session storage would show it.
Together, R1 and R2 are the reported "student stays stuck on the subscribe /
pending screen".

**R3 — The subscription screen read the review state from a list it loaded once.**
`pendingManualReview` came from `billingApi.details()`, fetched on mount with an
empty dependency list. After an approval or a rejection the screen kept hiding
the payment form behind "A payment is already under review", with nothing saying
why and no way to submit again.

**R4 — A trial that ended while a card was queued could never expire.**
`refresh_subscription` transitioned a finished trial with `effective_at =
trial_ends_at` and **without** `allow_out_of_order`, unlike the paid-period and
grace transitions beside it. A rejection writes its own transition at the moment
of review, so a card submitted on trial day 6 and rejected on day 9 made the
trial-end transition look out of order. It was discarded — and the discard
consumed the undated `trial-end:<id>` idempotency key permanently. The
subscription stayed `TRIALING` for ever with a trial end in the past: the study
gate denied it (the effective-grant selector fails closed) while the
subscription screen called it a running trial.

**R5 — Approval recorded nothing on the subscription and re-converged nothing.**
The approve branch flipped `payment_verification` and saved. No
`SubscriptionTransition`, so the subscription's own history and the admin
console showed no trace of the approval; and entitlements were left as whatever
convergence had produced at submission time, hours or days earlier.

**R6 — Rejection restored a snapshot without reconciling it.** The rollback put
back the subscription as it looked at submission; with R4 in place the
subsequent `refresh_subscription` silently did nothing.

**R7 — Rejection could overwrite a later administrator decision.** The rollback
ran unconditionally. If an administrator had extended, replaced or cancelled the
subscription while the card was queued, rejecting the card reverted their work.

**R8 — A reader with no subscription row could never pay.** `submit_manual_recharge`
raised "A subscription account is not ready yet. Please try again." — for ever,
for anyone whose trial was never created (verified before the trial plan was
published, or while it was unpublished, or the event-bus handler failed).

**R9 — Trial creation and account creation had unguarded races.**
`get_or_create_individual_account` cannot lock a row that does not exist, so two
concurrent first requests both reached the INSERT and one died on the unique
index; and `create_trial_for_user` read "does this account have a subscription"
without holding the account row, so two callers could both answer no and both
insert a trial, one losing to the one-live-per-account index with a 500.

**R10 — A brief false denial at the moment a paid period ended.**
`effective_grants_for_user` required `status=ACTIVE AND current_period_ends_at >
now`. Between the instant a period ended and the lifecycle job relabelling the
row `GRACE`, every study endpoint denied a reader who was in fact inside their
grace window — the one moment a renewal reminder needs to be reachable.

**R11 — `var(--warning)` was never defined.** Five rules referenced it (the grace
dot, the grace note); the token is `--color-warning`. Those colours silently did
not apply.

**R12 — An ended subscription rendered no status at all.** `SubscriptionStatus`
returned `null` for expired/cancelled/suspended, so the card showed a plan name
and nothing else — indistinguishable from a healthy account. Its fallback for an
unknown status was "Active", which for `refunded` said the opposite of the truth.

## 2. Files changed

Backend
- `backend/apps/subscriptions/services.py`
- `backend/apps/subscriptions/serializers.py`
- `backend/apps/payments/manual_services.py`
- `backend/apps/entitlements/selectors.py`
- `backend/apps/admin_control/selectors.py`
- `backend/apps/admin_control/views.py`
- `backend/apps/payments/tests/test_payment_lifecycle_parity.py` *(new)*

Frontend
- `frontend/src/lib/subscriptionSession.js`
- `frontend/src/lib/SubscriptionSessionContext.jsx`
- `frontend/src/pages/Subscription.jsx`
- `frontend/src/pages/WelcomeOnboarding.jsx`
- `frontend/src/components/subscription/SubscriptionStatus.jsx`
- `frontend/src/pages/admin/PaymentsConsole.jsx` *(new)*
- `frontend/src/pages/admin/SubscriptionsConsole.jsx` *(new)*
- `frontend/src/pages/OperationsAdmin.jsx`
- `frontend/src/api/adminControl.js`
- `frontend/src/lib/i18n.js`
- `frontend/src/styles.css`, `frontend/src/pages/creator-studio.css`
- `frontend/tests/subscription-session.test.js`, `frontend/tests/subscription-flow.test.js`,
  `frontend/tests/phase5.test.js`, `frontend/e2e/subscription-live.spec.js`

## 3. Backend fixes

- **Trial expiry is now dated and order-tolerant** (R4). `refresh_subscription`
  uses `trial-end:<id>:<trial_ends_at>` with `allow_out_of_order=True`, matching
  the paid-period and grace transitions. The dated key also self-heals rows
  already stuck by the old undated one.
- **Approval records and re-converges** (R5). A `manual_payment_approved`
  `SubscriptionTransition` is written under the fixed key
  `manual-approval:<payment_id>`, the subscription is run back through
  `refresh_subscription`, and `sync_subscription_entitlements` runs in the same
  transaction. The paid period is *not* re-anchored, which is what keeps a
  repeated approval harmless.
- **Rejection reconciles rather than merely restores** (R6) — same
  `refresh_subscription` + `sync_subscription_entitlements` pair, now reached in
  a state the lifecycle can act on.
- **Both decisions are scoped to what this payment owns** (R7).
  `owns_subscription_state` (the subscription still rests on this payment) gates
  every write to the subscription; `reserved_period_intact` additionally gates
  the snapshot rollback. A payment whose subscription has moved on still settles
  itself — status, invoice, notification, audit — and leaves the subscription to
  its current owner.
- **A submission opens a subscription when none exists** (R8): a `PENDING`
  subscription on the paid plan, with its own transition, which the normal
  `PENDING → ACTIVE` path then takes over.
- **Locking** (R9). New `lock_individual_account()` takes `SELECT … FOR UPDATE`
  on the account row and is used by `create_trial_for_user` and
  `submit_manual_recharge`, so everything that decides what an account's single
  subscription should be serialises. `get_or_create_individual_account` catches
  the `IntegrityError` a lost INSERT race produces and re-reads.
- **Grace is honoured before reconciliation runs** (R10): the effective-grant
  selector treats `ACTIVE` + live `grace_ends_at` + not `cancel_at_period_end`
  as access-granting, which is exactly the state the lifecycle job will
  relabel `GRACE`.
- **One source of truth for the screen** (R3): `SubscriptionSerializer` now
  carries `manual_payment_review` — status, submitted/reviewed timestamps,
  rejection reason, plan, amount, early-renewal flag — so the payload the access
  session already polls carries the review state too.
- **Admin data and sorting**: server-side `sort` for payments
  (newest/oldest/amount) and subscriptions (newest/expiring/oldest), validated
  against the selector's own map and refused otherwise; username added to both
  searches; `failed_at`, `is_early_renewal`, subscription `payment_verification`,
  `status_reason`, `last_payment_at`, plan title and username added to the admin
  payloads; a `manual_reviews` block (pending / approved / rejected /
  oldest_pending_at) added to the analytics dashboard.

## 4. Frontend fixes

- **Every snapshot ages out** (R1). `isSubscriptionSnapshotFresh` applies the
  30-second age check to all snapshots; time-bounded access must additionally
  still be inside its window. Only a manual grant or a Founder exemption — which
  no payment decision can change — stays fresh without a clock.
- **Everyone polls** (R2). The interval/focus/visibility refresh runs for every
  signed-in reader except those two stable cases.
- **The subscription screen reads the polled snapshot** (R3).
  `pendingManualPayment` and `manualPaymentReview` come from the access session;
  a new `ReviewBanner` states pending / approved / rejected in words, with the
  rejection reason and a "Submit another card" action; an explicit expired state
  replaces the silent one; and the loaded-once payment history and catalogue are
  re-read whenever the polled review status changes.
- **Ended subscriptions say so** (R12), and an unrecognised status falls back to
  "Expired" rather than "Active".
- **Undefined `--warning` token replaced** with `--color-warning` (R11).
- **The welcome screen counts the trial it was actually granted** rather than
  printing "7 days" as a constant.

## 5. Admin UI improvements

Two new focused consoles (`PaymentsConsole`, `SubscriptionsConsole`) replace the
single-line blobs in `OperationsAdmin.jsx`, sharing one badge vocabulary, table
shell and detail layout.

- Queue first: the payments screen opens on **Awaiting review**, with a metric
  row showing what is waiting, how long the oldest has waited, and approved /
  rejected / collected.
- One-click status chips (awaiting review, all, approved, rejected, succeeded,
  failed, refunded) with a live count on the queue chip; debounced search across
  name, username, email, plan and reference; server-side sort.
- Accessible table with real `<th scope>` headers, a caption, and `aria-pressed`
  filters; wide content scrolls inside its own container, so the page never
  scrolls sideways; card-style stacking below 52rem.
- Every row carries student, status, plan, amount, method, submission date, and
  who reviewed it and when. The detail panel adds college/year, verification
  state, subscription status and expiry, invoice number, the reserved period, the
  repeat-card count, the early-renewal note, and full payment history.
- **No invalid action is offered.** Approve/reject render only for a submission
  still `pending` *and* an administrator holding `payments.manage`. The
  subscription console filters its action list by current status (no suspending a
  suspended subscription, no reactivating a live one, no second
  cancel-at-period-end) and falls back to a valid action if the selected one
  stops being offered.
- Confirmation dialogs state what will actually happen, including that a repeated
  approval does not extend the period a second time. Buttons disable while a
  decision is in flight and the dialog refuses every way out until it settles.
- After a decision the list, the queue counters and the open payment are all
  re-read — no manual browser refresh — and a success message says what changed.
  Errors render as `role="alert"`; empty states distinguish "the queue is empty"
  from "nothing matched this filter".
- Refunds and dual-controlled corrections are retained, offered only for
  provider-taken payments where they are the actual mechanism.

## 6. Free-trial fixes

- Exactly `plan_version.trial_days` (7) from `email_verified_at`, unchanged, now
  covered by a test that asserts both the length and the anchor.
- One trial per account, ever: repeated calls (OAuth reconnect, verification
  resend, entitlement reconciliation) return the existing subscription and never
  restart the clock — now under an account-row lock, so concurrent callers cannot
  both create one.
- An expired trial revokes access and transitions exactly once, even when a
  payment decision has already written a later transition (R4).
- Trial status is consistent across the subscription snapshot, the entitlement
  API and the screen, because all three derive from the same subscription row.
- The welcome screen states the granted length rather than a hardcoded "7 days".

## 7. Tests added/updated

`backend/apps/payments/tests/test_payment_lifecycle_parity.py` — 16 tests, each
starting at the API the browser calls and ending at the API it reads:

trial length and anchor · trial claimed twice · trial expiry exactly once across
repeated reads · approval settles payment + subscription + entitlement + history
· approve twice (no second extension, no second transition, unchanged revision) ·
reject after approve refused · rejection removes provisional access and reopens
payment · **rejection after a lapsed trial does not report the trial as running**
(R4) · reject twice · approve after reject refused · rejection does not undo a
later administrator decision (R7) · one pending submission per reader · retrying
an attempt key returns the same payment · settled state on another device ·
payment without a subscription row (R8) · grace window before reconciliation (R10).

Six of the sixteen fail on the pre-fix code (verified by stashing the three
service files and re-running).

Frontend: `subscription-session.test.js` — a reader without access re-reads the
server rather than trusting the cache; snapshots with no usable age are refused;
the pending review gates a new submission. `subscription-flow.test.js` — the
console modules, a review refreshing the queue it emptied, and no action offered
that the server would refuse. `phase5.test.js` — re-pointed at the console
modules. `subscription-live.spec.js` — selectors and copy updated for the new
console, and a new live test that an approval reaches the student's **open tab
with no reload** (the R1+R2 regression).

## 8. Remaining risks and edge cases

- **Provisional access is unbounded by review.** A card nobody reviews grants a
  full paid period. That is the existing product decision; the console now
  surfaces "longest waiting" so it is visible rather than silent.
- **Reconciled trials start at verification.** A reader whose trial failed to be
  created (unpublished plan, failed handler) gets it back-dated to their
  verification date, so a long-past verification yields an already-expired trial.
  This is the existing anti-abuse choice, left unchanged, but it does punish a
  deployment fault; worth a product decision.
- **Polling costs two requests per reader per 30 s** while a tab is visible. It
  stops when the tab is hidden. If this shows up in load, a server-sent event on
  the review decision is the next step.
- **SQLite discards `select_for_update`.** The locking fixes are only truly
  exercised by the PostgreSQL CI job; the local runs below are a business-logic
  check, not evidence about row locking.
- **`_manual_payment_review` adds one query per serialized subscription.** Every
  current caller serializes a single object; a future list endpoint using
  `SubscriptionSerializer` would need prefetching.
- **Seven pre-existing failures** in `platform_core/tests/test_portability.py`
  (production settings/storage/transport checks) fail identically on the base
  commit in this local environment and are untouched by this work.

## 9. Commands run and results

Backend (`backend/`, `LOCKIN_TEST_USE_SQLITE=true`)

| Command | Result |
| --- | --- |
| `python -m pytest apps/payments apps/subscriptions apps/entitlements apps/admin_control` | 143 passed |
| `python -m pytest apps/payments/tests/test_payment_lifecycle_parity.py` | 16 passed |
| same, with the three service files stashed | 6 failed, 10 passed *(the regressions are real)* |
| `python -m pytest` (full suite, coverage gate) | 611 passed, 4 skipped, 7 pre-existing failures; coverage 85.33% ≥ 85% |
| `python -m ruff check .` | All checks passed |
| `python -m ruff format --check .` | 570 files already formatted |
| `python -m mypy .` | Success: no issues found in 454 source files |

Frontend (`frontend/`)

| Command | Result |
| --- | --- |
| `npm run lint` | clean (`--max-warnings 0`) |
| `npm run typecheck` | clean |
| `npm test` | 305 passed, 0 failed |
| `npm run build` | built; PWA precache 12 entries |
| `npm run check:bundle` | index JS 153.9 KiB gzip, CSS 72.1 KiB gzip — within budget |
| `npx playwright test` — all 16 non-Focus specs, `--workers=2` | 125 passed, 7 skipped, 7 failed |

Every one of those 7 Playwright failures reproduces identically with the
frontend checked out at the parent commit and rebuilt, so none is caused by this
work:

- 6 in `responsive-p0-regressions.spec.js` (workspace controls at three phone
  widths, remembered zoom, fit-width resize, the Arabic reader's opening
  position) — verified against the pre-change build, same 6 failed, same 7 passed.
- 1 in `rtl-direction.spec.js` ("a count is written and numbered the way Arabic
  writes counts") — verified the same way.
- `focus-pdf-recovery.spec.js` fails its 2 tests on both builds as well, with the
  app rendering its own "Sheet not found" state; the whole Focus family shares
  that fixture problem in this environment. The Focus specs were therefore not
  used as a signal here, and should be run in CI where they have a working
  fixture.

One further failure, `interaction-states.spec.js` "drawer destinations navigate
on the first tap", appeared under `--workers=2` and passed on its own — the
worker-contention flake this suite is already known for.

`e2e/subscription-live.spec.js` remains opt-in (`LOCKIN_SUBSCRIPTION_LIVE=1`)
against the seeded QA database and was not run here; its new test
("an approval reaches the student's open tab without a manual refresh") is the
end-to-end guard for the headline bug and should be run against the QA database
before release.

---

## 10. Live QA validation (2026-09-13)

### 10.1 How it was run

A seeded QA server was stood up and driven by a real browser:

- `python manage.py migrate` + `seed_demo --subscription-e2e` into a throwaway
  database at `local-run/qa-live.sqlite3`
- `manage.py runserver 127.0.0.1:8000` with `config.settings.e2e`
- the built `dist/` served on `127.0.0.1:5050` by `local-run/serve.mjs`, which
  proxies `/api/v1` to Django, so the browser talks to one origin
- `LOCKIN_SUBSCRIPTION_LIVE=1 PLAYWRIGHT_EXTERNAL_SERVER=1
  PLAYWRIGHT_BASE_URL=http://127.0.0.1:5050 npx playwright test
  e2e/subscription-live.spec.js --workers=1`

The spec is deliberately not idempotent — it consumes the seeded pending payment
and completes the seeded username onboarding — so the database was recreated
before every full run.

**This ran on SQLite, not PostgreSQL.** The locally installed PostgreSQL 17
requires `scram-sha-256` for every connection and no working credential was
available; editing `pg_hba.conf` would have been a change to the machine's
security configuration, so it was not made. The PostgreSQL run is still
outstanding — see §10.5.

### 10.2 Faults found by the live run

**L1 — Four of the six purchasable plans granted no access at all.**
`entitlements.0004` seeded plan entitlement rules for exactly two plan codes,
`lockin_trial` and `lockin_monthly`. `product_catalog.0005` then added four more
purchasable plans — the 5 LYD first month and the two, three and four month
offers — and nothing ever gave them rules.

A plan version with no rules is not a plan that grants nothing *extra*; it is a
plan that grants *nothing*. `sync_subscription_entitlements` builds the set of
entitlements a subscription should hold from its plan version rules and revokes
every grant outside that set. Paying for one of those four offers moved the
subscription onto the paid plan version and revoked `focus.workspace`,
`content.premium` and `files.download` in the same transaction that recorded the
payment as successful. The reader was left `ACTIVE`, `VERIFIED`, fully paid —
and locked out of every study surface, while the subscription screen, which
reads the subscription rather than the grants, told them their payment was
approved.

`lockin_monthly` was the one paid plan that worked, which is exactly why the
early-renewal path (which selects "Monthly" explicitly) looked healthy and the
default 5 LYD offer every new reader is steered to did not.

Observed directly on the QA database after an approval:

```
SUB active verified
ALL GRANTS:
   content.premium  revoked  subscription  ends 2026-09-19
   files.download   revoked  subscription  ends 2026-09-19
   focus.workspace  revoked  subscription  ends 2026-09-19
EFFECTIVE: []
```

**L2 — A reload showed the state the tab was last left in.** The cached access
snapshot renders the screen immediately, and nothing then asked the server
again: while the snapshot stayed fresh, a reader who reloaded right after an
approval was told once more that a payment was already under review. The 30
second cache TTL bounded it, but a page load is precisely the moment a reader
expects the newest answer.

**L3 — The live spec sign-in helper raced the application settling.**
The form becomes actionable slightly before it stops being re-rendered, and a
value written inside that window (measured at roughly the first 100–300 ms after
navigation) is discarded by the render that follows. Playwright fills that fast;
a person cannot. Verified present on the pre-branch build too, so it is not a
regression from this work — but it made the whole serial file fail at its first
login with an empty form.

### 10.3 Fixes

- `backend/apps/entitlements/migrations/0005_seed_libyana_offer_plan_rules.py`
  backfills the three study entitlements for every plan version that sells
  something and grants nothing. It matches on active prices rather than a list
  of plan codes, so it covers the four offers without naming them.
- `backend/apps/entitlements/tests/test_plan_entitlement_coverage.py` asserts
  the same property two ways — every purchasable plan version carries the rules,
  and moving a subscription onto any of them through
  `sync_subscription_entitlements` keeps access. A migration runs once; this is
  what stops the next plan reintroducing the gap. Both tests fail without the
  migration, naming the four plans.
- `frontend/src/lib/SubscriptionSessionContext.jsx` revalidates once on mount,
  non-blocking, even when a cached snapshot let the screen render immediately.
- `frontend/e2e/subscription-live.spec.js` writes the sign-in credentials until
  they stay, via `expect(...).toPass()`.

### 10.4 Live results

`e2e/subscription-live.spec.js` — **6 passed** (1.2 m):

| Test | What it proves |
| --- | --- |
| Google onboarding to welcome | trial account reaches the 7-day welcome once |
| trial welcome + provisional payment across 5 viewports | submission grants provisional access, code never rendered back |
| repeated approval + entitlements *(new)* | second approval changes neither period nor revision; grants present, sourced from the subscription, outliving the paid period; console offers no approve/reject on a decided payment |
| expired Arabic account, RTL | no overflow, renewal reachable |
| **approval reaches the student open tab** *(new)* | no reload, no navigation — the tab shows "Payment approved" on its own |
| early renewal through pending, rejection, approval | paid days preserved; rejection restores the original expiry; approval does not double-extend |

Trial expiry was additionally verified live over real HTTP (a trial cannot be
waited out in a browser): the trial window measured exactly 7 days with access
and 3 grants while running; after the window moved into the past,
`/subscriptions/current` reported `expired` with `access_allowed: false`,
`/entitlements/me` returned `[]`, and a re-read left exactly one `trial_ended`
transition.

Against the five requested checks:

| Check | Result |
| --- | --- |
| Approve updates the already-open tab without manual refresh | **Verified live** (test 5, 32.6 s — one poll interval) |
| Reject updates correctly and allows another submission | **Verified live** (test 6) |
| Free trial works and expires correctly | **Verified live** (7 days, access to expired, grants revoked, one transition) |
| No duplicate extension on repeated approval | **Verified live** (test 3: period and revision identical after a second approval through the real endpoint) |
| Entitlements match the final subscription state | **Verified live** (test 3) — and this is where L1 was found |

Supporting suites after the fixes:

| Command | Result |
| --- | --- |
| `python -m pytest` (full backend, coverage gate) | 616 passed, 4 skipped, 7 pre-existing failures; coverage 85.33% |
| `python -m pytest apps/entitlements/tests/test_plan_entitlement_coverage.py` | 2 passed; 2 failed with the migration disabled |
| `ruff check` / `ruff format --check` / `mypy` / `makemigrations --check` | clean, clean, 454 files clean, no drift |
| `npm run lint` / `typecheck` / `test` / `build` / `check:bundle` | clean, clean, 305 passed, built, within budget |

The 7 backend failures are the same `platform_core/tests/test_portability.py`
production-settings tests that fail identically on the base commit.

### 10.5 Still outstanding

The PostgreSQL run. What SQLite cannot tell you is whether the row locking is
right: it reports `has_select_for_update = False`, so Django silently drops every
`SELECT ... FOR UPDATE`, and the account-row locks added in this branch are
therefore untested by anything above. The new migration and the approve/reject
transactions also deserve a run on the real engine.

To run it, a QA role and database are needed:

```sql
CREATE ROLE lockin_qa LOGIN PASSWORD '<password>' CREATEDB;
CREATE DATABASE lockin_qa OWNER lockin_qa;
```

`CREATEDB` is required because pytest creates `test_lockin_qa`. With those
credentials the backend suite runs against PostgreSQL by exporting
`POSTGRES_DB/USER/PASSWORD/HOST/PORT` and *not* setting
`LOCKIN_TEST_USE_SQLITE`, and the live spec runs the same way as §10.1 with the
QA server pointed at the same database.
