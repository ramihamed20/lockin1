# Device notifications

Web Push is optional and defaults off. It connects existing account-owned notifications (including scheduled admin announcements) to opted-in browser installations. It does not automatically create notifications for every PDF upload, and the existing daily reminder still runs only while the app is open.

## Operator setup

1. Generate one VAPID key pair in a trusted backend environment:

   `python manage.py generate_web_push_keys --private-file /secure/path/web-push-private.key`

   The command refuses to overwrite a key, creates an owner-only private file, and prints only the public key. Keep this pair across releases. Never commit the private file.
2. Set `WEB_PUSH_VAPID_PUBLIC_KEY` to the printed value and `WEB_PUSH_VAPID_PRIVATE_KEY` to the private file's base64url DER contents through the deployment's secret environment. The Django setting also accepts `WEB_PUSH_VAPID_PRIVATE_KEY_FILE` when an operator mounts the private file inside the backend and scheduler containers and completely removes the direct environment variable (an empty value still counts as set). The ordinary Compose environment supports the direct value without requiring a new secret mount for disabled deployments.
3. Set `WEB_PUSH_CONTACT=https://lockin.ly` (or a valid operator contact URL), then `WEB_PUSH_ENABLED=true` in both backend and operations scheduler environments.
4. Deploy the reviewed images using the ordinary deployment process, apply migrations, and keep `operations-scheduler` running. Its `dispatch_web_push` job drains the queue. No Redis, Celery or new service is required. Manual diagnosis: `python manage.py dispatch_web_push --limit 10` (this sends pending notifications; do not run it merely to inspect configuration).
5. A user opens **Settings → Notifications → Device notifications**, presses Enable and accepts the browser permission. On iPhone/iPad, first add the site to the Home Screen and open that installed app. Request a test and allow a scheduler cycle; provider acceptance and device/Focus settings determine display.

The private key is never returned by the API. Mismatched keys leave the feature unavailable. Key rotation requires users to enable notifications again; the client replaces subscriptions whose application-server key changed.

## Delivery and privacy

- Enabling requires an existing authenticated, unexpired account session, session CSRF, and matching `user_id`. The browser permission is requested only from a button click.
- Subscriptions belong to an AccountSession and are deleted with revoked/logged-out sessions. A separate non-secret IndexedDB binding prevents an already queued message or notification click from opening another account after logout/account switch. Clearing a binding also closes its visible notices.
- Existing per-category push preferences are respected at enqueue and dispatch. Disabling this installation clears its local marker even offline, deletes the owned subscription and unsubscribes the browser.
- Push endpoints must be HTTPS browser-provider hosts (Google, Mozilla, Apple or Windows), with valid P-256/auth keys. Redirects are disabled. Endpoints, auth values and private keys are not exposed through API responses, `__str__`, delivery errors or command output.
- Notification creation only inserts durable jobs. Network sends run outside web requests and outside database locks, with a five-second HTTP timeout, a bounded dispatch budget, retries/backoff, expired-subscription handling and claim leases. A crash after provider acceptance can resend; the service worker's notification tag deduplicates display by notification ID.
- Status `accepted` means the push service accepted the encrypted message, not proof the student saw it. The test UI says requested/queued. TTL is one day and session expiry is checked before display.
- Clicking a notice opens the authenticated notification inbox. Its existing server endpoint resolves protected targets; payloads cannot navigate to arbitrary URLs. Private APIs remain excluded from service-worker caching.

## Validation limits

Tests exercise subscription/session/CSRF boundaries, encryption/signing with the HTTP transport mocked, retry and expiry behavior, account binding, opt-in UI and the production service worker through browser-delivered push events with the headless browser’s OS notification/permission surfaces stubbed. They do not contact a real student's provider or certify physical iPhone delivery. Real provider credentials, deployment, device permission/Focus settings and a Home Screen iPhone smoke test are required before calling production delivery verified.
