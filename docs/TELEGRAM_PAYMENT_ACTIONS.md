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
   `TELEGRAM_PAYMENT_CHAT_ID`. Anywhere else is 403.
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
console review, with `source="payments.telegram"` distinguishing the channel.

Create a link from the Django shell (there is deliberately no self-service API):

```python
from apps.accounts.models import User
from apps.payments.models import TelegramPaymentOperator

TelegramPaymentOperator.objects.create(
    user=User.objects.get(email="admin@example.com"),
    telegram_user_id="123456789",   # numeric Telegram user id
    label="Night shift",            # shown in the chat instead of an email
)
```

To revoke: set `is_active=False`, or remove `payments.manage` from the account.

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
- Unauthorized updates are logged with the reason and answered 403 with no
  detail.

Recharge codes are never written to logs. They appear only in the notification
body itself, which is the existing behaviour the reviewer depends on to validate
a card.
