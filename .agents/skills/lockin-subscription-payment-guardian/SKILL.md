---
name: lockin-subscription-payment-guardian
description: Safely implement or debug Lock-in subscriptions, payments, entitlements, invoices, refunds, trials, approvals, and access lifecycle. Use for any change that can grant, extend, revoke, charge for, or report paid/trial access.
---

# Lock-in Subscription & Payment Guardian

Treat access and money state as high-risk authoritative backend behavior.

## Domains to trace

As relevant:
payments
→ subscriptions
→ entitlements
→ invoices/refunds
→ frontend subscription/access UI
→ admin approval/rejection
→ scheduled expiry/reconciliation

## Required reasoning

For each transition define:
- current state
- event/action
- allowed actor
- resulting state
- entitlement effect
- effective timestamps
- idempotency behavior
- duplicate/retry behavior
- audit/evidence

## Dates

Be explicit about:
- trial end
- current period end
- activation time
- extension/compensation
- expiration
- timezone-aware timestamps

Do not update one lifecycle timestamp if another authoritative field must move with it.

## Idempotency

Protect:
- provider callbacks
- approve/reject actions
- subscription creation
- entitlement projection
- compensation/extension scripts

A retry must not double-grant access or double-record financial state.

## Concurrency

When two actors/processes can mutate the same subscription:
- use database transaction/locking/constraints as appropriate
- do not rely on disabled buttons or client polling

## Entitlement rule

Payment/subscription state and access entitlement are related but distinct.
Verify the path from lifecycle state to actual feature/content access.

## Production safety

Never run mass production corrections without:
- explicit user request
- dry-run/preview when practical
- scoped selection
- before/after evidence
- transaction/rollback strategy where possible

Never expose payment secrets or production credentials to external free agents.

## Validation

Use targeted:
- lifecycle tests
- entitlement tests
- duplicate/idempotency tests
- admin action tests
- frontend current-access tests when UI changes

Use Critical routing for unclear production-impacting changes.

## Output

SUBSCRIPTION/PAYMENT RESULT
TRANSITION: <before → action → after>
ENTITLEMENT: <effect>
DATES: <effect>
IDEMPOTENCY: <evidence>
CONCURRENCY: <evidence>
TESTS: <evidence>
PRODUCTION RISK: <remaining>
