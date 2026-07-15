# Phase 3 Authentication and Design Record

Last updated: 2026-07-15
Status: Implementation complete; awaiting owner approval

## Outcome

Phase 3 delivers the production-oriented account, role, localization, responsive shell, and design
foundation. It does not start education/content work or Focus workspace implementation.

## Backend delivered

- CSRF-enforced same-origin Django sessions, including anonymous unsafe auth requests.
- Registration with normalized unique email, password validation/confirmation, language, versioned
  policy acceptance, and rejection of unknown/client-role fields.
- Hashed, expiring, single-use email verification, password reset, and email-change tokens; raw
  tokens are sent but never stored.
- Generic account-recovery responses, verified-account login gate, suspended/deleted account gate,
  session rotation, remembered-session expiry, logout, logout-all, and individual revocation.
- Password changes keep the current session and invalidate other sessions; resets invalidate all.
- Database-backed throttling for login failures and all sensitive account request scopes.
- Student baseline role plus additive moderator, creator, and administrator groups; backend-only
  permission checks and final-active-administrator protection.
- Append-oriented security records for authoritative account actions.
- Truthful account/role dashboard selectors with real administrator totals only.
- `accounts.user_registered`, `accounts.user_email_verified`, and
  `accounts.user_roles_changed` typed after-commit internal events.

## Frontend delivered

- English/Arabic catalogs, validated locale persistence, document language/direction, and logical
  RTL layout.
- Registration, verification, login, logout, reset, profile, password, email, session, and role UI.
- Desktop rail, tablet drawer, and mobile structural navigation.
- Student and additive role-aware dashboard that never invents content/progress metrics.
- Three-layer OKLCH design tokens, reusable accessible primitives, honest loading/empty/error states,
  custom Lock-in monogram, mascot study scene, and raster PWA icons.
- Static-only PWA update behavior retained; sessions/tokens are never stored in Web Storage.

## Architecture boundaries preserved

- Focus source contracts and backend domain were not coupled to account pages or PDF work.
- The event bus remains synchronous, in-process, after-commit, and best-effort; no queue or broker.
- AI remains unimplemented and provider-free.
- No Redis, Celery, WebSockets, Kafka, RabbitMQ, microservice, or cross-origin auth flow.

## Validation evidence

| Gate | Result |
|---|---|
| Backend Ruff and strict mypy | Passed |
| Django system/migration drift | Passed |
| Backend pytest | 36 passed; 88.93% coverage |
| Frontend ESLint and TypeScript | Passed |
| Frontend Vitest coverage | 30 passed; 91.75% statements, 83.39% branches |
| Production PWA build | Passed; 12-entry static precache; JS 85.22 KB gzip; CSS 4.81 KB gzip |
| Playwright | 5 passed, 1 intentional device-specific skip; desktop and Pixel 7 |
| Accessibility | Axe found no violations in authenticated and mobile RTL scenarios |
| Dependency health | npm production audit: 0 known vulnerabilities; Python: no broken requirements |
| Visual QA | Desktop login/dashboard and mobile EN/AR registration screenshots inspected |
| Overflow | No horizontal overflow in tested desktop or mobile states |

Local backend tests used the explicit SQLite fast-test switch because Docker/PostgreSQL remain
unavailable on this workstation. PostgreSQL CI is configured but not represented as executed.

## Inputs still required before production

- Approved terms/privacy text and current policy version.
- Transactional email provider, sender domain, and email templates.
- Production hosting/domain and proxy/TLS deployment settings.
- PostgreSQL CI or equivalent real-database evidence.
- Institutional administrator bootstrap and role operating procedure.
- Measured load evidence remains Phase 11; no 2,000-concurrent-user claim is made.

## Stop condition

Phase 3 is complete. Do not begin Phase 4 education hierarchy/content work until the owner gives
explicit approval.
