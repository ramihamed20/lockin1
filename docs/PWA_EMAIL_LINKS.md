# Email links and the installed PWA

What a verification link can and cannot do, stated plainly, so nobody has to
rediscover it from a bug report.

## The flow

1. Registration issues a single-use `OneTimeToken`
   (`apps.accounts.services.issue_token`) and mails a link built by
   `build_account_link`: `https://<app>/#/verify-email?token=<raw>`.
   The route and its query live in the URL **fragment** because the client is a
   `HashRouter` app served by a static host — a path-style link would be
   answered by `index.html`, the router would never see the token, and the
   recipient would land back on sign-in as though nothing was confirmed.
2. Whatever browser the mail client opens loads the app shell, and
   `TokenActionPage` captures the token from the fragment and immediately
   replaces the visible URL with the clean route.
3. Confirming POSTs the token to `/api/v1/auth/verify-email`. The server checks
   it (single-use, unexpired, server-side, CSRF-protected, rate-limited) and, if
   the account may sign in, establishes the ordinary session in that same
   response.
4. The client refreshes the account and navigates to the authenticated
   destination.

## What actually opens

A verification link is a plain HTTPS URL. **Which app opens it is decided by
the client that owns the tap, not by anything this repository can set.**

| Context | Behaviour | Why |
| --- | --- | --- |
| Desktop Chromium, PWA installed | May open the installed app | Link capturing exists; `launch_handler: navigate-existing` reuses the open window |
| Android Chrome, PWA installed, link tapped **in Chrome** | May open the installed app | Same |
| Android **Gmail app** | Opens Gmail's Custom Tab, *not* the PWA | Gmail hands the URL to its own in-app browser before any capture can apply |
| iOS Safari, web app on the Home Screen | **Never** opens the installed app | iOS home-screen web apps have no link capturing at any scope |
| iOS **Gmail app** | Opens Gmail's in-app browser | Same as Android Gmail, and iOS has no fallback capture either |
| Any browser, PWA not installed | Opens normally | The ordinary path, unchanged |

### The iOS limitation, without hedging

There is **no standards-compliant way** to make an HTTPS link open an installed
web app on iOS. The mechanism that would do it — Universal Links — requires a
native app bundle, an Apple App ID, and an `apple-app-site-association` file
tied to it. Lock-in has no native app, so this is not available, and no manifest
key, meta tag, redirect, or custom scheme changes it. Anything claiming
otherwise would be pretending.

`launch_handler` was added because it is real and standards-compliant where link
capturing exists. It is not a fix for Gmail or for iOS, and it is not documented
as one.

## What we did about it instead

Since we cannot control *where* the link opens, we made it not matter as much:
verification now signs the reader in **in whatever browser opened the link**, so
they land in the product instead of being bounced to a login form for an account
they just proved is theirs.

The honest residual cost: a session is a cookie, and a cookie set in Gmail's
in-app browser is not visible to the installed PWA. An iOS reader who verifies
from Gmail is signed in *there*, and still signs in once in the PWA — with the
password they already chose at registration. They are never asked to register
again, which was the reported complaint.

Carrying the session across those two browser contexts would mean putting a
credential in a URL. We will not do that.

## Follow-up worth considering

- A native shell (or Apple App Site Association via a thin native app) would
  enable Universal Links on iOS. That is a platform decision, not a web change.
- "Open in Lock-in" guidance on the verification success screen for readers who
  verified inside an in-app browser.
