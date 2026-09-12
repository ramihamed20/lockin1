# Lock-in production regression diagnosis

**Release under investigation:** `7f438f0b1a2aa307ce611da78cd3379850ec1d2d` (merge of PR #11, 2026-09-12 00:54 +0200)
**Scope:** diagnosis only. No code, migration, configuration or data was changed.
**Method:** source trace + `git log/show` causal analysis of the two commits that introduced the affected subsystems:

| Commit | Date | What it introduced |
|---|---|---|
| `e2e76fd` "release: harden auth and production readiness" | 2026-09-11 03:08 | `CatalogSubject`, server-authoritative `/catalog/materials`, the whole Telegram callback/authorization subsystem, `TelegramPaymentOperator` |
| `7cecba2` "fix: harden production delivery paths" | 2026-09-12 00:05 | removed the frontend local catalog fallback, added the workspace loading gate, added the nginx `.mjs` rule, changed the Telegram 403 into a silent acknowledgement |

Everything below is reproduced from the code at the release commit.

---

## Executive summary

There are **five distinct defects**, not one. Two of them share a root shape ("the new server-authoritative model has no provisioning path for its own rows"), and one of them is not a regression at all — it is a UI default working exactly as written.

| # | Defect | Layer | Severity |
|---|---|---|---|
| 1 | Telegram Approve/Reject can never succeed: `TelegramPaymentOperator` has **no way to be created** in production | Backend design gap + data | **Critical** |
| 1b | `7cecba2` converted the 403 into a silent "This action is not available." — this is why the webhook looks healthy | Backend, masking | High (diagnostic blindness) |
| 2 | Students lost subjects: `CatalogSubject` rows are seeded **once, by a migration**, and nothing else ever creates them; the frontend fallback that used to hide this was deleted in `7cecba2` | Backend data + frontend regression | **Critical** |
| 2b | `Materials.jsx` ignores `loading`/`error` → renders "no materials" during every load and permanently on any API error | Frontend regression (`7cecba2`) | **Critical** |
| 3 | New sheets invisible to students: Content Studio's status selector **defaults to Draft**, and `_sync_catalog_document` is silently skipped for unmapped subjects | Product default + backend silent no-op | High |
| 4a | PDF worker MIME fix is **incomplete**: applied to `frontend/nginx/default.conf` only, not to `deploy/container-host/nginx.conf.template` | Production configuration | High (if that shape is in use) |
| 4b | "Not found" flash persists on `/materials/catalog/:slug` and `/…/sheets/:slug`; the loading gate was added only to the workspace route | Frontend, partially fixed | Medium |
| 5 | Subject slug divergence: backend seeds `removeable-prosthodontic`, frontend hard-codes `removable-prosthodontic` | Data/frontend mismatch | Medium |

---

# 1. Payment / subscription approval regression

## 1.1 Observed behaviour

Pressing **Approve** or **Reject** in Telegram produces a toast and no state change. The webhook reports `pending_update_count: 0`, `last_error_message: null`.

The toast text is emitted by exactly one code path:

`backend/apps/payments/telegram_views.py:80-94`
```python
except TelegramAuthorizationError as error:
    logger.warning("Rejected an unauthorized Telegram payment action", extra={"reason": str(error)})
    providers.metric_sink.increment("telegram.webhook.rejected", attributes={"reason": "unauthorized"})
    _answer_callback(callback_query, "This action is not available.")
    return Response({"status": "ignored"})
```

So the callback **is** reaching Django, the secret **is** validating, and the failure is `TelegramAuthorizationError`. That answers your questions 1, 2 and 10 immediately: this is an **authorization failure**, not signing, not payment state, not transport.

## 1.2 Answers to your numbered questions

1. **Is the callback reaching Django?** Yes. `pending_update_count: 0` and `last_error_message: null` prove Telegram received a 2xx. The only 2xx paths are `{"status": "handled"}`, `{"status": "ignored"}` and `{"status": "error"}`. Since nothing changes and the user sees a message, it is the `ignored` branch above.
2. **Is webhook secret validation succeeding?** Yes — a bad secret returns `404` at `telegram_views.py:53-58` and never calls `answerCallbackQuery`, so Telegram would report `last_error_message`. It does not.
3. **Is callback signature validation succeeding?** Cannot be distinguished from the chat/operator checks by the user-visible text — all four raise `TelegramAuthorizationError`. See §1.4 for how to separate them from the logs. Signature failure is a *secondary* candidate (§1.5).
4. **Which Telegram user ID is received?** `callback_query.from.id`, narrowed to `{"id": ...}` by `_sanitised()` (`telegram_views.py:114-137`) and stringified at `telegram_actions.py:108`.
5. **How is it mapped to an operator?** `telegram_actions.resolve_operator()` (`telegram_actions.py:55-76`) → `TelegramPaymentOperator.objects.filter(telegram_user_id=<str>, is_active=True).first()`.
6. **What capability is required?** `Capability.PAYMENTS_MANAGE` = `"payments.manage"`, evaluated live at click time via `has_operational_capability` (`apps/administration/permissions.py:35`).
7. **Does the configured operator have it?** **There is no configured operator.** See §1.3.
8. **Is the payment in a valid state?** Irrelevant — execution never reaches the payment lookup. The chat/operator checks run first (`telegram_actions.py:104-111`), before `parse_callback_data` and before `_review`.
9. **Is the callback referencing the correct PaymentIntent?** `callback_data` carries `p1:<a|r>:<32-hex payment id>:<10-hex HMAC>` and resolves to `ManualRechargeSubmission.payment_id`. Correct by construction, but never reached.
10. **Cause class?** **Authorization** (operator link absent), with callback signing as a secondary candidate if the secret/`SECRET_KEY` was rotated.
11. **Introduced by a recent commit?** The *capability* was introduced by `e2e76fd`; it has never worked in production. `7cecba2` changed the *symptom* from "button spins forever / Telegram retries" to "toast, webhook looks perfectly healthy".
12. **Intended vs runtime path?** They diverge in two places — see §1.6.

## 1.3 Root cause

**`TelegramPaymentOperator` has no provisioning path anywhere in the product.**

Full inventory of references (`grep -rn "TelegramPaymentOperator" --include=*.py`, excluding `__pycache__`):

```
apps/payments/migrations/0006_telegrampaymentoperator.py   # CreateModel only — no data seed
apps/payments/models.py:185                                # model definition
apps/payments/telegram_actions.py:28,55,65,140,147         # read path only
apps/payments/tests/test_telegram_actions.py:28,60,64,336,452   # test fixtures
```

There is:
- **no Django admin registration** — `apps/payments/admin.py` registers only `Payment`, `PaymentTransition`, `ManualRechargeSubmission`, and the edge returns `404` for `/admin/` anyway (`frontend/nginx/default.conf`, `location ^~ /admin/ { return 404; }`);
- **no management command** — `apps/payments/management/commands/` contains only `telegram_webhook.py`;
- **no admin_control API** — `apps/admin_control/urls.py` has no Telegram operator route;
- **no data migration** seeding a row.

`docs/TELEGRAM_PAYMENT_ACTIONS.md` confirms this is intentional:

> Create a link from the Django shell (there is deliberately no self-service API)
> ```python
> TelegramPaymentOperator.objects.create(user=..., telegram_user_id="123456789", label="Night shift")
> ```

**If that shell command was never run against the production database, the table is empty, and `resolve_operator` raises `"No active operator link for this Telegram account."` on every single button press — forever, for every operator, for every payment.** This matches the reported behaviour exactly: 100% failure, no state change, no Telegram-side error.

### Exact failure line

`backend/apps/payments/telegram_actions.py:64-70`
```python
operator = (
    TelegramPaymentOperator.objects.select_related("user")
    .filter(telegram_user_id=telegram_user_id, is_active=True)
    .first()
)
if operator is None:
    raise TelegramAuthorizationError("No active operator link for this Telegram account.")
```

## 1.4 How to confirm on production (read-only)

Three read-only checks, in order of decisiveness:

```bash
# A. Is the table empty? (read-only ORM query)
docker compose -f compose.production.yaml run --rm backend python manage.py shell -c \
  "from apps.payments.models import TelegramPaymentOperator as T; print(T.objects.count(), list(T.objects.values('telegram_user_id','is_active','user__email')))"
```

```bash
# B. The exact reason is already in the logs — it is logged, just not shown in Telegram.
docker compose -f compose.production.yaml logs backend | grep "Rejected an unauthorized Telegram payment action"
```

The `extra={"reason": ...}` field distinguishes all four causes verbatim:

| Logged reason | Meaning |
|---|---|
| `Update did not originate in an authorized chat.` | `message.chat.id` ∉ {`TELEGRAM_ADMIN_CHAT_ID`, `TELEGRAM_PAYMENT_CHAT_ID`} |
| `Update carries no Telegram sender.` | malformed update |
| `No active operator link for this Telegram account.` | **the expected finding** |
| `The linked Lock-in account is not active.` | `user.status != ACTIVE` or `not user.is_active` |
| `The linked account cannot manage payments.` | no `payments.manage` |
| `Telegram callback data failed verification.` | HMAC mismatch → see §1.5 |

```bash
# C. Metric counter, if the sink is wired to a backend you can query
telegram.webhook.rejected{reason="unauthorized"}   # vs telegram.webhook.handled
```

## 1.5 Secondary candidate: callback signature

`apps/payments/telegram.py:96-100`
```python
def _callback_signing_key() -> bytes:
    token  = settings.TELEGRAM_BOT_TOKEN
    secret = settings.TELEGRAM_WEBHOOK_SECRET_TOKEN
    material = f"{token}|{secret}|{settings.SECRET_KEY}"
    return hashlib.sha256(f"lockin:telegram-callback:v1:{material}".encode()).digest()
```

The signing key is derived from **`DJANGO_SECRET_KEY`**. Consequence, which is not documented:

> **Rotating `DJANGO_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` or `TELEGRAM_WEBHOOK_SECRET_TOKEN` permanently invalidates every Approve/Reject button already sitting in the chat history.** Those buttons then produce the identical "This action is not available." toast.

`docs/TELEGRAM_PAYMENT_ACTIONS.md` documents bot-token rotation but says nothing about the buttons it silently kills. If check B above reports `Telegram callback data failed verification.` rather than the operator reason, this is the cause instead, and the fix is different (re-send the notification, not create an operator row).

A third, cheaper discriminator: if **old** notifications fail but a **freshly submitted** payment's buttons also fail, it is the operator link; if only old ones fail, it is key rotation.

## 1.6 Intended implementation vs runtime path

Two documented behaviours do not match the code:

**(a) The audit record cannot distinguish Telegram from the console.** The doc claims:

> That administrator is the actor … identical to a console review, with `source="payments.telegram"` distinguishing the channel.

`apps/payments/manual_services.py:547-551` hard-codes it:
```python
record_audit(
    actor=actor,
    action=audit_action,
    domain="payments",
    ...
    source="admin_control.api",   # ← always, regardless of channel
)
```
The only channel evidence is the review reason string (`"Approved from Telegram by <label>."`, `telegram_actions.py:149`) and `PaymentTransition.idempotency_key` prefix `manual-review:telegram-review:…`. **There is no queryable `source` discriminator.**

**(b) The doc says an unauthorized chat is answered with `403`.** It was, until `7cecba2` replaced it with a 200 + toast. The doc's "Failure behaviour" section was updated; its "Authorization" section (point 2, "Anywhere else is 403") was not.

## 1.7 Why the tests did not catch it

`backend/apps/payments/tests/test_telegram_actions.py` is unusually thorough — 23 tests covering secret rejection, unauthorized chat, unlinked account, deactivated link, missing capability, malformed/unsigned data, redelivery idempotency, concurrent presses, transport failure.

It cannot catch this bug because of `test_telegram_actions.py:60-66`:
```python
def _operator(*, capability: bool = True) -> TelegramPaymentOperator:
    ...
    return TelegramPaymentOperator.objects.create(...)
```
**Every happy-path test creates the operator row itself.** The tests validate the read path given a provisioned link; production has no way to provision one. This is the classic "tested the function, not the system" gap: no test asserts that *some supported operation* can create a `TelegramPaymentOperator`.

### Missing regression tests
- A test asserting that an operator link is creatable through a supported interface (API, management command, or admin), failing loudly if none exists.
- A deployment/preflight check that warns when `TELEGRAM_WEBHOOK_SECRET_TOKEN` is configured but `TelegramPaymentOperator.objects.filter(is_active=True).count() == 0` — a webhook registered with nobody able to use it.
- A test asserting `record_audit(source=...)` differs between the console and Telegram paths (currently the doc's claim is untested and false).
- A test pinning the signing-key derivation's dependency on `SECRET_KEY` and asserting the operational consequence is documented.

## 1.8 Current web/admin subscription & payment capabilities (inventory only)

You asked what already exists before any design work. It is more than expected.

### Backend — already present

| Concern | Endpoint | Service | Capability |
|---|---|---|---|
| List payments | `GET /api/v1/operations/admin/purchases` | `admin_purchases()` | `payments.view` |
| Payment detail | `GET …/purchases/<payment_id>` | | `payments.view` |
| **Approve / reject manual payment** | `POST …/purchases/<payment_id>/manual-review` | `review_manual_recharge()` | `payments.manage` |
| Refund | `POST …/purchases/<payment_id>/refunds` | | `payments.manage` |
| Status correction (dual control) | `POST …/purchases/<id>/corrections`, `…/corrections/<id>/review` | | `payments.manage` |
| List / detail subscriptions | `GET …/subscriptions`, `…/subscriptions/<id>` | | `subscriptions.view` |
| **Terminate / suspend / cancel subscription** | `POST …/subscriptions/<id>/actions` | `manage_subscription()` | `subscriptions.manage` |

`SubscriptionActionSerializer` (`apps/admin_control/serializers.py:82-100`) already accepts:
`activate`, `reactivate`, `suspend`, **`cancel_now`**, `cancel_period_end`, `extend`, `change_expiration`, `change_plan` — each requiring `reason` (min 8 chars) and an idempotency key.

### Rejection reason — already stored and auditable

`review_manual_recharge` (`apps/payments/manual_services.py:449-551`) on reject writes the reason into **four** durable places:
1. `ManualRechargeSubmission.rejection_reason` (500 chars)
2. `SubscriptionTransition.metadata["rejection_reason"]`
3. `PaymentTransition.metadata["review_reason"]`
4. `AuditRecord.reason` via `record_audit(...)`

It also creates a required in-app `Notification` to the payer carrying the reason, in Arabic or English by `user.preferred_language`.

### Termination does not delete history — already true

`manage_subscription` → `transition_subscription(to_status=CANCELLED, source=ADMIN, …)` writes a `SubscriptionTransition` and a `SubscriptionAdminEvent`; nothing is deleted. `Payment` rows are `on_delete=PROTECT` from `PaymentTransition`.

### Frontend — already present

`frontend/src/pages/OperationsAdmin.jsx`:
- `PurchaseDetail` + `ManualPaymentReviewPanel` (line 259-263) — Approve / Reject buttons, a **required** review-reason input, a confirm dialog, and display of an existing `rejection_reason`. Gated on `hasOperationalCapability(session, "payments.manage")` and `submission.status === "pending"`.
- `SubscriptionDetail` (line 277-279) — action `<select>` including `cancel_now` and `suspend`, required reason (min 8), confirm dialog, and an "Immutable history" panel rendering `admin_events`.

### Shared canonical service — yes

Both the Telegram adapter (`telegram_actions._review` → `review_manual_recharge`) and the web API (`AdminManualPaymentReviewView.post` → `review_manual_recharge`) call **the same function**. The only difference is `send_notification=False` from Telegram (which suppresses only the duplicate outbound Telegram message) and the idempotency key prefix.

### What is genuinely missing

1. **No way to create/manage a `TelegramPaymentOperator`** — the defect above.
2. **Rejection reason minimum is 3 characters** (`ManualPaymentReviewSerializer`, and `review_manual_recharge`'s own `len(reason.strip()) < 3`) versus 8 for subscription actions. "ok" is rejected; "bad" is accepted. If you want a *meaningful* written reason this is too weak.
3. **No structured rejection reason codes** — free text only, so rejections are not aggregable.
4. **Audit `source` does not distinguish channel** (§1.6a).
5. **No UI surface that goes payment → subscription** — an operator approving a payment in `PurchaseDetail` has no link to that user's subscription to terminate it later; they must find it in the Subscriptions tab separately.
6. `cancel_now` is named as a lifecycle transition, not as "terminate", and the frontend `<select>` exposes `change_plan`-less raw action names via `humanize()`.

*(No design proposed, per instruction.)*

---

# 2. Student content / subject regression

## 2.1 Observed vs expected

**Observed:** students who previously saw their subject list — including subjects with 0 sheets — now see subjects missing entirely, or an empty "no materials" state.

**Expected (your rule):** subjects come from the student's education hierarchy; sheet count is independent of subject visibility.

## 2.2 The backend is NOT the omission source — proof

`backend/apps/content/views.py:127-196` builds the response from `CatalogSubject`, then attaches sheets. A subject with zero documents is still appended:

```python
for subject in subjects:
    documents = CatalogDocument.objects.filter(...)
    if subject.cohort.code == "year-3" and not documents.exists():
        continue                       # ← the ONLY omission, and year-3 is never seeded
    sheets = [...]                     # empty list is fine
    results.append({"slug": ..., "title": ..., "sheets": sheets, "cohort": {...}})
```

This is asserted by `backend/apps/content/tests/test_catalog_workspace.py:94` — the `other` cohort's subject has **no** documents and is still returned (`other_directory.json()["results"] == ["catalog-materials-other-dental-anatomy"]`).

**So: your question 2 ("which query now requires a published CatalogDocument before returning the subject") — none does.** And question 4 ("did server-authoritative catalog changes remove empty subjects") — no. The cause is upstream of the query.

## 2.3 Root cause A — `CatalogSubject` rows are seeded once, by a migration, and never again

`backend/apps/content/migrations/0006_catalogsubject.py`:
```python
def seed_catalog_subjects(apps, schema_editor):
    for cohort in StudentCohort.objects.prefetch_related("content_nodes").all():
        for root in cohort.content_nodes.all():
            for subject in EducationNode.objects.filter(parent_id=root.id, kind="subject"):
                CatalogSubject.objects.update_or_create(cohort_id=cohort.id, slug=subject.slug, defaults={...})
```

Full inventory of writers (`grep -rn "CatalogSubject" --include=*.py`, excluding migrations/`__pycache__`):
```
apps/content/admin_services.py:104   CatalogSubject.objects.filter(...)   # READ
apps/content/admin_views.py:104,174  CatalogSubject.objects.filter(...)   # READ
apps/content/views.py:137            CatalogSubject.objects.filter(...)   # READ
apps/content/tests/…                 .create(...)                          # tests only
```

**Nothing in the running application ever creates a `CatalogSubject`.** Consequences:

| Scenario | Result today |
|---|---|
| Cohort with **no** `content_nodes` at migration time | Zero `CatalogSubject` rows → `/catalog/materials` returns `{"count": 0, "results": []}` → **student sees nothing** |
| A subject `EducationNode` added **after** `0006` ran | No `CatalogSubject` → invisible to students forever, and `_sync_catalog_document` silently drops its sheets (§3) |
| A new college / year / branch added later | Same — invisible |

`apps/education/migrations/0007_seed_libyan_education_tree.py` calls `cohort.content_nodes.set([year])` for the six dentistry cohorts (tripoli/benghazi/zawiya × year-1/year-2) and the two Human Medicine batches (60, 61).

**It never sets `content_nodes` for the `preparatory` cohort** (`TRIPOLI_PREPARATORY_ID = a19b3034-…-7b113329c003`, program `medical-sciences-tripoli`), created in `0005_restore_legacy_dentistry_and_preparatory_cohorts.py`. Every student on that cohort therefore has **zero** `CatalogSubject` rows and sees an empty Materials page.

Answering your numbered questions:
- **9. Do student cohort IDs and CatalogSubject IDs still align?** They align only for cohorts that had `content_nodes` at the moment `0006` ran. Every other enrolment is orphaned.
- **10. Do subjects exist in the DB but get filtered from API output?** No — the `EducationNode` subjects exist, but the **`CatalogSubject` projection rows do not exist at all** for the affected cohorts. This is a data-completeness bug, not a filter bug.
- **8. Are Tripoli/Zawiya scoped correctly?** Yes, structurally: `0007` gives each college its own `EducationNode` subtree (`institution → college → department → academic_year → subject`), and `cohort.content_nodes` points only at that cohort's own year node. Titles are shared across colleges but nodes are not, so no cross-college leak. Zawiya's problem, if any, is missing rows, not wrong scoping.
- **6. Does admin/founder behaviour differ from student behaviour?** **Yes, materially.** `views.py:138` — `if not is_content_administrator(user)` skips the cohort filter entirely, so any user with `content.manage` or administrator role sees **every** `CatalogSubject` in the system. This is why "admin can see the newly added sheets" and students cannot: you are not looking at the same query.

### Read-only confirmation queries

```bash
docker compose -f compose.production.yaml run --rm backend python manage.py shell -c "
from apps.education.models import StudentCohort
from apps.content.models import CatalogSubject
from apps.accounts.models import User
for c in StudentCohort.objects.select_related('program').all():
    print(c.program.code, c.code,
          'nodes=', c.content_nodes.count(),
          'catalog_subjects=', CatalogSubject.objects.filter(cohort=c, is_active=True).count(),
          'students=', User.objects.filter(cohort=c, status='active').count())
"
```
Any row with `students > 0` and `catalog_subjects = 0` is a cohort whose students currently see an empty Materials page.

```bash
# Subject EducationNodes with no CatalogSubject projection at all
docker compose -f compose.production.yaml run --rm backend python manage.py shell -c "
from apps.education.models import EducationNode
from apps.content.models import CatalogSubject
mapped = set(CatalogSubject.objects.values_list('source_node_id', flat=True))
print([ (n.slug, str(n.id)) for n in EducationNode.objects.filter(kind='subject') if n.id not in mapped ])
"
```

There is a diagnostic command already shipped for the adjacent question:
`backend/apps/education/management/commands/audit_cohort_content_mappings.py` (added in `e2e76fd`) — worth running, read-only.

## 2.4 Root cause B — the frontend fallback that used to hide Root Cause A was deleted

**This is the commit that turned a latent data gap into a visible regression.**

`7cecba2` — `frontend/src/hooks/useCatalogMaterials.js`:
```diff
-import { getCohortMaterials, withE2eFixtureSheets } from "../lib/materialCatalog.js";
+import { withE2eFixtureSheets } from "../lib/materialCatalog.js";

 export function useCatalogMaterials(user) {
-  const fallback = getCohortMaterials(user);
   const catalog = useAsyncData(() => catalogWorkspaceApi.materials(), [...]);
   return {
-    materials: Array.isArray(catalog.data?.results) ? withE2eFixtureSheets(catalog.data.results) : fallback,
+    materials: withE2eFixtureSheets(Array.isArray(catalog.data?.results) ? catalog.data.results : []),
```

Causal statement in the form you asked for:

> **Before `7cecba2`**, whenever `catalog.data?.results` was not an array — which is the case for the **entire duration of every request** (`useAsyncData` initialises `{loading: true, data: null}`, `useAsyncData.js:20`) and for **every failed request** — `useCatalogMaterials` returned `getCohortMaterials(user)`: the hard-coded per-cohort subject list in `frontend/src/lib/materialCatalog.js`, which contains all 6 first-year and all 7 second-year dentistry subjects with `sheets: []`.
>
> **`7cecba2` replaced that fallback with `[]`.**
>
> **Therefore** a student whose server response is empty (Root Cause A), slow, or failing now renders an empty subject list where the local catalogue used to fill it in. The subject list stopped being "hierarchy-derived with a server overlay" and became "server-only, with no floor".

## 2.5 Root cause C — `Materials.jsx` never renders `loading` or `error`

`frontend/src/pages/Materials.jsx:11-34`
```jsx
export default function Materials({ user = null }) {
  const { materials } = useCatalogMaterials(user);      // loading and error DISCARDED
  ...
  {materials.length === 0
    ? <EmptyState icon="study" title={t("materials.noCohortMaterialsTitle")} … />
    : …}
```

`7cecba2` added a loading gate to `CatalogFocusWorkspace.jsx:545-546` **but not to `Materials.jsx`**. So:

- **During every load**, the Materials page asserts "you have no materials" rather than showing a spinner.
- **On any API error** — expired session, 5xx, network blip, Cloudflare hiccup — the page shows the same permanent "no materials" empty state with no retry affordance. `useAsyncData` sets `{loading:false, error:<msg>, data:null}`; `Materials.jsx` reads neither.

The same omission affects `CatalogMaterialSheets` (line 45-52) and `CatalogSheetStudy` (line 66-79), which render `ErrorPanel "not found"` during the loading window — see §4.2.

### Answers to your remaining questions
- **3. Is the frontend deriving subjects from returned documents?** Yes, in effect. `materials` **is** the subject list; there is no separate subjects source once the fallback was deleted. The server's `/catalog/materials` correctly returns 0-sheet subjects, so the *shape* is right — but the frontend has no floor when that list is empty for any reason.
- **5. Did the fallback removal remove valid hierarchy-only subjects?** Yes. That is precisely the mechanism. `getCohortMaterials` was the last remaining representation of "these subjects exist regardless of content".
- **11. Backend, frontend, or both?** **Both, and they compound.** Backend supplies no rows for orphaned cohorts (A); frontend no longer compensates and misreports loading/error as emptiness (B, C). Fixing either alone leaves the other class of student broken.

## 2.6 Root cause D — slug divergence (separate, smaller)

| Source | Slug |
|---|---|
| `education/migrations/0007` — title `"Removeable prosthodontic"` → `title.lower().replace(" ","-")` | `removeable-prosthodontic` |
| `frontend/src/lib/materialCatalog.js` `SECOND_YEAR` | `removable-prosthodontic` |

So the server's `material_slug` is `dentistry-<college>-year-2-remove**a**ble-prosthodontic` while the frontend's hard-coded catalogue (still used by `Questions.jsx:62,82` and by `tests/materials-catalog.test.js:29`) says `remov**a**ble`. Any remembered route, bookmark, or Questions→Materials cross-link for that one subject resolves to nothing. `content/migrations/0006` even carries a `labels` map keyed on the *misspelled* slug to render the *correct* title — evidence the divergence was noticed at the title level but not at the slug level.

## 2.7 Existing tests, and why they were green

`frontend/tests/materials-catalog.test.js` — nine tests, including:
```js
test("every requested Catalog branch is configured and founders can browse all of them", () => { … })
test("Catalog subjects start empty until their own Content Panel branch publishes a sheet", () => { … })
```
**Every one of them calls `getCohortMaterials` / `COHORT_CATALOGS` directly.** After `7cecba2` that module is no longer on the Materials rendering path at all (`grep` shows only `Questions.jsx` still imports it). The tests assert that a now-unused module is correct. They stayed green through a total regression of the page they were written to protect.

`frontend/tests/catalog-focus-sync.test.js:294-305` — the test `7cecba2` **added** is a source-text assertion:
```js
assert.doesNotMatch(catalogHook, /getCohortMaterials/);
```
It asserts the fallback is gone. It is a test *for* the regression, not against it.

`backend/.../test_catalog_workspace.py:94` proves the endpoint returns empty subjects, but it **creates its own `CatalogSubject` rows inline** (lines 117-127) — exactly the same blind spot as the Telegram tests: the read path is verified, the provisioning path is never exercised.

### Missing regression tests
- Backend: a test asserting that **every active cohort with enrolled students has at least one active `CatalogSubject`** (a data-integrity check that would fail today for `preparatory`).
- Backend: a test asserting that creating a subject `EducationNode` under a cohort's `content_nodes` makes it appear in `/catalog/materials` (would fail today — nothing projects it).
- Frontend: a render test of `Materials.jsx` asserting a **loading** state, an **error** state with retry, and an empty state that is only reached on a successful empty response.
- Frontend: a test asserting `materialCatalog.js` slugs match the backend seed slugs (would catch `removeable`).
- E2E: a student with a 0-sheet subject sees that subject listed.

## 2.8 Severity

**Critical.** Students in affected cohorts cannot reach any study material. Every student is additionally exposed to a false "no materials" state during each page load and after any transient API failure. This is the primary product surface.

---

# 3. Sheet creation → student visibility

Investigated independently, as instructed. It is **a different bug** from §2.

## 3.1 Trace: Content Studio → student catalog

| Step | Code | Behaviour |
|---|---|---|
| Branch selection | `AdminSubjectListView` (`admin_views.py:171-224`) | lists `CatalogSubject` where `is_active=True, source_node__isnull=False`, **unscoped by cohort** |
| Create sheet | `AdminSubjectSheetListView.post` (`admin_views.py:256-270`) → `create_sheet` | `version.academic_node = <the subject node>` |
| **Publication state** | `AdminSheetCreateSerializer.publish = BooleanField(default=False)` | **defaults to draft** |
| `CatalogDocument` | `create_sheet` (`admin_services.py:234-239`) | `_sync_catalog_document(sheet)` **is only called when `publish=True`** |
| Current version | `_sync_catalog_document` (`admin_services.py:121-155`) | requires `sheet.published_version is not None` |
| `ManagedFile` | same | requires a `PRIMARY` asset, else deactivates the document |
| Student endpoint | `views.py:148-158` | requires `is_active`, exact `version__academic_node_id == subject.source_node_id`, `learning_object.published_version_id == version_id`, `archived_at is null` |
| Admin sheet list | `_sheets()` (`admin_views.py:88-98`) | `current_version__academic_node__path__startswith=subject.path`, **all workflow statuses** |

## 3.2 Root causes, in order of likelihood

**(a) The Content Studio form defaults to Draft.** `frontend/src/pages/AdminContentManagement.jsx:105`
```js
const [status, setStatus] = useState("draft");
…
publish: status === "published",
notify_students: status === "published" && notify,
```
The submit button even reads **"Save as draft"** and the panel is badged `Draft-safe`. A draft sheet is fully visible in the admin list (`_sheets()` does not filter by workflow status) and completely invisible to students. **This is not a regression — it is the designed default — but it is almost certainly what is happening**, and the UI gives no indication that "saved" ≠ "students can see it".

**(b) The subject has no `CatalogSubject` → the sync is a silent no-op.** `admin_services.py:130-134`
```python
catalog_subject = _catalog_subject_for_node(version.academic_node)
if catalog_subject is None:
    # Legacy content outside a Catalog branch is intentionally not exposed
    return          # ← no exception, no log, no audit, no metric
```
Publishing succeeds, the audit says `content.sheet_published`, `_notify_students` fires a "New sheet available" notification to **every active student**, and **no `CatalogDocument` is created**. Students get a notification for a sheet they can never open. Combined with §2.3, this affects any subject created after migration `0006`.

**(c) Exact-node vs subtree mismatch for legacy content.** The student query pins `version__academic_node_id = subject.source_node_id` (exact), while `_sync_catalog_document` resolves the subject by **walking up** (`_subject_for_node`, `admin_services.py:80-91`) and the admin list matches by **path prefix**. A sheet whose `academic_node` is a descendant of the subject (a chapter/topic node — possible for pre-Catalog content, not for sheets created via Content Studio, which pins `academic_node = subject`) gets a `CatalogDocument` with the right `material_slug` but is **excluded by the student query**. Admin sees it; students never will.

**(d) Version drift.** `views.py:153` requires `version__learning_object__published_version_id == version_id`. `update_sheet` and `replace_pdf` only re-publish and re-sync `if was_published` (`admin_services.py:304-306`, `330-332`). Editing a **draft** that was previously published, then publishing via a path that does not re-sync, can leave the `CatalogDocument` pointing at a superseded version → excluded.

**(e) Missing `ManagedFile` / primary asset.** `admin_services.py:137-143` deactivates the document if no `PRIMARY` asset exists. `remove-pdf` in the UI does exactly this and turns the sheet back into a draft.

## 3.3 Ruled out

- **Wrong education branch** — `AdminSubjectSheetListView.post` derives the subject from the URL, and `create_sheet` rejects a non-subject node (`ContentRuleError("Sheets must be created inside a subject.")`). The form even states "The subject is fixed by this page and is never read from the file name."
- **Cache** — `/catalog/materials` has no caching layer; `useAsyncData` refetches on every mount.
- **Transaction timing** — every write path here is `@transaction.atomic`, `create_sheet` included. *(An earlier revision of this report claimed `create_sheet` was undecorated. That was wrong — the decorator is on the line above the `def`, which the grep that produced the claim did not show.)*

## 3.4 Confirmation (read-only)

```bash
docker compose -f compose.production.yaml run --rm backend python manage.py shell -c "
from apps.content.models import LearningObject, CatalogDocument
for s in LearningObject.objects.order_by('-updated_at')[:20]:
    d = CatalogDocument.objects.filter(version__learning_object_id=s.id).first()
    print(s.workflow_status,
          'pub_v=', bool(s.published_version_id),
          'doc=', bool(d), 'doc_active=', getattr(d,'is_active',None),
          'doc_is_current=', (d and d.version_id == s.published_version_id),
          s.current_version.title if s.current_version else '')
"
```

## 3.5 Severity

**High.** Content operators believe published work is live. The `_notify_students` broadcast makes it worse: students are told a sheet exists and then cannot find it.

### Missing regression tests
- Publishing a sheet under a subject that has no `CatalogSubject` must not silently succeed (today it does, and notifies everyone).
- A test that `_sync_catalog_document`'s early return is observable (log/metric/audit).
- A test that the student query and the admin query agree on which sheets belong to a subject.
- `create_sheet` under `@transaction.atomic`, asserted.

---

# 4. Sheet opening / PDF

## 4.1 Worker MIME — the fix is correct, but **incomplete**

**Emitted filename:** confirmed present in the local build — `frontend/dist/assets/pdf.worker.min-BmVo14Nb.mjs`.
**Source:** `frontend/src/workspace/catalog/pdfJsAdapter.js:2`
```js
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
```
**Browser URL:** `/assets/pdf.worker.min-<hash>.mjs` (`pdfjs-dist@6.3.289`).

**VPS / Compose edge — FIXED.** `frontend/nginx/default.conf:123-130` (added by `7cecba2`):
```nginx
location ~ ^/assets/.*\.mjs$ {
    default_type application/javascript;
    access_log off;
    expires max;
    try_files $uri =404;
}
```
This is correct nginx semantics: a regex `location` is evaluated before the `location /assets/` prefix match, and the only `^~` block in the file is `/admin/`, so it wins. `default_type` applies because nginx's bundled `mime.types` has no `.mjs` entry — which is exactly why the original response was `application/octet-stream`. `try_files $uri =404` also correctly prevents the SPA fallback from returning `index.html` as the worker.

`scripts/ci/edge-smoke.sh` (also added by `7cecba2`) asserts all three properties against the real image: HTTP 200, `Content-Type: application/javascript`, and "body is not SPA fallback HTML".

### ⚠️ **The other production shape was not fixed**

`deploy/container-host/nginx.conf.template` — the single-container shape for Render / Fly.io / Railway, per its own header:

> The VPS deployment uses `frontend/nginx/default.conf` instead, which terminates TLS itself.

`grep -n "mjs" deploy/container-host/nginx.conf.template` → **no match.** Its `location /assets/` block (line 62) has no `.mjs` handling, so on that shape the worker is still served as `application/octet-stream` and `Setting up fake worker failed: 'application/octet-stream' is not a valid JavaScript MIME type.` **is still reproducible in production today.**

`scripts/ci/edge-smoke.sh` only exercises the edge *image*, so CI cannot catch this.

**→ Determine which shape serves `lockin.ly` before concluding the fix landed.** One HTTP request settles it:
```bash
curl -sI https://lockin.ly/assets/pdf.worker.min-<hash>.mjs | grep -i '^content-type\|^HTTP'
```
(get `<hash>` from the `/assets/index-*.js` bundle or from the deployed image's `/assets` listing).

### Secondary risk: service-worker cache
`vite.config.js:138-143` precaches only `index.html`, `manifest.webmanifest`, `assets/index-*.js|css` — the worker is **not** precached, so a stale octet-stream response is not baked into the install manifest. But `registerType: "prompt"` means an existing client keeps its old service worker until the user accepts an update. If any runtime caching rule stored the worker response under the broken deployment, that client keeps the broken `Content-Type` until the cache is evicted. Worth checking `src/service-worker.js` runtime routes before declaring users fixed.

## 4.2 The "not found" flash — **only partially fixed**

`7cecba2` added the gate to **one** of four consumers:

`frontend/src/pages/CatalogFocusWorkspace.jsx:545-546` ✅
```jsx
if (materialsLoading) return <Page …><LoadingPanel /></Page>;
if (materialsError)   return <Page …><ErrorPanel message={materialsError} onRetry={reloadMaterials} /></Page>;
if (!material || !sheet) { … }
```

Still unguarded, all in `frontend/src/pages/Materials.jsx`:

| Component | Line | During loading it renders |
|---|---|---|
| `Materials` | 11-34 | `EmptyState "no cohort materials"` |
| `CatalogMaterialSheets` | 43-63 | `ErrorPanel t("materials.notFoundText")` |
| `CatalogSheetStudy` | 65-79 | `ErrorPanel t("materials.sheetNotFoundText")` |

### Why it takes seconds, and why it recurs on every hop

`useCatalogMaterials` calls `useAsyncData` **per component instance**. There is no shared cache, no context, no SWR-style dedupe. Navigating

```
/materials  →  /materials/catalog/:slug  →  …/sheets/:slug  →  …/workspace
```

issues **four independent full `/catalog/materials` requests**, each restarting at `{loading: true, data: null}`. `/catalog/materials` is an N+1: `views.py:147-158` runs one `CatalogDocument` query **per subject**, unpaginated, with no `select_related` on the loop's outer sheets. For a founder (who bypasses cohort scoping and receives **every** subject in the system) this is the whole catalogue on every hop.

So the "not found" is:
- **not** a genuine 404 — the route and IDs are correct;
- **not** `ManagedFile` availability — the document resolver is a separate call;
- **not** stale frontend state — the state is *absent*, not stale;
- it is **an unguarded loading window on a request that is re-issued on every navigation and is slower than it should be.**

One genuine-403 case does exist and will look identical to the user: `_catalog_document` (`views.py:90-107`) begins with `require_entitlement(user=user, entitlement_code="focus.workspace")`. A student whose subscription is not entitled gets `PermissionDenied`, not `NotFound` — worth separating in the UI. **This is the coupling to §1**: while Telegram approvals are broken, subscriptions do not reach a verified/entitled state, so sheet-opening failures and payment failures have a shared upstream.

## 4.3 Severity

Worker MIME: **High** if the container-host shape is live (nothing opens at all); resolved if the VPS shape is live.
"Not found" flash: **Medium** — recoverable, but it is the behaviour that makes the product feel broken and it reads as data loss to a student.

### Missing regression tests
- An `edge-smoke`-equivalent (or a config lint) covering `deploy/container-host/nginx.conf.template`, so both documented shapes are held to the same contract.
- A test asserting the two nginx configurations agree on every asset-delivery rule.
- Render tests for `CatalogMaterialSheets` / `CatalogSheetStudy` asserting a loading state rather than "not found".
- A test asserting `/catalog/materials` is fetched at most once per navigation sequence (shared cache / single owner).

---

# 5. Regression analysis — causal chain

## 5.1 Telegram

```
e2e76fd (2026-09-11)
  + TelegramPaymentOperator model + migration
  + resolve_operator() requiring an active row
  + webhook, callback signing, capability check
  - NO admin registration, NO management command, NO API, NO seed
  → the feature is unusable from the moment it ships; docs say "use the Django shell"

7cecba2 (2026-09-12)
  - return 403 on TelegramAuthorizationError
  + answerCallbackQuery("This action is not available.") + return 200
  → Telegram stops retrying, pending_update_count goes to 0,
    last_error_message goes to null, and the webhook LOOKS healthy.
  → This did not cause the failure. It hid it and produced the toast you are seeing.
```

**Exact statement:** *Before `7cecba2`, an unauthorized callback returned 403; Telegram retried it and surfaced it in `getWebhookInfo`. `7cecba2` changed it to a 200 with a generic acknowledgement. Now the same unauthorized callback is invisible to Telegram's diagnostics. The authorization failure itself dates from `e2e76fd`, which shipped a required `TelegramPaymentOperator` row with no way to create one.*

## 5.2 Catalog

```
e2e76fd (2026-09-11)
  + CatalogSubject + one-time seeding migration (content/0006)
  + /catalog/materials built from CatalogSubject
  + frontend hook prefers server list, FALLS BACK to the local hard-coded catalogue
  → cohorts without content_nodes get 0 rows, but students DO NOT NOTICE:
    the fallback still fills the page during load and on every failure.

96971f8 (2026-09-11)  merge e2e fixtures into the server list; fallback still present
7cecba2 (2026-09-12)
  - const fallback = getCohortMaterials(user)
  + materials = Array.isArray(results) ? results : []
  + loading/error gate added to CatalogFocusWorkspace ONLY
  → Materials.jsx now renders "no materials" during load, on error,
    and permanently for every cohort with 0 CatalogSubject rows.
d5ae39d (2026-09-12)  suppresses the error only in the E2E build
```

**Exact statement, in your requested form:** *Before `7cecba2`, `useCatalogMaterials` returned `getCohortMaterials(user)` — subjects derived from the local cohort catalogue — whenever the server list was not yet an array, i.e. during every load and on every failure. `7cecba2` changed that expression to `[]`. Subject visibility therefore stopped depending on the education hierarchy and started depending entirely on a successful, non-empty `/catalog/materials` response. Because `CatalogSubject` rows are only ever created by migration `content/0006` and exist only for cohorts that had `content_nodes` at that moment, every other cohort's response is empty — and empty subjects disappeared.*

## 5.3 `git bisect` recommendation

A bisect is unnecessary and would mislead: the catalog fault is **data-conditional**, so a bisect on a freshly-migrated database (where `0006` and `0007` run in the correct order and seed everything) will not reproduce it. Reproduce it instead by restoring a production database snapshot and checking out `7cecba2^` vs `7cecba2`. The Telegram fault will not bisect either — it is absent-row-conditional and every test provisions the row.

---

# 6. Dependency map

```
                    ┌──────────────────────────────────────────────┐
                    │  ROOT SHAPE (shared, not a shared bug)       │
                    │  "server-authoritative model shipped with    │
                    │   no provisioning path for its own rows"     │
                    └───────────────┬──────────────────┬───────────┘
                                    │                  │
              ┌─────────────────────▼──┐        ┌──────▼───────────────────┐
              │ #1 TelegramPayment     │        │ #2 CatalogSubject seeded │
              │    Operator: no        │        │    once by a migration;  │
              │    creation path       │        │    never created again   │
              │    (e2e76fd)           │        │    (e2e76fd)             │
              └───────────┬────────────┘        └──────────┬───────────────┘
                          │                                │
              ┌───────────▼────────────┐        ┌──────────▼───────────────┐
              │ #1b 403 → silent 200   │        │ #2b fallback deleted +   │
              │     MASKS #1           │        │     no loading/error gate│
              │     (7cecba2)          │        │     in Materials.jsx     │
              └───────────┬────────────┘        │     (7cecba2)            │
                          │                     └──────────┬───────────────┘
                          │                                │
                          │                     ┌──────────▼───────────────┐
                          │                     │ #3 new sheets invisible  │
                          │                     │  (a) Draft default  ◄────┼── INDEPENDENT
                          │                     │  (b) silent sync no-op ──┼── DEPENDS on #2
                          │                     └──────────────────────────┘
                          │
              ┌───────────▼───────────────────────────────────────────────┐
              │ payments not approvable → subscriptions not verified       │
              │ → require_entitlement("focus.workspace") denies            │
              │ → sheets do not open (403, indistinguishable from 404)     │
              └───────────────────────────────────────────────────────────┘

   INDEPENDENT of everything above:
   ┌──────────────────────────────────┐  ┌────────────────────────────────┐
   │ #4a PDF worker .mjs MIME         │  │ #5 removeable vs removable     │
   │  fixed for the Compose edge      │  │    slug divergence             │
   │  NOT fixed for container-host    │  │    (e2e76fd seed vs frontend)  │
   └──────────────────────────────────┘  └────────────────────────────────┘

   PARTIALLY independent:
   ┌──────────────────────────────────────────────────────────────────────┐
   │ #4b "not found" flash — caused by #2b's missing gate on 3 of 4       │
   │ consumers, amplified by 4× uncached /catalog/materials fetches       │
   │ and by that endpoint's per-subject N+1                               │
   └──────────────────────────────────────────────────────────────────────┘
```

**Are these independent bugs or related regressions?**

- **#1 and #2 are independent bugs** that share a *design pattern* failure, not a code path. Fixing one does nothing for the other.
- **#1b and #2b are the same commit (`7cecba2`)** and are both "a hardening change removed a compensating behaviour". That commit is the single highest-value thing to re-examine.
- **#3(a) is independent** of everything — it is a UI default, not a regression. **#3(b) is a consequence of #2.**
- **#4a is fully independent** — a configuration gap in one of two deployment shapes.
- **#4b is a consequence of #2b**, plus a pre-existing architectural issue (no shared catalog cache).
- **#5 is independent**, dating from `e2e76fd`'s seed migration.
- **There is one runtime coupling**: #1 blocks subscription verification, and `require_entitlement("focus.workspace")` gates the document resolver — so while payments cannot be approved, sheet-opening failures have two possible causes and will be hard to attribute.

---

# 7. What I did not do

Per instruction: no fixes, no patches, no migrations, no deployment, no configuration change, no production data access, and no solution design for the website approve/reject/terminate work. The working tree contains only the two pre-existing uncommitted test-infrastructure edits (`frontend/e2e/pdf-range-requests.spec.js`, `frontend/scripts/serve-dist.mjs`) that were present when this investigation began; they are test-only and are **not** part of release `7f438f0`.

## Highest-value next confirmations, all read-only

1. `TelegramPaymentOperator.objects.count()` on production — settles §1 in one query.
2. `grep "Rejected an unauthorized Telegram payment action"` in backend logs — the exact reason is already recorded.
3. The per-cohort `catalog_subjects` vs `students` query in §2.3 — lists every affected cohort by name.
4. `curl -sI https://lockin.ly/assets/pdf.worker.min-<hash>.mjs` — settles §4.1 in one request.
5. `manage.py audit_cohort_content_mappings` — already shipped, read-only.
