# Lock-in Decision Log

Last updated: 2026-07-15

This file records decisions that change product behavior, architecture, maintenance cost, or phase boundaries. Approved decisions are not silently replaced. A changed decision must record the trade-off and date.

## Decision Summary

| ID | Decision | Status |
|---|---|---|
| D-001 | Official product name is Lock-in | Approved by owner |
| D-002 | Rebuild lives at C:\Users\ramih\Desktop\Dentify-Rebuild | Approved direction |
| D-003 | Existing project is read-only reference | Approved by owner |
| D-004 | React + TypeScript + Vite + PWA frontend | Approved by owner |
| D-005 | Django + DRF backend and PostgreSQL database | Approved by owner |
| D-006 | Begin as a modular monolith | Approved by owner |
| D-007 | No Redis, Celery, WebSockets, or microservices without justified need | Approved by owner |
| D-008 | Product register with focused, trustworthy, premium personality | Derived from approved brief |
| D-009 | WCAG 2.2 AA is the measurable accessibility target | Provisional product standard |
| D-010 | Use server-managed HttpOnly sessions and CSRF for the web client | Approved architecture direction |
| D-011 | Launch for one institution with future-ready hierarchy | Provisional assumption |
| D-012 | Trial begins at account verification by default and remains configurable | Provisional assumption |
| D-013 | Creator private spaces are asynchronous in version 1 | Provisional product decision |
| D-014 | PWA does not cache/replay private quiz submissions | Approved security direction |
| D-015 | No production data migration is currently required | Provisional assumption |
| D-016 | Source-of-truth documents live in the docs folder and update every phase | Approved by owner |
| D-017 | DESIGN.md is deferred until Phase 3 has a real design-system foundation | Skill-aligned phase decision |
| D-018 | Use Django 5.2 LTS and conservative supported frontend majors | Approved Phase 2 implementation |
| D-019 | Create the custom UUID/email User model before the first migration | Approved Phase 2 implementation |
| D-020 | Treat Focus as its own backend domain and frontend subsystem | Approved by owner |
| D-021 | Publish typed internal events after transaction commit | Approved by owner |
| D-022 | Stay AI-free and expose provider-neutral intelligence boundaries | Approved by owner |
| D-023 | Cache only static PWA shell assets; never private API responses | Approved security implementation |
| D-024 | PostgreSQL is default; SQLite is explicit fast-test fallback only | Approved Phase 2 implementation |
| D-025 | Use same-origin web API/session architecture | Approved architecture implementation |
| D-026 | Add JSON logs, request IDs, liveness, and readiness | Approved Phase 2 implementation |
| D-027 | Enforce quality through local commands and PostgreSQL CI | Approved Phase 2 implementation |
| D-028 | Defer annotation tables until real document-version foreign keys exist | Approved Phase 2 architecture |
| D-029 | Use primitive → semantic → component design tokens | Approved Phase 3 implementation |
| D-030 | Store only digests for expiring single-use account tokens | Approved Phase 3 security implementation |
| D-031 | Enforce CSRF on all unsafe browser requests, including anonymous auth | Approved Phase 3 security implementation |
| D-032 | Student is implicit; staff roles are additive backend-managed groups | Approved Phase 3 implementation |
| D-033 | Use PostgreSQL-backed scoped auth throttles without Redis | Approved Phase 3 implementation |
| D-034 | Show only authoritative account/role dashboard data in Phase 3 | Approved Phase 3 product implementation |
| D-035 | One component tree serves English, Arabic, LTR, and RTL | Approved Phase 3 implementation |
| D-036 | Keep domain events lightweight, in-process, and after-commit | Reconfirmed by owner for Phase 3 |

## D-001 — Product Identity

**Decision:** The official name is Lock-in.

**Reason:** The owner selected Lock-in and the reference application already uses it prominently.

**Consequence:** New copy, metadata, manifests, documentation, and application titles use Lock-in. “Dentify” may appear only inside legacy audit references or as an asset that is intentionally reworked/renamed.

## D-002 and D-003 — Isolation from the Existing Project

**Decision:** The rebuild is created in a separate directory and never modifies the existing application.

**Reason:** The old tree is dirty, contains user work, and serves only as functional/visual evidence.

**Consequence:** No source import, in-place migration, destructive Git command, or shared generated output may target the old directory.

## D-004 and D-005 — Technology Stack

**Decision:** React/TypeScript/Vite/PWA on the frontend; Django/DRF on the backend; PostgreSQL as the primary database.

**Reason:** This meets the owner’s explicit choice and supports a typed UI, mature authentication/administration, transactions, migrations, stable API contracts, and production relational integrity.

**Consequence:** Phase 2 selects currently supported package versions and records them. SQLite is not the default development database.

## D-006 — Modular Monolith

**Decision:** Begin with one modular Django application/deployment split internally by domain.

**Reason:** The current scale does not justify distributed-system complexity. A modular monolith preserves transaction boundaries and keeps deployment understandable.

**Consequence:** Internal modules expose explicit services/policies and do not duplicate business rules. Splitting a service later requires measured evidence.

## D-007 — Infrastructure Restraint

**Decision:** Do not introduce Redis, Celery, WebSockets, microservices, or similar infrastructure until an implemented feature or measured bottleneck requires it.

**Reason:** Each service creates deployment, monitoring, failure, security, and owner-maintenance cost.

**Consequence:** Initial in-platform notifications, ranking batches, and other bounded tasks use request transactions, durable database state, management commands, or a platform scheduler when justified. Any escalation requires a written proposal before implementation.

## D-008 — Product Register and Brand

**Decision:** Lock-in is an authenticated product interface, not a marketing surface. Personality is focused, trustworthy, and premium.

**Reason:** Students are completing tasks, often under time pressure. Familiarity and clarity build more trust than decorative novelty.

**Consequence:** Dark identity, gold/purple accents, mascot, and study atmosphere are retained. Dense card grids, excessive glass, unfamiliar controls, and decorative motion are not retained.

## D-009 — Accessibility Standard

**Decision:** Use WCAG 2.2 AA as the release target.

**Reason:** “Excellent accessibility” needs a testable definition. WCAG 2.2 AA is an appropriate production baseline for a university web/PWA product.

**Trade-off:** Some advanced canvas/PDF interactions may require accessible alternatives rather than identical keyboard behavior inside every drawing operation.

**Review:** Confirm before production if the institution imposes a stricter standard.

## D-010 — Web Session Model

**Decision:** Prefer Django server sessions in HttpOnly cookies with CSRF protection for the web application.

**Reason:** This avoids long-lived bearer tokens in browser storage and aligns with Django’s security model.

**Consequence:** Same-origin deployment is preferred. Future native mobile authentication can add a distinct short-lived token flow without moving web sessions into localStorage.

## D-011 — Institution Scope

**Decision:** Assume one institution at launch, while preserving a hierarchy model that can represent additional institutions later.

**Reason:** No multi-tenant operating model was supplied, and claiming full tenant isolation would add substantial unrequested complexity.

**Consequence:** Phase 4 models institution as a real root entity, but cross-tenant billing, branding, administration, and data isolation are not launch claims.

## D-012 — Trial Start

**Decision:** Default the one-month trial to begin when a student verifies/activates their account; make the rule configurable.

**Reason:** This gives each verified student a complete trial and avoids losing trial days before account access.

**Consequence:** Existing subscription periods retain their recorded start/end if the global default changes later.

## D-013 — Creator Spaces

**Decision:** Implement private creator spaces as asynchronous threaded discussions in version 1.

**Reason:** The required learning discussion and moderation behavior does not require real-time delivery. This avoids WebSockets and allows reliable mobile, moderation, reporting, and audit behavior first.

**Consequence:** A later real-time chat proposal must define presence, delivery, notification, moderation, scaling, and operational requirements before implementation.

## D-014 — PWA Data Safety

**Decision:** Service-worker caches do not store or replay authenticated quiz submissions or private user API responses.

**Reason:** A stale replay could create incorrect results, leak data between accounts, or falsely report successful submission.

**Consequence:** Quiz recovery uses explicit attempt autosave and a scoped pending-change buffer, with the server as authority.

## D-015 — Data Migration

**Decision:** Assume the old prototype contains no production data requiring migration.

**Reason:** The brief states the platform has not launched and the audit found mock/seed data paths.

**Consequence:** Phase 2 creates a clean PostgreSQL schema. If real data is identified, migration becomes a separately estimated and reviewed requirement before importing anything.

## D-016 — Documentation as Source of Truth

**Decision:** Maintain PROJECT_AUDIT.md, PRODUCT.md, ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, TODO.md, CHANGELOG.md, and NEXT_SESSION.md in the docs folder after every phase.

**Reason:** Work must remain recoverable if conversation context is lost.

**Consequence:** A phase cannot be reported complete until its documentation and validation are updated.

## D-017 — Visual Specification Timing

**Decision:** Do not create a speculative DESIGN.md in Phase 1. Create it during Phase 3 when real tokens and foundational components are being designed.

**Reason:** The Impeccable Skill supports pre-implementation seeding, but the approved phase plan places the design system in Phase 3. A premature visual spec could create unreviewed implementation work or arbitrary styling choices.

**Consequence:** PRODUCT.md provides strategic design context now. Phase 3 will document the real visual system and explain every material redesign.

## D-018 — Supported Runtime Baseline

**Decision:** Use Python 3.13.14, Django 5.2.16 LTS, PostgreSQL 18.4, Node 24.16.0,
React 19.2.7, Vite 7.3.6, and TypeScript 6.0.3 as the Phase 2 baseline.

**Reason:** Django 5.2 has the longer LTS window. Vite 8 and TypeScript 7 were newly released, so
the mature supported previous majors reduce foundation churn.

**Consequence:** Direct dependencies are exact-pinned and the npm tree is locked. Major upgrades
need a tested dependency decision, not an automatic version bump.

## D-019 — Custom User Before First Migration

**Decision:** Use a UUID-primary-key, normalized email-login User model from migration 0001.

**Reason:** Replacing Django's user model after business migrations is expensive and risky. UUIDs
also avoid guessable public identifiers.

**Consequence:** Phase 3 registration uses this model and cannot accept client-selected roles.

## D-020 — Focus Bounded Domain

**Decision:** Focus owns sessions, timeline, statistics selectors, events, and frontend workspace
contracts as a first-class domain/subsystem.

**Reason:** Focus is a flagship product with future study, quiz, achievement, anti-cheating, and AI
integrations. Treating it as a PDF-page option would create a giant coupled component.

**Consequence:** Full PDF/annotation features remain later work but do not require re-splitting the
foundation.

## D-021 — Internal After-Commit Events

**Decision:** Domain services publish immutable typed events through an in-process bus only after
the database transaction commits.

**Reason:** This decouples modules without introducing a queue or distributed failure modes.

**Trade-off:** Delivery is not durable. Authoritative grading, billing, progress, and audit cannot
depend solely on a best-effort subscriber. A future outbox requires a separately justified need.

## D-022 — AI-Free, AI-Ready

**Decision:** Do not create an AI app or install an AI/provider dependency. Future intelligence
uses permission-filtered read ports and domain events.

**Reason:** Speculative AI infrastructure adds privacy, cost, and coupling without a current
feature.

**Consequence:** AI output can recommend or explain but cannot directly write authoritative domain
state.

## D-023 — PWA Cache Safety

**Decision:** Precache static SPA assets only, deny `/api/` from navigation fallback, prompt for
updates, and expose an update guard.

**Reason:** Shared caches must not leak or replay user, answer, or submission data. Forced reloads
can destroy active work.

## D-024 — PostgreSQL and Fast-Test Fallback

**Decision:** PostgreSQL is default everywhere. SQLite may run only when
`LOCKIN_TEST_USE_SQLITE=true` is explicitly set.

**Reason:** The current workstation has no PostgreSQL/Docker, but Phase 2 still needs executable
unit feedback. Making the fallback explicit prevents accidental production drift.

**Consequence:** PostgreSQL CI/local Docker evidence is still required for database-specific
approval.

## D-025 — Same-Origin Web Architecture

**Decision:** The React client calls a fixed same-origin `/api/v1` path and uses Django session/CSRF
security.

**Reason:** This prevents dynamic credentialed cross-origin requests and avoids unnecessary CORS
complexity.

## D-026 — Foundation Observability

**Decision:** Use structured JSON logs, validated request UUIDs, liveness, and database readiness.

**Reason:** Production support needs safe correlation and health signals before feature growth.

**Consequence:** Logs carry no request bodies or secrets; readiness returns generic failure detail.

## D-027 — Quality Gates

**Decision:** Gate changes with Ruff, mypy, pytest, ESLint, TypeScript, Vitest, production PWA
build, Playwright, migration drift, and PostgreSQL CI.

**Reason:** The production-ready goal needs repeatable evidence rather than manual confidence.

## D-028 — Annotation Referential Integrity Timing

**Decision:** Define frontend annotation contracts now but create persistence tables only after
Content/File/DocumentVersion models exist.

**Reason:** An early unvalidated document UUID would falsely imply referential integrity and create
a cleanup migration.

## D-029 — Three-Layer Design Tokens

**Decision:** Build styling from OKLCH primitives through semantic roles to component contracts.

**Reason:** Components should express intent rather than duplicate raw palette values. This supports
consistent accessibility, responsive states, and future theme evolution without a UI framework.

**Consequence:** New UI consumes semantic/component variables from `DESIGN.md`; ad hoc raw colors
inside feature components require a documented exception.

## D-030 and D-031 — Account Token and CSRF Model

**Decision:** Email verification, password reset, and email-change links are expiring, single-use,
and stored only as salted digests. Every unsafe same-origin request requires CSRF, even before login.

**Reason:** A database leak must not reveal usable link credentials, and auth endpoints are not safe
from cross-site request actions merely because the visitor is anonymous.

**Consequence:** Raw tokens exist only at issuance/email time. The SPA obtains/refreshes CSRF from a
same-origin endpoint and never stores a session or account token in Web Storage.

## D-032 — Additive Role Model

**Decision:** Every active account has the implicit student role. Moderator, creator, and
administrator are additive Django groups assigned only by backend-authorized administrators.

**Reason:** Staff are also learners, and additive capabilities avoid destructive mutually exclusive
role transitions. Backend checks prevent client-selected role escalation.

**Consequence:** The final active administrator cannot be removed, and role changes create an
authoritative security record plus a best-effort after-commit event.

## D-033 — Database-Backed Account Throttling

**Decision:** Login failures and registration/verification/recovery/email-change requests use scoped,
hashed database attempt keys and fixed windows.

**Reason:** The approved infrastructure excludes Redis, while in-process memory limits become
ineffective across multiple application workers. PostgreSQL provides one shared initial authority.

**Trade-off:** High-volume attack traffic writes rows and requires retention cleanup/monitoring. A
Redis or edge limiter may be proposed later only with measured database pressure and owner approval.

## D-034 — Truthful Phase 3 Dashboard

**Decision:** Display account readiness, session count, roles, and real administrator account totals;
do not manufacture lesson, quiz, ranking, achievement, or study-progress values.

**Reason:** Empty-but-honest states build more trust than a visually fuller dashboard backed by fake
data. Learning actions become available with their authoritative domains.

## D-035 — Shared LTR/RTL Component Tree

**Decision:** English and Arabic share catalogs, components, routes, and logical-property CSS.

**Reason:** Separate markup drifts in behavior and accessibility. Direction is document state, not a
screen-specific visual override.

**Consequence:** Catalog key parity, `html.lang`, `html.dir`, and mobile RTL are automated test gates.

## D-036 — Lightweight Domain Events Reconfirmed

**Decision:** Keep the Phase 2 internal synchronous after-commit bus. Do not add a broker, distributed
event transport, or background worker in Phase 3.

**Reason:** Registration and role integrations need decoupling, not distributed-system operations.

**Consequence:** Durable security records remain authoritative. Subscribers are best effort; a future
outbox requires an implemented subscriber with explicit retry/delivery needs.

## Decisions Requiring Later Owner Input

- Subscription price, currency, grace policy, and real payment provider.
- Real curriculum names/content and creator assignments.
- Legal privacy, retention, terms, and account-deletion policy.
- Email and push-notification providers.
- Ranking formula and achievement catalog.
- Additional approved anti-cheating ideas.
- Whether a future multi-institution release needs true tenant isolation.

## D-037 — Generic Materialized Academic Tree

**Decision:** Represent institution through lesson as typed nodes in one variable-depth tree with a
UUID materialized path and explicit relationship rules.

**Reason:** A fixed dentistry schema or one table per academic level would force migrations when a
new institution uses a different structure. Materialized paths make subtree reads and scoped
authority practical for the target size without a new infrastructure component.

**Consequence:** Moves are transactional, update descendants, reject cycles, and require tests. This
supports multiple institutions structurally but does not claim tenant isolation.

## D-038 — Stable Learning Identity with Immutable Versions

**Decision:** Separate `LearningObject` identity from immutable `LearningObjectVersion` and asset
snapshots, retaining distinct current and published version pointers.

**Reason:** Bookmarks, progress, Focus annotations, links, and future quiz/flashcard relationships
need stable identity while publication must not mutate a document students already use.

**Consequence:** A replacement draft can be reviewed without withdrawing the last published version;
progress remains tied to the exact version studied.

## D-039 — Private Managed File Delivery

**Decision:** Store managed files outside public routing and deliver them only through authenticated,
policy-aware view/download endpoints with Range support.

**Reason:** A public media URL bypasses publication, availability, ownership, and download policy.
PDF/audio still need efficient reading and seeking.

**Consequence:** Every delivery performs authorization. Upload validation and checksum are mandatory;
malware state stays `not_configured` until a real scanner exists.

## D-040 — Rebuildable Search Projection

**Decision:** Search an indexed `SearchEntry`/`SearchTerm` projection populated from authoritative
education/content services instead of joining every domain per request.

**Reason:** Search must cover heterogeneous current/future resource kinds with stable pagination and
must be replaceable by PostgreSQL full-text search when measured data justifies it.

**Consequence:** The projection is disposable and rebuildable. Source domains remain authoritative;
projection synchronization belongs to state-changing services.

## D-041 — Capability-Scoped Content Creation

**Decision:** Creator authority is an explicit set of capabilities rooted at an academic subtree.

**Reason:** A global creator role is too broad for multiple colleges and departments, while deeply
duplicated per-resource grants are hard to administer.

**Consequence:** The additive creator role permits entry into management, but service policy still
requires an applicable scope for create/review/publish/hierarchy actions.

## D-042 — Deterministic Dashboard Projection

**Decision:** The dashboard consumes an authoritative progress read model and recommends eligible
resume work before bookmarks, otherwise a path-selection state.

**Reason:** The command center must help the student act now without inventing future AI, mastery,
quiz, review, or achievement signals.

**Consequence:** Future recommendation engines may replace the selector through a typed boundary,
but the deterministic fallback remains available and domain state remains authoritative.

## D-043 — Focus Context, Not Embedded Focus

**Decision:** A learning-object version exposes only a small Focus launch context. The normal
resource page does not absorb PDF renderer/annotation/gesture/autosave responsibilities.

**Reason:** Focus must grow as a professional study product without coupling content publication to
one viewer or recreating the legacy giant PDF page.

**Consequence:** Phase 4 can study a private PDF and save progress, but cannot claim Focus features.

## D-044 — Keep Phase 4 Infrastructure Local

**Decision:** Use PostgreSQL indexes, bounded selectors, pagination, request-time transactions, and
the existing in-process after-commit bus only.

**Reason:** No implemented feature or measured bottleneck currently justifies Redis, Celery, a
broker, WebSockets, or microservices.

**Consequence:** PostgreSQL/load measurements remain a gate before production scaling claims; new
infrastructure requires a measured proposal and owner approval.
