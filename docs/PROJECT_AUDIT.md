# Lock-in Project Audit

Status: Phase 0 approved  
Audit date: 2026-07-15  
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
