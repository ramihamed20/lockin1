# Approved user policies: October 2026 release

Source: owner-supplied `Lockin_User_Policies_2026(1).pdf`, issued 16 October 2026,
version `2026.10`. The exact document is shipped as
`frontend/public/policies/Lockin_User_Policies_2026.pdf`. Public pages provide an
Arabic reading version, contact channels and the complete PDF.

## Impact map

PRIMARY: public policy pages, account consent, manual payments, refund requests and personal data.
AUTHORITATIVE STATE: Django/PostgreSQL; immutable purchase policy snapshots and audit history.
CROSS-SYSTEM LINKS: account -> payment -> subscription -> entitlements -> invoices/refunds;
account -> personal learning records/media -> deletion journal.
TEST FAMILIES: account/API ownership, financial lifecycle/entitlements, refund boundary arithmetic,
manual payment notifications, offline account isolation, public-information browser flow.
RISK: High. New migrations and money/access/privacy transitions need PostgreSQL CI evidence.

## Resulting behavior

- `/terms`, `/privacy`, `/refunds`, `/support` are public. The approved document is downloadable.
- Existing accounts see an explicit acceptance notice. Acceptance is recorded once per current
  version with an audit timestamp. New checkout requires explicit acceptance and legal-capacity
  acknowledgement. Existing transactions keep their recorded policy, including the earlier,
  more favourable installment refund guarantee.
- A new purchase snapshots its policy. Paid entitlement starts only after manual approval;
  any valid earlier trial or paid access remains bounded by its earlier expiry while review is pending.
  Rolling durations start at approval; fixed terms keep their advertised expiry.
- The refund window starts at approval AND service availability; an installment purchase has one
  window tied to its first activation. Full payment gets 100% through day 15; new installments get
  100% through day 10 and 50% of actual paid amounts on days 11-15. The policy preserves service
  and payment error claims after that voluntary window.
- Students submit requests without needing to supply a receiving number immediately. The original
  receipt and 48-hour deadline are durable. Finance can record Telegram/email requests at their
  original receipt time. Contact correction and review never restart the deadline.
- Finance approval reserves actual refundable amounts and ends the associated purchase/remaining
  installments. Completion requires an operator's actual net airtime-transfer reference. No external
  airtime provider is simulated. The operator bears any carrier transfer fee.
- A partial collection in a rejected multi-card order remains settled money with an invoice and
  a refund right. A rejected order does not erase valid pre-existing access. Completing that purchase
  with remaining valid cards is handled through support/manual review; do not collect its full
  value again without accounting for the earlier collection.
  A partially collected rejected later installment is not a completed installment. Its payment-error
  refund returns only that collection and preserves earlier approved installments and their access.
  The advertised installment dates remain fixed when approval is delayed.
- Compensation is available only when the user chose it for a platform error. Finance starts the
  free entitlement and ends it when service returns. It is never forced in place of money.
- Telegram payment messages mask each PIN. Full codes remain restricted to financial review in
  the website. Moderator account detail responses omit purchases and refunds.
- Expiry keeps student work; paid study access stops until renewal. Privacy export and deletion
  request routes remain available outside the study subscription gate.

## Activation and rollout

Set `ACCOUNT_POLICY_VERSION=2026.10` and set `USER_POLICY_EFFECTIVE_AT` to the actual announced
launch instant, as ISO 8601 with an explicit offset. Do not use the document's issue date as a
substitute for a later launch. The public page reads the announced instant from `/api/v1/policies`.
The deployment check refuses an unspecified launch instant for this policy, and new manual
purchases do not begin before it. Deploy frontend/backend together and apply migrations before
opening the new request UI.

The new financial queue appears in Payments for users holding `payments.manage`.
Review each received request promptly, including requests needing further details. The 48-hour
clock includes holidays. Select `complete` only after the whole approved net amount has actually
been transferred; record the real reference. If airtime cannot be transferred, finance may record an alternative
method only with a reference to the user's agreement, the actual recipient and the full approved
net amount. The app records transfers; it does not initiate them.
For an outage, record when the service was restored and close each compensation grant.

A purchase followed by another purchase on the same subscription cannot have its newer rights
cancelled incidentally. The queue asks finance to adjust the later purchase/access before approving
such a cancellation. An early-renewal refund restores the earlier period when its reservation is
still intact. Escalate an intervening operator change instead of restoring a stale snapshot.

## Data export and reviewed erasure

`GET /api/v1/account/data-export` exports the requesting user's available server-side study records,
profile and masked payment history. It excludes passwords, session credentials and full card PINs.
Local unsynced drafts need a separate copy on the user's own device.

The existing password/email deletion request remains single-use and tracked. Confirmation is not
completion. Its response includes a 30-day target and a processing note. The user can also request
privacy action through support. A privacy request does not automatically waive a refund.

`process_account_deletion REQUEST_UUID` previews one account without writing. `--apply` requires
an active administrator via `--actor`, an approved `ACCOUNT_DELETION_POLICY_VERSION`, a specific
`--retention-reason` and timezone-aware `--retained-until`. The PDF does not establish statutory
financial/security retention durations. Determine and approve those before enabling execution;
the command intentionally supplies no invented default. Record and review the retained evidence
at its expiry; the erasure command does not replace financial/audit retention administration.

Review/remove or transfer creator/shared content before running erasure. Cross-user protected
references block completion. The begin step separately commits suspension/session revocation;
then erasure removes scoped personal learning records and eligible stored blobs, replaces direct
identity with an unusable tombstone, and preserves required financial/security references.
Only successful erasure and object-store deletion mark completion. If processing fails, investigate
and rerun; do not report the confirmation link as successful deletion. Inform the requester of the
result or any justified delay through the existing support channel.

After every completion, run `account_deletion_manifest` and preserve its signed output separately
from database backups in an access-controlled location. Refresh it as part of the operator workflow;
otherwise deletions newer than a restored backup cannot be replayed from that backup alone.
Before reopening a restored backup, preview `account_deletion_manifest --replay MANIFEST` and
then apply it with `--apply --actor ADMIN_UUID`. Keep the signing key available through the normal
secret backup process. An invalid signature, expired evidence hold or protected shared record stops
replay for operator review. Reopen service only after replay and media verification succeed.

`ACCOUNT_DELETION_RETENTION.md` remains the owner review record for detailed legal retention.
This change supplies an executable, gated workflow; it does not assert that currently unspecified
legal durations or production backup schedules have been approved or tested on the hosting account.

## Validation

See PR validation results for executed commands. Local SQLite runs prove business rules and API
ownership, not PostgreSQL row locking. PostgreSQL CI is authoritative for locking and constraints.
Do not deploy while any required CI gate is failing. No production records, real payments, airtime
transfers, microphone audio, or actual user deletions are used by these tests.

Executed locally:

- Backend account/payment/subscription/entitlement/refund/admin family: 348 passed,
  15 PostgreSQL-only cases skipped on SQLite.
- Production/account-policy targeted family: 41 passed; final privacy/export/erasure
  regression family after export filtering: 9 passed.
- Full frontend Node suite: 614 passed.
- Full frontend lint, both TypeScript projects, production build and bundle budgets passed.
- Full backend Ruff and formatting, mypy (525 sources), Django check and migration drift passed.
- Exact PDF SHA-256 matched the owner-supplied source.

The normal local browser download was truncated. Using a separate scratch Chromium runtime,
the public-information tests (2), guided checkout at four viewports (4), and the reported reader
selection case passed. No browser dependency or runtime override is added to the repository.
The full PostgreSQL CI suite passed on the initial implementation; the final branch must pass
all required CI gates again. A local PostgreSQL process was unavailable in this container.
