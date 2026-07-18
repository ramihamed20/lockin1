# Lock-in Project Audit

Status: Phase 0 baseline approved; rebuild remediation recorded through Phase 10
Audit date: 2026-07-15  
Last updated: 2026-07-19
Existing reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`  
Rebuild destination: `C:\Users\ramih\Desktop\Dentify-Rebuild`

## Purpose

This document captures the evidence that drives the Lock-in rebuild. The existing application is a functional and visual reference only. Its source code, working tree, and data files must never be modified by rebuild work.

## Relevant Skills

| Skill | Use in the rebuild |
|---|---|
| `impeccable` | Product UX, responsive behavior, accessibility, design-system quality, performance, RTL, and UI audits. |
| `design-system` | Phase 3 primitive/semantic/component token architecture and component state contracts; announced before use. |
| `security-best-practices` | Secure-by-default React and Django requirements, permission design, session security, uploads, PWA caching, and production review. |
| `playwright` | Repeatable browser checks and end-to-end coverage once runnable UI exists. |

No dedicated installed Skill was found for Django architecture, Django REST Framework, PostgreSQL, PWA architecture, unit testing, integration testing, or load testing. Those areas must use official documentation, automated tests, measured evidence, and documented engineering decisions. Any newly discovered Skill must be announced before use.

## Current Technology Inventory

| Area | Existing implementation |
|---|---|
| Frontend | React 18, JavaScript/JSX, React Router 6, Vite 6 |
| Styling | Approximately 9,951 lines of custom CSS with themes, tokens, and extensive overrides |
| PWA | `vite-plugin-pwa`, manifest, service worker, broad precaching |
| Backend | Express 4 REST-like API |
| Database | SQLite through `node:sqlite` |
| Alternate data path | Direct Supabase bridge and separate schema |
| Authentication | Express JWT/bcrypt implementation plus a separate browser mock login |
| Deployment | GitHub Pages frontend workflow only |
| Testing | Stateful API smoke script; no unit, integration, E2E, permission, or load-test framework |

## Current Pages

- Dashboard
- Materials and subject listing
- Material sheet listing
- Normal and advanced sheet study
- Question bank
- Review
- Community
- Rankings
- Analytics
- Bookmarks
- Progress
- Achievements
- Profile
- Settings

No administrator, moderator, or content-creator dashboards exist.

## Current Data Model

The SQLite application contains tables for users, theme settings, materials, sheets, questions, attempts, study plans, bookmarks, review items, announcements, community posts and likes, leaderboard entries, achievements, advanced study progress, quiz results, mistakes, and weak points.

It does not contain a production-ready model for roles, granular permissions, university hierarchy, managed files, audio/video, durable quiz attempt state, autosave events, idempotency, comments/replies, reports, audit logs, notifications, or subscriptions.

The Supabase schema differs from the SQLite schema, creating a third incompatible data model alongside the browser mock.

## Primary Architectural Finding

The current React API bridge has mock mode enabled. Normal browser use calls a localStorage-backed mock rather than the Express API. A second optional branch talks directly to Supabase, while the Express/SQLite backend exists separately and is not the active application data path.

This split causes response-contract drift, false success states, duplicate domain models, and uncertainty about which implementation is authoritative. The rebuild must have one versioned API and one authoritative PostgreSQL data model.

## Runtime Findings

Phase 0 browser inspection found:

- Community crashes while reading an undefined collection length.
- Rankings crash while reading an undefined rank.
- Analytics crashes while reading an undefined accuracy value.
- Review displays `Mock endpoint not found`.
- The correct answer “Dentin” is marked wrong because the response contract uses different correctness field names.
- Arabic login content renders, but the document language remains English and the overall document direction remains LTR.
- The dashboard avoids horizontal overflow at a 390 px viewport.
- The PDF workspace creates 30 canvas elements in the representative session.
- The mobile PDF tool panel obscures most of the document while open.

## Security Risks to Eliminate

1. Mock authentication accepts non-production credentials and is the active browser path.
2. The old implementation stores a bearer token in localStorage.
3. The Express server permits an insecure default JWT secret and permissive CORS fallback.
4. There is no centralized role and object-permission policy.
5. The PWA can cache authenticated API responses for up to one week.
6. Quiz submission is not demonstrably transactional and idempotent.
7. File-upload and file-access security are absent.
8. Rate limiting is in-memory and limited mainly to authentication routes.
9. Password reset and email verification are not real account flows.
10. Some update/read sequences are not consistently scoped to the authenticated owner.

## Performance and Maintainability Risks

- Production build precaches about 17 MB across 50 entries.
- Main JavaScript is approximately 461.67 KB before gzip; CSS is approximately 179.91 KB.
- The primary stylesheet contains 199 `!important` declarations.
- The PDF study page is a multi-thousand-line component responsible for unrelated concerns.
- SQLite is not the required production database and is not a credible base for the concurrency target.
- Synchronous password hashing can block the existing Node event loop.
- Community and other collections lack a complete pagination contract.
- Several analytics and ranking values are synthetic rather than derived from authoritative events.

## Concepts Worth Preserving

- The Lock-in identity, dark atmosphere, gold/purple accents, and mascot.
- Student-first study dashboard with continuation, daily goals, review prompts, and focus tools.
- Subject-to-sheet study navigation.
- PDF annotation as a product capability, redesigned for accessibility and mobile usability.
- Immediate question feedback, spaced review, achievements, and advanced study concepts.
- Theme personalization where it does not harm consistency or accessibility.

## Rebuild Direction

The rebuild will be a modular monolith with React, TypeScript, Vite, and a safe PWA frontend; Django and Django REST Framework backend; PostgreSQL as the authoritative database; and an object-storage abstraction for managed content.

Redis, Celery, WebSockets, and microservices are excluded until a real feature or measured bottleneck justifies them and the owner approves the trade-off.

## Phase 0 Verification

- Frontend production build: passed using a temporary output outside the old repository.
- Existing server JavaScript syntax: 21 of 21 files passed.
- Browser route and responsive inspection: completed with Playwright.
- Old project source edits by rebuild work: none.

## Phase 2 Rebuild Note

The audit above remains the read-only reference baseline. Phase 2 created its implementation only
in `C:\Users\ramih\Desktop\Dentify-Rebuild`. No legacy source was imported or rewritten. The new
foundation directly addresses the audited SQLite, giant PDF component, unsafe PWA cache, missing
permission boundary, missing test, and missing observability risks through documented architecture
and gates; it does not claim the later product features are complete.

## Phase 3 Rebuild Note

Phase 3 removed the audited active mock-auth, browser bearer-token, missing recovery/verification,
frontend-only role, in-memory-only throttle, false RTL, and unsafe account-state gaps in the new
rebuild. The old project remains unchanged. The new implementation uses HttpOnly Django sessions,
CSRF on every unsafe request, hashed single-use account tokens, database-backed scoped throttles,
backend role enforcement, real `lang`/`dir`, and accessible desktop/mobile browser validation.

The old dashboard was used only as identity/study-atmosphere evidence. The new dashboard deliberately
does not reproduce synthetic learning metrics before authoritative education domains exist.

## Phase 4 Rebuild Note

Phase 4 addresses the audited folder-like material navigation, absent hierarchy, absent file
security, non-paginated discovery, and synthetic progress risks in the isolated rebuild. The new
education tree is discipline-neutral; learning objects are versioned and interactive; files are
private and permission-mediated; search is a rebuildable indexed projection; and dashboard values
come only from authoritative progress/bookmark records.

The four selected Skills remained applicable: `impeccable` shaped the guided responsive learning
journey and accessibility states, `design-system` constrained token/component use,
`security-best-practices` guided private file and permission boundaries, and `playwright` validated
real desktop/mobile behavior. No later-discovered Skill was introduced. No dedicated installed Skill
was found for Django/DRF/PostgreSQL/PWA/unit/integration/load testing, so the previously documented
engineering and evidence fallback remains in force.

The reference project remains unchanged. Phase 4 does not claim that the legacy PDF implementation
was reused or that the standalone Focus product is implemented.

## Phase 5 Rebuild Note

Phase 5 addresses the audited correctness mismatch, absent durable attempts, missing autosave and
idempotency, static review mock, and synthetic assessment-state risks. Questions and quizzes now
have stable identity with immutable versions; attempts snapshot the exact graded material; server
time, transactions, answer revisions, and idempotency are authoritative; and result-release policy
prevents early answer-key exposure.

The assessment UX is a guided Study -> Practice -> Review -> Mastery loop, not an isolated quiz
screen. Focus integration remains a typed context only. Integrity signals are evidence, never an
automatic penalty. Achievement/ranking implementations remain Phase 7, with only eligibility facts
emitted now. The old reference project remains untouched.

The selected Skills continued unchanged: `impeccable` guided the focused responsive attempt and
result journey, `design-system` constrained tokens/components, `security-best-practices` guided
answer-key, ownership, CSRF, recovery, and PWA boundaries, and `playwright` validated real browser
behavior. No new applicable Skill was discovered during Phase 5.

## Phase 6 Rebuild Note

Phase 6 addresses the audited unbounded community, weak report workflow, absent pagination, and
scattered moderation risks. Community entries now require a valid learning context; creator spaces
are invitation-only and context-bound; feeds use cursor pagination and query-budget regressions; and
moderation owns evidence snapshots, assignment, conflict checks, reversible content actions, and an
append-only audit history.

The redesign deliberately omits standalone social posting and engagement mechanics. That keeps
discussion attached to study, practice, results, or review and prevents the product from becoming a
generic feed. Notifications remain an event-subscriber boundary for Phase 7 rather than a direct
community dependency. Focus and AI boundaries remain unchanged, and the reference project remains
untouched.

The selected Skills continued unchanged: `impeccable` guided context-first responsive/RTL UX,
`design-system` preserved the shared token hierarchy, `security-best-practices` guided evidence
privacy, enumeration resistance, CSRF, safe text, and moderation fairness, and `playwright` validated
desktop/mobile browser behavior. No new applicable Skill was discovered during Phase 6.

## Phase 7 Rebuild Note

Phase 7 replaces the reference application's synthetic leaderboard and loosely coupled badge state
with authoritative, auditable learning motivation. XP now has an idempotent evidence ledger and
rebuildable balance; achievements use versioned definitions/evidence; streaks use versioned policy
and daily facts; rankings publish deterministic checksummed snapshots; notifications own recipient
state, required/optional preferences, safe targets, and unread counters.

The redesign treats progress as calm learning momentum rather than a point-collection screen. It
explains what counts, places personal milestones before rankings, exposes ranking freshness/rules
and privacy, and keeps notifications focused on useful learning/account actions. Reactions and raw
posting volume do not create repeatable rewards.

The lightweight event bus remains after-commit and in-process. A stateless integration boundary
subscribes without changing source-domain ownership, and `rebuild_motivation` supplies deterministic
reconciliation for missed best-effort delivery. Focus remains independent, AI remains unimplemented,
and no Redis, Celery, broker, WebSocket, microservice, or channel provider was added.

The selected Skills continued unchanged: `impeccable` shaped the calm responsive/RTL information
hierarchy, `design-system` preserved tokens and states, `security-best-practices` hardened server
authority, idempotency, notification routes/counters, and ranking privacy/audit, and `playwright`
validated real desktop/mobile behavior. The browser review found and corrected a muted-text contrast
issue. No new applicable Skill was discovered during Phase 7.

## Phase 8 Rebuild Note

Phase 8 replaces the reference application's implicit premium/payment assumptions with explicit,
server-authoritative commerce evidence and capability access. Catalog, lifecycle, entitlements,
payments, invoices, refunds, and provider integration now have separate ownership. The client cannot
submit money/currency/success/access state, and administrators cannot edit financial state through
Django admin outside domain services.

The billing redesign explains current plan and entitlements before transaction history and does not
invent a price or enabled checkout. This is safer and clearer than exposing a payment-shaped UI
without a selected provider, legal policy, or approved product matrix. Existing features remain
backward compatible until an approved capability gate is applied.

The selected Skills continued unchanged: `impeccable` shaped the transparent responsive/RTL access
journey, `design-system` preserved shared tokens and states, `security-best-practices` hardened money,
provider/webhook, idempotency, raw-payload, refund, admin, and production-settings boundaries, and
`playwright` validated desktop/mobile behavior. No additional applicable Skill was discovered.

The reference project remains unchanged. Local evidence uses SQLite and a signed fake development
provider; it does not claim PostgreSQL commerce concurrency, provider sandbox, edge webhook, or load
readiness.

## Phase 9 Rebuild Note

Phase 9 replaces the reference application's staff-only Django Admin dependence and request-time
operational guesses with a dedicated, capability-based operations platform. Administration,
analytics, audit, reporting, operational actions, and system configuration have separate ownership;
provider-neutral observability remains in the platform core.

Operational dashboards read indexed UTC projections built from domain events. Administrative
mutations require reasons and append redacted evidence. Dangerous account status changes and CSV
exports use bounded preview/confirmation flows. Configuration is allowlisted, typed, versioned, and
cannot hold secrets. Django Admin remains maintenance-only.

The operations redesign uses focused overview/content/support workspaces and mobile list/detail
flows instead of one overloaded dashboard or wide tables. Browser review found and corrected a
duplicate heading and unnamed complementary landmarks. Desktop and RTL mobile views then passed
Axe and overflow checks.

The selected Skills continued unchanged: `impeccable` guided task hierarchy and live accessibility
review, `design-system` preserved shared tokens/patterns, `security-best-practices` hardened RBAC,
audit, configuration, reporting, actions, telemetry, and production checks, and `playwright`
validated full desktop/mobile behavior. No new applicable Skill was discovered.

The reference project remains unchanged. Local evidence does not claim PostgreSQL concurrency,
representative load, a real BI/monitoring provider, scheduled reports, or database-role enforcement
of audit immutability.

## Phase 10 Rebuild Note

Phase 10 replaces the reference application's browser-managed PDF surface with an independent Focus
product. The rebuilt workspace has a private PDF.js adapter, virtual page lifecycle, normalized
annotations, server-authoritative sessions, optimistic revisioned persistence, idempotent sync,
and account-scoped crash recovery. The source PDF is immutable and its checksum is covered by API
tests across annotation saves.

The redesign removes the global shell during study and makes the document dominant. Thumbnails and
notes become requested panels, phone panels overlay instead of displacing the page, and save state
truth is always explicit. Browser capabilities are described honestly: pressure/tilt are used when
reported, finger input pans, and perfect palm rejection is not claimed.

The selected Skills continued unchanged: `impeccable` shaped the low-distraction task hierarchy,
responsive panels, states, and accessibility; `design-system` preserved the established token
layers; `security-best-practices` hardened server authority, ownership, idempotency, same-origin
document loading, bounded validation, and untrusted recovery; and `playwright` governs desktop/
mobile browser validation. No new applicable Skill was discovered during Phase 10.

Final browser evidence covered the production bundle on Desktop Chrome and Pixel 7, including a
real PDF, annotation autosave, Arabic RTL, Axe, overflow, and visual review. It corrected responsive
accessible names, keyboard access to the scrollable document, and mixed-direction title handling.

The original reference at `C:\Users\ramih\Desktop\Dentify-Before-Edits` remains unchanged. Local
evidence does not claim PostgreSQL concurrent sync, real stylus/palm-rejection behavior, multi-hour
memory stability, or representative large-textbook performance.
