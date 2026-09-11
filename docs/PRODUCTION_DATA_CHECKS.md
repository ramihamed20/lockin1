# Production data checks

Read-only queries to run against production **before** applying the migrations
on this branch, plus one detection query for data an earlier defect may have
left behind.

Nothing here modifies data. Run each as the runtime role; none needs owner
privileges. Do not run the migrations themselves from a session — the release
service owns that.

---

## 1. Before `focus.0008_activestudyrun_active_study_one_active_run_per_sheet`

That migration builds a **partial unique index** on
`(user_id, sheet_id, difficulty) WHERE status = 'active'`. It fails, and the
release with it, if the table already holds duplicates.

### Detection

```sql
SELECT user_id,
       sheet_id,
       difficulty,
       count(*)                        AS active_runs,
       array_agg(id ORDER BY updated_at DESC) AS run_ids
FROM   focus_activestudyrun
WHERE  status = 'active'
  AND  sheet_id IS NOT NULL
GROUP  BY user_id, sheet_id, difficulty
HAVING count(*) > 1
ORDER  BY active_runs DESC;
```

**Zero rows means the migration will apply cleanly.** Legacy catalogue runs have
`sheet_id IS NULL`; PostgreSQL treats NULLs as distinct, so they are outside the
index and cannot block it. They are excluded above for the same reason.

### If it returns rows

Each group is one reader whose progress split across two runs. Keep the run that
holds the most progress and retire the others — do not delete them, because the
attempts and answers hanging off them are the reader's evidence.

Inspect a group before deciding:

```sql
SELECT r.id,
       r.status,
       r.stage,
       r.current_part,
       r.completed_parts,
       r.xp_awarded,
       r.updated_at,
       (SELECT count(*) FROM focus_activestudyattempt a WHERE a.run_id = r.id) AS attempts
FROM   focus_activestudyrun r
WHERE  r.user_id = :user_id
  AND  r.sheet_id = :sheet_id
  AND  r.difficulty = :difficulty
  AND  r.status = 'active'
ORDER  BY r.current_part DESC, r.updated_at DESC;
```

Keep the first row of that ordering — furthest progress, then most recent — and
set the rest to `status = 'completed'`. That keeps the history addressable while
leaving exactly one active run, which is what the index requires. XP is
unaffected: `award_xp` is keyed on `(user, source_key, rule_code)` and a retired
duplicate cannot re-award anything.

Re-run the detection query and confirm zero rows before releasing.

---

## 2. Before `payments.0005_alter_manualrechargecode_digest_and_more`

This one **drops** two unique indexes and replaces them with plain indexes. A
drop cannot conflict with existing data, so there is no pre-flight condition and
no failure mode from current rows.

Worth recording the shape beforehand so the change is visible afterwards:

```sql
SELECT count(*)                          AS submissions,
       count(DISTINCT recharge_code_digest) AS distinct_cards
FROM   payments_manualrechargesubmission;
```

After the migration those two numbers may legitimately diverge: the same card
number can now appear on more than one submission, which is what lets a genuine
second manual attempt reach a reviewer.

Uniqueness that remains, and must still hold:

```sql
-- One pending submission per user (manual_payment_one_pending_per_user).
SELECT user_id, count(*)
FROM   payments_manualrechargesubmission
WHERE  status = 'pending'
GROUP  BY user_id
HAVING count(*) > 1;

-- One payment per (account, idempotency key) (payment_account_idempotent).
SELECT account_id, idempotency_key, count(*)
FROM   payments_payment
GROUP  BY account_id, idempotency_key
HAVING count(*) > 1;
```

Both must return zero rows. They are existing constraints, so they will.

---

## 3. Orphaned refund reservations (no migration; clean-up decision)

`AdminRefundRequestView` committed the `Refund` row before asking the provider,
and the provider always refuses while `PAYMENT_PROVIDER=none`. Each failed
attempt therefore left a `requested` refund that still counts toward the
reserved amount in `request_refund`, permanently shrinking what the payment can
refund later.

The code is fixed. Rows already written are not, and this only detects them —
**do not delete anything automatically.**

```sql
SELECT r.id            AS refund_id,
       r.payment_id,
       r.amount_minor,
       r.currency,
       r.status,
       r.requested_at,
       p.amount_minor  AS payment_amount_minor,
       p.status        AS payment_status
FROM   refunds_refund r
JOIN   payments_payment p ON p.id = r.payment_id
WHERE  r.status = 'requested'
  AND  NOT EXISTS (
         SELECT 1
         FROM   provider_integrations_providerobjectlink l
         WHERE  l.object_type = 'refund'
           AND  l.internal_id = r.id
       )
ORDER  BY r.requested_at;
```

A row here is a refund that was reserved but never reached a provider. Two
signals separate a genuine orphan from a refund legitimately awaiting a
provider: a provider link is absent, and `requested_at` is old.

How much refundable balance each affected payment has lost:

```sql
SELECT p.id,
       p.amount_minor,
       coalesce(sum(r.amount_minor) FILTER (
         WHERE r.status IN ('requested', 'pending', 'succeeded')
       ), 0) AS reserved_minor
FROM   payments_payment p
JOIN   refunds_refund r ON r.payment_id = p.id
GROUP  BY p.id, p.amount_minor
HAVING coalesce(sum(r.amount_minor) FILTER (
         WHERE r.status IN ('requested', 'pending', 'succeeded')
       ), 0) > p.amount_minor;
```

Resolution is a decision for whoever owns billing, not a migration. The
audit-preserving option is to transition each orphan to `cancelled` through the
refund transition machinery so the attempt stays in the ledger with a reason,
rather than deleting the row.

Expect zero rows if no operator ever pressed refund while the provider was
disabled.

---

## 4. After the release

```sql
-- Both indexes present and of the expected kind.
SELECT indexname, indexdef
FROM   pg_indexes
WHERE  indexname = 'active_study_one_active_run_per_sheet';

SELECT indexname, indexdef
FROM   pg_indexes
WHERE  tablename IN ('payments_manualrechargesubmission', 'payments_manualrechargecode')
  AND  indexdef ILIKE '%digest%';
```

The first must exist and be `UNIQUE ... WHERE (status = 'active'::text)`. The
second pair must exist and must **not** say `UNIQUE`.
