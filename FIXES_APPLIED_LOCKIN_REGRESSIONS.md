# Fixes applied — Lock-in regressions

Companion to `DIAGNOSTIC_REPORT_LOCKIN_REGRESSIONS.md`. Same five defects, in the
same order.

**Verification:** backend 598 passed / 4 skipped (SQLite), ruff clean, ruff format
clean, mypy clean on 453 files, `makemigrations --check` reports no pending model
changes. Frontend 301 passed, eslint clean (`--max-warnings 0`), `vite build`
clean. Backend tests were run with `LOCKIN_TEST_USE_SQLITE=1` — there is no local
PostgreSQL or Docker on this machine, so **row-locking behaviour and the edge
container smoke test are unverified here and need CI**.

---

## 1. Telegram Approve/Reject — a provisioning path, and a visible reason

The failure was never in the check; it was that nothing could satisfy it.

| Change | File |
|---|---|
| `manage.py telegram_operator --list / --link / --revoke` | `backend/apps/payments/management/commands/telegram_operator.py` *(new)* |
| Refusals carry a machine-readable `code`, logged and pushed into the `telegram.webhook.rejected` metric | `backend/apps/payments/telegram_actions.py`, `telegram_views.py` |
| `review_manual_recharge(source=...)`, so the audit trail distinguishes a chat button from the console | `backend/apps/payments/manual_services.py` |
| Preflight warns when the webhook is configured with no operator linked; reports `telegram_payment_operators` in its evidence | `backend/platform_core/management/commands/production_preflight.py` |
| Doc corrected: the shell snippet is replaced by the command; the 403 claim; the `source` claim; **and the previously undocumented fact that rotating `DJANGO_SECRET_KEY` / the bot token / the webhook secret invalidates every button already in the chat** | `docs/TELEGRAM_PAYMENT_ACTIONS.md` |

`--link` refuses an account that does not hold `payments.manage`, rather than
creating a link that could never work. `--revoke` deactivates and keeps the row,
because it is the audited actor on past reviews.

**To fix production, one command:**

```bash
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_operator --link <NUMERIC_TELEGRAM_USER_ID> \
  --user <ADMIN_EMAIL> --label "Primary"
```

Then `--list` to confirm. If the logs show `code="callback_signature"` instead,
the cause is a rotated credential and the pending payments need re-notifying or a
console review — no link will help.

## 2. Missing subjects — the projection is now maintained, and loading is not emptiness

**Backend.** `CatalogSubject` was written once, by migration `content.0006`.
It now has a rule that runs whenever the answer can change:

| Change | File |
|---|---|
| The projection rule, expressed once | `backend/apps/content/catalog_subjects.py` *(new)* |
| Runs on subject create/rename and on a cohort's `content_nodes` changing, after commit | `backend/apps/content/signals.py` *(new)*, `apps.py` |
| Runs at publish time for a branch that does not exist yet | `backend/apps/content/admin_services.py` |
| `manage.py sync_catalog_subjects [--dry-run]`, which also names cohorts that expose nothing | `backend/apps/content/management/commands/sync_catalog_subjects.py` *(new)* |
| One-off reconciliation for existing databases | `backend/apps/content/migrations/0007_backfill_catalog_subjects.py` *(new)* |
| The per-subject document query became one grouped query | `backend/apps/content/views.py` |

The projection deliberately **never** deactivates a branch, re-homes one to
another cohort, or invents a curriculum — a subject disappearing is the failure
being fixed, so a background sync is not allowed to cause it.

**Frontend.** `useCatalogMaterials` was rewritten:

- one shared entry per enrolment, so the four screens between Materials and an
  open sheet stop re-fetching and re-blanking the list on every hop;
- a resolved entry is applied on first render, so navigation has no loading frame;
- a failed list is never cached as a result;
- `loading` and `error` are exposed and **all three** components in
  `Materials.jsx` now gate on them with a retry, instead of rendering "no
  materials" / "not found".

Verified against a freshly migrated database: all six dentistry cohorts
(Tripoli / Benghazi / Zawiya × year-1 / year-2) expose their full 6 or 7 subjects
with zero sheets published.

### One thing I did not fix, deliberately

`medical-sciences-tripoli/preparatory` has **no content root at all** —
`education.0005` created the cohort, `education.0007` never attached a year node.
Its students genuinely have no subjects. Inventing a curriculum for it would be
worse than saying so, so it is now *reported* (by the sync command, and by
preflight as `cohorts_without_catalog_subjects`) and needs a content decision
from you. If students are enrolled there, this is the remaining outage.

## 3. New sheets invisible to students

Two separate causes, both addressed:

- **The Draft default.** The Add-sheet form defaulted to Draft — visible in
  Content Studio, invisible to every student, with nothing saying so. It now
  defaults to Published, keeps Draft as a choice, and says beneath the form that
  a draft is visible there and to no student.
- **The silent no-op.** `_sync_catalog_document` returned silently when a subject
  had no Catalog branch, *and the caller then notified every student about a
  sheet none of them could open*. It now returns whether the sheet is reachable;
  the notification is suppressed when it is not; `serialize_sheet` reports
  `student_visible`; and Content Studio badges such a sheet **Not visible to
  students**.

I considered refusing the publish outright and rejected it: content outside every
cohort's Catalog is a deliberate capability in this codebase, and blocking it
would be a behaviour change wider than the bug. Surfacing it is the honest fix.

## 4. PDF worker MIME, and the "not found" flash

- **`deploy/container-host/nginx.conf.template` had no `.mjs` rule.** `7cecba2`
  fixed only `frontend/nginx/default.conf`, so on the managed-container shape the
  worker was still `application/octet-stream`. Added, with the same
  `default_type` + `try_files $uri =404` shape, and a test asserting **both**
  configs carry it so they cannot drift again.
- Emitted worker confirmed unchanged: `dist/assets/pdf.worker.min-BmVo14Nb.mjs`.
- The "not found" flash is addressed by the shared cache and the three loading
  gates in item 2.

**Still needs one check from you**, because it depends on which shape serves
lockin.ly:

```bash
curl -sI https://lockin.ly/assets/pdf.worker.min-BmVo14Nb.mjs | grep -i '^content-type\|^HTTP'
```

Also unverified here: existing clients running a service worker registered under
the broken deployment. The worker is not in the precache manifest, so this is
unlikely, but `registerType: "prompt"` means an old worker persists until the
user accepts an update.

## 5. Subject slug divergence

`education.0009` renames the node `removeable-prosthodontic` →
`removable-prosthodontic` (and its title to "Removable Prosthodontic");
`content.0007` carries the rename through `CatalogSubject.slug`,
`CatalogSubject.material_slug` **and** `CatalogDocument.material_slug`, which is
a denormalised copy — a rename that missed it would have left every published
sheet on that subject unreachable.

Confirmed on a freshly migrated database: 3 nodes renamed, 0 rows anywhere still
spelled `removeable`, and the three branches now read
`dentistry-{tripoli,benghazi,zawiya}-year-2-removable-prosthodontic`, matching
the frontend catalogue.

---

## Tests added

The report's central finding was that the existing suites created the rows they
then read back, so the provisioning gaps were invisible to them. The new tests
start from the hierarchy and from the command line.

**`backend/apps/content/tests/test_catalog_subject_projection.py`** (9) — a
cohort's subjects appear with zero sheets; a subject added after the cohort
exists appears; a rename keeps the route key; the projection never reactivates a
retired branch or moves one between cohorts; publishing outside every cohort is
surfaced and not announced; a visible sheet reports itself visible; a cohort with
no content root is reported rather than guessed at.

**`backend/apps/payments/tests/test_telegram_operator_command.py`** (8) — the
command links an operator **and the webhook then actually approves a payment
end-to-end** (the test that was missing); Telegram and console reviews are
distinguishable on the audit trail; a link without `payments.manage` is refused
at creation; a revoked link stops acting but keeps its history; `--list` says
plainly when nothing is linked, and flags a link whose account lost the
capability.

**`frontend/tests/catalog-visibility.test.js`** (5) — all three catalogue screens
separate "not loaded" from "nothing here"; the directory is fetched once per
enrolment; the local catalogue and the seeded hierarchy agree on every subject
slug; **both** nginx configs serve `/assets/*.mjs` as JavaScript; a new sheet
defaults to the state students can see.

Two existing tests were updated rather than worked around:
`test_sheet_create_publish_notify_update_unpublish_and_safe_delete` now attaches
a cohort, because it asserts students are notified and students are only notified
about sheets they can open; and the preflight evidence tests pin the two new
fields.

## Deployment order

```bash
# 1. Migrate. content.0007 backfills the projection and carries the slug rename.
docker compose -f compose.production.yaml run --rm backend python manage.py migrate

# 2. Confirm the projection, and read the orphan-cohort warning.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py sync_catalog_subjects --dry-run

# 3. Link a Telegram operator (see item 1), then confirm.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_operator --list
```

Nothing here deletes payment, subscription, account or content history.
