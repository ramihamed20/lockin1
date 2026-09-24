---
name: lockin-auth-security-guardian
description: Safely implement or review Lock-in login, registration, email verification, OAuth, sessions, CSRF, account recovery, role permissions, throttling, and security-sensitive account changes.
---

# Lock-in Auth & Security Guardian

Authentication is a security boundary, not only a UI flow.

## Preserve

- server-managed session authentication
- HttpOnly/secure production cookie behavior
- CSRF on unsafe cookie-authenticated requests
- no session identifiers in local/session storage
- single-use/time-bounded sensitive tokens
- server-authoritative roles/permissions
- throttling/abuse controls
- safe redirects and callback validation

## Flow tracing

For auth bugs trace:
browser input
→ frontend API request
→ CSRF/session behavior
→ Django authentication/permission
→ service/state mutation
→ cookie/session rotation
→ frontend session bootstrap

Do not fix only the visible frontend symptom.

## OAuth

For provider changes:
- validate redirect URI
- state/nonce/callback integrity as implemented
- account linking rules
- email/identity assumptions
- duplicate/replay behavior
- production HTTPS constraints

## Verification/recovery

Protect:
- token/code expiry
- single use
- rate limits
- identifier enumeration
- replay
- account state transitions

## Permissions

For any privileged endpoint:
- test unauthenticated
- authenticated unauthorized
- authorized
- object-scope denial where relevant

Do not infer permission from UI route visibility.

## Logging

Never log:
- passwords
- raw tokens/codes
- session IDs
- OAuth secrets
- private keys

## Validation

Prefer direct backend auth/API tests plus the narrow frontend auth-flow test.
Use E2E when cookie/session/browser behavior is the thing being changed.

## Output

AUTH/SECURITY RESULT
FLOW: <flow>
BOUNDARY: <what enforces authority>
CSRF/SESSION: <impact>
ENUMERATION/REPLAY: <impact>
PERMISSIONS: <evidence>
TESTS: <evidence>
RISK: <remaining>
