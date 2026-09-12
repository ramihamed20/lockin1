# Approving manual payments from Telegram

A pending Libyana payment notification carries two buttons. Pressing one runs
the same review the operations console runs — `review_manual_recharge` — with
the same transaction, idempotency, invoicing, notification and audit behaviour.
There is no second approval path, only a second way to reach the one that
exists.

Both paths stay available. Nothing about the console changes.

---

## What the reader sees

- **Pending** (`new_subscription`, `early_renewal`) — message plus
  `☑ Approve` / `❌ Reject`.
- **After a Telegram decision** — the original message is rewritten in place with
  `✅ Approved — <reviewer>` or `❌ Rejected — <reviewer>`, and the buttons are
  gone.
- **After a console decision** — the original message keeps its buttons, and a
  separate `approved` / `rejected` notification arrives, exactly as before.

### The one UX decision, and why

A Telegram-initiated review **does not** also send a separate approved/rejected
message. It would be a second message about a decision already shown, in the
same chat, seconds apart. `review_manual_recharge(..., send_notification=False)`
suppresses only that outgoing message — never the in-app notification, the
invoice, the audit record, or any state change.

---

## Authorization

Four independent checks. An update must pass all of them, and the first three
happen before the payment is looked up at all.

1. **Secret header.** Telegram echoes `X-Telegram-Bot-Api-Secret-Token` on every
   delivery. It is compared with `hmac.compare_digest` against
   `TELEGRAM_WEBHOOK_SECRET_TOKEN`. An unset secret returns 404 — the endpoint is
   closed, not open.
2. **Chat.** The update must originate in `TELEGRAM_ADMIN_CHAT_ID` or
   `TELEGRAM_PAYMENT_CHAT_ID`. Anywhere else is refused, acknowledged with a
   generic message, and answered 200 — see *Failure behaviour*.
3. **Operator.** `callback_query.from.id` must match an **active**
   `TelegramPaymentOperator` row, and the linked Lock-in account must be active
   and hold the `payments.manage` capability. Capability is read at click time,
   never cached on the link, so revoking it in the operations console revokes
   the button in the same instant.
4. **Signature.** `callback_data` carries a truncated HMAC over the action and
   payment id, keyed from the bot token, webhook secret and `SECRET_KEY`. A
   button from another environment, or one whose action was edited from
   `approve` to `reject`, fails here.

`callback_data` is **not** trusted on its own — it only names which payment and
action, after the caller has already proven it may act.

### The audited actor

No fake or system user is invented. `TelegramPaymentOperator` links a Telegram
account to a **real Lock-in administrator**, mirroring `accounts.SocialIdentity`.
That administrator is the actor on the audit record, the subscription
transition, the payment transition and the in-app notification — identical to a
console review. `review_manual_recharge` takes the channel as its `source`
argument, so the `AuditRecord` reads `payments.telegram` for a button and
`admin_control.api` for the console. That is the only field that differs.

### Linking an operator

**Until a link exists, every Approve/Reject button is refused.** There is
deliberately no self-service API — the link grants the power to approve money
outside the session-authenticated console, so creating one requires host access.

```bash
# Show every configured link, and whether its account still holds payments.manage.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_operator --list
```

```bash
# Link a Telegram account to a real administrator. The numeric Telegram user id
# is required; an @username is refused. So is an account without payments.manage,
# rather than creating a link that could never work.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_operator --link 123456789 \
  --user admin@example.com --label "Night shift"
```

```bash
# Revoke. The row is kept: it is the audited actor on every past review.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_operator --revoke 123456789
```

Removing `payments.manage` in the operations console revokes the button in the
same instant, whatever this command has recorded.

`production_preflight` warns when the webhook secret is configured and no
operator is linked, and reports the count in its evidence as
`telegram_payment_operators`.

---

## What is never in `callback_data`

Telegram caps it at 64 bytes and echoes it back to anyone who can read the bot's
traffic. It contains an identifier and a signature, nothing else:

```
p1:a:<32 hex payment id>:<10 hex signature>     48 bytes
```

No recharge code, username, email, account id, token or amount. A regression
test asserts the keyboard for a payment contains neither its card number nor the
payer's address.

---

## Idempotency

The key is derived, not generated: `telegram-review:<payment id>:<action>`. Every
delivery of the same button press — a Telegram retry, a double tap, two
operators pressing within the same second — produces the same key, and
`review_manual_recharge` records the transition once via the unique
`(payment, idempotency_key)` constraint on `PaymentTransition`.

The second press is answered `Already approved. No change was made.` A press
that contradicts a completed review (`reject` after `approve`) is answered
`This payment has already been reviewed.` Neither changes state.

---

## Registering the webhook

**Endpoint:** `POST https://<your-host>/api/v1/billing/webhooks/telegram`

The domain is never hard-coded. Run these on the host, with the production
environment loaded. Nothing prints a secret.

```bash
# 1. Generate a secret and place it in the deployment environment, not in a file.
openssl rand -hex 32
```

```bash
# 2. Set TELEGRAM_WEBHOOK_SECRET_TOKEN in the environment, then restart so the
#    backend picks it up.
docker compose -f compose.production.yaml up -d backend
```

```bash
# 3. Register. Pass the public origin only; the path is appended.
docker compose -f compose.production.yaml run --rm backend python manage.py telegram_webhook --url https://YOUR-PUBLIC-HOST
```

```bash
# 4. Confirm. Prints url, pending count and last error; never the secret.
docker compose -f compose.production.yaml run --rm backend python manage.py telegram_webhook --show
```

```bash
# To remove the webhook and stop callback delivery.
docker compose -f compose.production.yaml run --rm backend python manage.py telegram_webhook --delete
```

The command refuses a non-HTTPS URL, a URL carrying a query, fragment or
credentials, and refuses to register at all when
`TELEGRAM_WEBHOOK_SECRET_TOKEN` is unset — registering without it would leave a
payment-approving endpoint open to anyone who guessed the path. Only
`callback_query` updates are subscribed.

### Rotating `TELEGRAM_BOT_TOKEN`

A Telegram webhook is configured **on the bot identified by its token**. After
rotating that token, restart the backend with the new secret value and run the
same registration command once against the public HTTPS origin. This is an
explicit release operation; application startup deliberately does not call
Telegram or mutate webhook state.

```bash
# Run only after the release is healthy and its environment contains the new token.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_webhook --url https://YOUR-PUBLIC-HOST
docker compose -f compose.production.yaml run --rm backend \
  python manage.py telegram_webhook --show
```

Do not use `--drop-pending` during a routine token rotation: it discards queued
callbacks. Confirm the reported URL is the endpoint above, `allowed_updates`
contains `callback_query`, and no `last_error_message` is reported.

> **Rotating a credential invalidates every button already in the chat.** The
> `callback_data` signature is keyed from the bot token, the webhook secret and
> `DJANGO_SECRET_KEY` (see `_callback_signing_key`). After rotating any of the
> three, buttons on notifications sent before the rotation fail the signature
> check and are answered `This action is not available.` Pending payments have to
> be reviewed from the operations console, or re-notified. This is visible in the
> `telegram.webhook.rejected` metric as `code="callback_signature"`.

---

## Failure behaviour

Telegram cannot corrupt payment state.

- The database is authoritative. Every Telegram call is best-effort and returns
  a boolean; none of them can raise into a payment transaction or roll one back.
- If the transport fails after a committed approval, the payment stays approved
  and the chat is simply not updated.
- If the handler raises after committing, the endpoint answers **200** rather
  than an error, so Telegram stops redelivering an action that already happened.
  The failure is logged and reported to the error reporter.
- Updates that passed the secret header but fail chat/operator/signature checks
  are logged, leave payment state unchanged, and receive a generic callback
  acknowledgement. That clears Telegram's button spinner without revealing the
  rejected reason or triggering redelivery. A missing or incorrect secret still
  receives 404 and is never acknowledged.

Recharge codes are never written to logs. They appear only in the notification
body itself, which is the existing behaviour the reviewer depends on to validate
a card.

### Diagnosing a refused button

All four refusals look identical to the presser, by design. They are not
identical in the deployment's own telemetry:

```bash
docker compose -f compose.production.yaml logs backend \
  | grep "Rejected an unauthorized Telegram payment action"
```

The log line and the `telegram.webhook.rejected` metric both carry a `code`:

| `code` | Meaning |
|---|---|
| `no_operator_link` | No active `TelegramPaymentOperator` for this Telegram account — run `telegram_operator --link`. |
| `inactive_account` | The linked Lock-in account is suspended or inactive. |
| `missing_capability` | The linked account no longer holds `payments.manage`. |
| `unauthorized_chat` | The update did not come from a configured chat. |
| `callback_signature` | A button signed before a credential rotation, or a tampered payload. |
| `no_sender` | A malformed update with no Telegram sender. |

A wrong or missing secret header never reaches this path: it is answered 404 and
shows up in Telegram's own `last_error_message`.
