# Lock-in Decision Log

Last updated: 2026-09-02

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
| D-037 | Use a generic materialized academic tree | Approved Phase 4 implementation |
| D-038 | Stable learning identity with immutable versions | Approved Phase 4 implementation |
| D-039 | Deliver managed files through private policy-aware endpoints | Approved Phase 4 security implementation |
| D-040 | Use a rebuildable search projection | Approved Phase 4 implementation |
| D-041 | Scope creator capabilities to academic subtrees | Approved Phase 4 implementation |
| D-042 | Keep dashboard recommendations deterministic and authoritative | Approved Phase 4 implementation |
| D-043 | Integrate learning content with Focus through context only | Approved Phase 4 implementation |
| D-044 | Keep Phase 4 infrastructure local to the modular monolith | Approved Phase 4 implementation |
| D-045 | Stable question and quiz identity with immutable release versions | Approved Phase 5 implementation |
| D-046 | Grade only immutable server-created attempt snapshots | Approved Phase 5 correctness implementation |
| D-047 | Server deadline, revisions, locks, and idempotency are authoritative | Approved by owner and implemented |
| D-048 | Result serializer owns immediate/after-close disclosure | Approved Phase 5 fairness implementation |
| D-049 | Integrity signals are informational and cannot auto-penalize | Approved Phase 5 implementation |
| D-050 | Spaced review is deterministic, logged, and replaceable | Approved Phase 5 implementation |
| D-051 | Achievements/rankings receive eligibility facts only in Phase 5 | Phase-boundary decision |
| D-052 | Assessment connects to Focus through context, not ownership | Reconfirms standalone Focus boundary |
| D-053 | Community discussions require a valid learning context | Approved Phase 6 product implementation |
| D-054 | Creator spaces are private and bound to one learning context | Approved Phase 6 implementation |
| D-055 | Moderation owns evidence, workflow, fairness, and audit history | Approved Phase 6 architecture |
| D-056 | Community notifications consume events; no direct dependency | Approved Phase 6 boundary |
| D-057 | Use cursor feeds, aligned indexes, and query-budget regressions | Approved Phase 6 scale posture |
| D-058 | Keep social engagement mechanics outside Phase 6 | Product-focus and phase decision |
| D-059 | Separate XP, achievements, rankings, streaks, and notifications | Approved Phase 7 architecture |
| D-060 | Store authoritative evidence and rebuildable projections | Approved Phase 7 correctness design |
| D-061 | Reward bounded meaningful learning, never raw engagement volume | Approved Phase 7 product policy |
| D-062 | Publish deterministic audited ranking snapshots with user privacy | Approved Phase 7 fairness design |
| D-063 | Version streak policy and daily evidence | Approved Phase 7 extension design |
| D-064 | Resolve safe notification targets and keep future channels unavailable | Approved Phase 7 security boundary |
| D-065 | Reconcile best-effort subscribers from committed source records | Approved Phase 7 recovery design |
| D-066 | Keep Phase 7 local to the modular monolith | Approved architecture restraint |
| D-067 | Keep seven commerce domains independent | Approved Phase 8 architecture |
| D-068 | Entitlements are the access source of truth | Approved Phase 8 authorization design |
| D-069 | Snapshot immutable integer-money evidence | Approved Phase 8 financial integrity design |
| D-070 | Accept commerce success only from verified idempotent provider facts | Approved Phase 8 security design |
| D-071 | Bound and verify webhooks without raw-payload retention | Approved Phase 8 provider boundary |
| D-072 | Model explicit subscription lifecycle and account scope | Approved Phase 8 extension design |
| D-073 | Keep checkout unavailable until paid-launch inputs are approved | Approved Phase 8 product boundary |
| D-074 | Keep operational domains independent | Approved Phase 9 architecture |
| D-075 | Use capability-based operational roles | Approved Phase 9 least-privilege design |
| D-076 | Build analytics from durable event facts and UTC projections | Approved Phase 9 scale design |
| D-077 | Keep administrative audit append-only and redacted | Approved Phase 9 integrity design |
| D-078 | Require bounded preview/confirmation for actions and exports | Approved Phase 9 safety design |
| D-079 | Keep configuration typed, versioned, allowlisted, and non-secret | Approved Phase 9 configuration design |
| D-080 | Use provider-neutral observability and no new infrastructure | Approved Phase 9 operations boundary |
| D-081 | Focus is an independent product domain | Approved Phase 10 architecture |
| D-082 | Store renderer-independent immutable annotations | Approved Phase 10 architecture |
| D-083 | Use local-plus-server autosave truth | Approved Phase 10 resilience design |
| D-084 | Virtualize PDF rendering behind one adapter | Approved Phase 10 performance design |
| D-085 | Keep stylus and accessibility capability claims honest | Approved Phase 10 UX contract |
| D-086 | Add no distributed infrastructure for Focus | Approved Phase 10 restraint |
| D-087 | Use a single-host hardened production topology first | Approved Phase 11 deployment baseline |
| D-088 | Separate PostgreSQL migration owner and runtime roles | Approved Phase 11 least privilege |
| D-089 | Fail closed on production secrets, proxy, uploads, and providers | Approved Phase 11 security contract |
| D-090 | Make release and preflight explicit one-shot gates | Approved Phase 11 deployment safety |
| D-091 | Gate measured query and bundle budgets without capacity claims | Approved Phase 11 performance policy |
| D-092 | Require coordinated verified recovery and provider-neutral observability | Approved Phase 11 operations policy |
| D-094 | DATABASE_URL is the portable database contract, with POSTGRES_* overrides | Approved deployment direction |
| D-095 | Private files live in provider-neutral object storage, delivered only through the API | Approved deployment direction |
| D-096 | A deployment is production-ready only once the image has started and served in CI | Approved release gate |
| D-097 | ClamAV decides the hosting shape; Phase 1 runs on the VPS | Approved deployment direction |

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

## D-045 and D-046 - Immutable Assessment Releases and Attempts

**Decision:** Questions and quizzes have stable identities with immutable current/published versions;
attempts grade only a private server-created snapshot of one exact release.

**Reason:** A later edit, reorder, retirement, or private draft must never change a student's active
or submitted assessment.

**Consequence:** Storage is intentionally duplicated in the attempt snapshot. Historical correctness
and dispute evidence take priority over deduplication.

## D-047 and D-048 - Server Authority and Disclosure

**Decision:** Server deadlines, row locks, monotonic answer revisions, idempotency receipts, grading,
and result-release policy are authoritative.

**Reason:** Browser clocks, retries, offline state, and duplicate requests are not sufficiently fair
or reliable for scored work.

**Consequence:** The client displays server state, may retain a bounded pending UUID payload, and
must reconcile conflicts. It cannot calculate an official score or reveal a key early.

## D-049 - Evidence Without Automatic Punishment

**Decision:** Visibility, workspace, and connection signals are informational only.

**Reason:** Browser/device behavior is noisy and cannot prove cheating fairly.

**Consequence:** Signals never change score/status. A future anti-cheating change needs an approved
fairness model, evidence, appeal path, tests, and explicit versioning.

## D-050 - Deterministic Spaced Review

**Decision:** Start with a small bounded-ease interval algorithm and log every transition.

**Reason:** Explainable scheduling is more correct and maintainable than speculative personalization.

**Consequence:** Future analytics or AI may recommend inputs through extension points, but cannot
silently rewrite authoritative history.

## D-051 and D-052 - Phase and Product Boundaries

**Decision:** Phase 5 emits ranking/achievement eligibility facts but implements neither domain.
Assessment connects to Focus only through typed context and a dedicated shell.

**Reason:** This preserves the Phase 7 boundary and lets Focus grow independently as a professional
study product.

**Consequence:** No speculative leaderboard, achievement, Focus session ownership, broker, or AI
dependency was introduced.

## D-053 — Contextual Community Only

**Decision:** A discussion must reference a discoverable lesson or a published learning object,
question, or quiz. The public feed cannot create a context-free post.

**Reason:** Community exists to continue a learning task, not to maximize general engagement.

**Consequence:** New learning content types integrate through the context resolver. A generic social
feed, follower graph, and standalone status model are not part of the product contract.

## D-054 — Context-Bound Creator Spaces

**Decision:** Creator spaces are invitation-only, owned by an authorized creator/administrator, and
bound to exactly one learning context with explicit member/moderator records.

**Reason:** Private discussion is useful when its academic purpose and authority are visible.

**Consequence:** Membership revocation is immediate and historical changes remain append-only. A
space cannot become an unscoped private social group without an intentional future decision.

## D-055 — Moderation as a Separate Evidence Domain

**Decision:** `apps.moderation` owns report evidence snapshots, rate/idempotency controls, assignment,
workflow transitions, conflict-of-interest checks, duplicates, and append-only audit entries.

**Reason:** Scattering report status and moderator actions through community, assessment, and content
would weaken fairness, privacy, and long-term maintainability.

**Consequence:** Assessment's existing issue-report API remains compatible but creates the central
moderation record transactionally. Only community targets permit reversible content actions; other
domains keep ownership of their content lifecycle.

## D-056 — Event-Driven Notifications Boundary

**Decision:** Community and moderation publish small typed after-commit events. They never import or
write a notification domain directly.

**Reason:** Replies, mentions, reports, and moderator decisions need future notifications without
tightly coupling domain state or adding speculative delivery infrastructure.

**Consequence:** Phase 7 may add subscribers and user-visible notification state. The current bus
remains synchronous, in-process, and best-effort until a real durability requirement is approved.

## D-057 — Database-First Feed Scale

**Decision:** Use stable cursor pagination, query-specific indexes, relation preloading, request role
fact caching, and query-budget regression tests for community/moderation collections.

**Reason:** The projected data volume does not by itself justify a cache, broker, or microservice,
but it does justify bounded and measurable database access now.

**Consequence:** PostgreSQL concurrency and representative load remain production evidence gates.
Redis, Celery, WebSockets, brokers, and microservices were not added.

## D-058 — No Engagement Mechanics Without Learning Value

**Decision:** Reactions, popularity ranking, followers, direct messages, and study groups are outside
Phase 6. One reply level is the current discussion structure.

**Reason:** These features add noise, abuse surface, projection cost, and moderation complexity before
there is evidence that they improve learning.

**Consequence:** A later proposal must identify the learning outcome, fairness/moderation contract,
scale model, accessibility behavior, and phase approval before implementation.

## D-059 — Independent Motivation Domains

**Decision:** XP, achievements, rankings, streaks, and notifications are five independent domains.
`motivation_integrations` wires events and stores no business state.

**Reason:** Each capability has different rules, scale, audit, privacy, and rebuild requirements. A
single gamification module would couple unrelated change and make ownership unclear.

**Consequence:** Source domains publish facts and do not import motivation engines. Each domain has
its own service, selector, event, API, model, migration, and test boundary.

## D-060 and D-061 — Evidence First, Meaningful Rewards Only

**Decision:** XP transactions, achievement evidence, ranking facts, and streak activity are durable,
idempotent evidence. Derived balances/progress are rebuildable. Awards are bounded and require
authoritative learning eligibility; raw post volume and reactions earn no repeatable credit.

**Reason:** Correctness and anti-grind fairness require a traceable source for every progression
change. Engagement volume is easy to manipulate and does not prove learning.

**Consequence:** Duplicate delivery cannot duplicate progression. Corrections and future anti-cheat
work can audit and recompute state without trusting client history.

## D-062 — Deterministic Audited Ranking Snapshots

**Decision:** Rankings consume only eligible server evidence and publish stored snapshots with an
explicit tie strategy, rules, checksum, evidence count, freshness, privacy mode, and failure audit.

**Reason:** A fair learning rank must be deterministic, explainable, rebuildable, and stable during
a student's view. Live request-time global aggregation is harder to audit and scale.

**Consequence:** The client cannot submit score or rank. Students choose inclusion and full-name,
initials, or anonymous display. Failed calculations remain visible to operators rather than
silently rolling back their audit record.

## D-063 — Versioned Streak Policy

**Decision:** Store one idempotent activity fact per source and recompute a daily projection under a
versioned policy containing qualifying activities, timezone, grace, freeze, and recovery fields.

**Reason:** Events can arrive out of order and future freeze/grace rules must not require a schema
redesign or silently reinterpret prior behavior.

**Consequence:** Current rules use only approved qualifying activities. Freeze tokens, grace, and
recovery remain disabled until explicit product behavior is approved.

## D-064 — Safe In-App Notifications First

**Decision:** Notifications are recipient-owned, deduplicated, preference-aware records. Opening a
target resolves an allowlisted same-origin route and rechecks permission. Email and push channel
contracts exist but are unavailable.

**Reason:** Useful community, moderation, achievement, and account updates need one dependable
center without creating open redirects, stale authorization, or unimplemented delivery claims.

**Consequence:** Required account/security messages cannot be disabled. Unread counters use a
consistent lock order. A provider or worker requires a future approved delivery design.

## D-065 — Reconcile the Lightweight Event Bus

**Decision:** Keep the synchronous after-commit bus and add `rebuild_motivation` to reconstruct
missing evidence/projections from committed authoritative source records.

**Reason:** The current scale does not justify queue infrastructure, but best-effort subscriber loss
must have a deterministic operational recovery path.

**Consequence:** Subscribers remain idempotent. A transactional outbox or worker can be proposed
later only with a demonstrated delivery/latency requirement and explicit operational contract.

## D-066 — Phase 7 Infrastructure and Product Boundary

**Decision:** Add no Redis, Celery, broker, WebSocket, microservice, subscription/payment, AI,
notification provider, or Focus implementation change in Phase 7.

**Reason:** None is required for the implemented synchronous rules, indexed queries, stored
snapshots, in-app notifications, or local recovery command.

**Consequence:** Phase 8 is blocked pending owner approval. PostgreSQL concurrency and representative
load remain production evidence gates rather than unverified claims.

## D-067 - Independent Commerce Domains

**Decision:** Catalog, subscription, entitlement, payment, invoice, refund, and provider integration
are separate domains. `commerce_integrations` is a stateless event composition boundary.

**Reason:** These areas have different invariants, audit obligations, and change rates. A billing
catch-all would couple feature access to provider and financial implementation details.

**Consequence:** Domains communicate through typed services/events and do not mutate each other's
tables. Future provider replacement does not change subscription or entitlement policy.

## D-068 - Entitlements Are the Access Source of Truth

**Decision:** Protected capabilities ask for a stable entitlement code. Plan codes and client flags
cannot authorize Focus, premium content, downloads, AI, or later capabilities.

**Reason:** Products, promotions, licenses, and account scopes will evolve independently of feature
code. Server-owned capability decisions preserve one auditable authorization path.

**Consequence:** Phase 8 seeds capability definitions and trial rules but does not silently gate an
existing feature. Any later gate needs an approved entitlement matrix and uses the shared service or
DRF mixin.

## D-069 - Immutable Financial Snapshots and Integer Money

**Decision:** Catalog versions are immutable after publication; payments and invoices snapshot the
server price. Money uses integer minor units plus a stored currency exponent.

**Reason:** Historical records must not change with catalog edits, and floating-point or assumed
two-decimal currency arithmetic is unsafe.

**Consequence:** Provider facts must exactly match amount/currency. Supporting a new currency does
not reinterpret old transactions.

## D-070 - Provider-Confirmed, Idempotent Commerce

**Decision:** The client may select only an active server price. Payment/refund success enters the
system only through a verified provider event, with stable idempotency and append-only transitions.

**Reason:** Client success, amount, currency, plan, and refund state are attacker-controlled inputs.

**Consequence:** Unexpected financial fields are rejected; duplicate delivery is harmless; pending
refunds reserve value; provider mismatch and identifier/digest reuse fail closed.

## D-071 - Bounded Provider Webhooks Without Raw Payload Retention

**Decision:** Validate provider, payload size, timestamp, HMAC, exact schema, digest, and duplicate
identity before normalized event processing. Store verification/process audit but not the raw body.

**Reason:** This limits replay, memory, schema-confusion, secret, and sensitive-retention exposure
while retaining evidence needed to diagnose delivery.

**Consequence:** Production rejects the fake/unknown provider. Edge and provider sandbox tests remain
a launch gate. Failed normalized events remain auditable and retryable.

## D-072 - Explicit Lifecycle and Account Scope

**Decision:** Subscription state uses a validated transition graph and explicit periods, grace,
cancellation, suspension, expiry, and refund state. Subscription ownership uses an account object.

**Reason:** Boolean premium state cannot model renewal or access policy and cannot expand safely to
family, organization, or institution ownership.

**Consequence:** Individual accounts work now. Other account types are schema extension points only;
seats, membership, promotions, and license policy require later approval.

## D-073 - Honest Commerce Launch Boundary

**Decision:** Keep checkout disabled until a production provider and approved paid price/currency,
tax, entitlement, cancellation, refund, and legal policy exist.

**Reason:** Invented pricing or a fake production checkout would mislead students and weaken payment
integrity.

**Consequence:** The UI explains plan/access and history, shows no fabricated price, and does not
claim purchases are available. No Redis, Celery, broker, WebSocket, microservice, worker, AI, or
Focus internal change was added.

## D-074 - Independent Operational Domains

**Decision:** Administration, analytics, audit, reporting, operational actions, and system
configuration are separate domains. `operations_integrations` is a stateless event composition
boundary.

**Reason:** Authorization, projections, evidence, exports, mutations, and configuration have
different invariants, retention, and change rates. A single admin module would couple unrelated
operational risk.

**Consequence:** Each domain owns its models/services/selectors/APIs. Django Admin remains an
internal maintenance surface, not the daily operations product.

## D-075 - Capability-Based Operational Roles

**Decision:** Staff operations access is granted by fine-grained capabilities aggregated into
operational roles, independently from product roles. Existing active administrators retain a full
bootstrap fallback.

**Reason:** Support, content, moderation, finance, and analytics responsibilities must not inherit
unrelated power. Server authority cannot depend on which navigation the client renders.

**Consequence:** Every endpoint checks the smallest capability. Assignments require reason/audit.
Role-removal and account-suspension execution lock effective administrator rows in stable order,
and the final effective platform administrator cannot be removed or suspended.

## D-076 - Durable Analytics Facts and UTC Projections

**Decision:** Consume committed domain events into idempotent `(event_id, metric)` facts and serve
dashboards/reports from UTC daily projections. Distinct daily learners have their own indexed
projection.

**Reason:** Request-time scans across learning, assessment, Focus, community, and commerce history
will not scale or provide an honest freshness contract.

**Consequence:** Dashboards expose period/timezone/freshness, rebuild is bounded and deterministic,
and source domains remain authoritative. The in-process subscriber-loss limitation remains explicit;
no broker/outbox is added without measured need.

## D-077 - Append-Only Redacted Administrative Audit

**Decision:** Supported application paths cannot update/delete audit records. Every implemented
administrative mutation records actor, action, target, reason, source, correlation, redacted
before/after, related entities, and time.

**Reason:** Operations must be traceable without turning the audit store into a secret-retention or
editable-comment channel.

**Consequence:** Secret-like keys are recursively redacted. Production database-role denial of
update/delete remains a deployment gate in addition to application enforcement.

## D-078 - Bounded Preview and Confirmation

**Decision:** Dangerous operational actions and report exports create bounded previews with expiring
confirmation tokens before execution. Implement only actions with a real domain service and product
need.

**Reason:** Operators need target/consequence/volume evidence before mutation or extract, and long
synchronous work must not destabilize production.

**Consequence:** Account status changes are idempotent, auditable, protected, and report partial
results. CSV exports enforce filters/row caps and record row/hash evidence. Scheduling/workers remain
outside this phase.

## D-079 - Typed Non-Secret Configuration

**Decision:** Operational configuration is an allowlisted catalog of typed, range-validated,
versioned values with optimistic concurrency and mandatory change reason. It cannot store secrets.

**Reason:** Arbitrary settings blobs create stale overwrites, invalid runtime state, and secret
leakage through staff APIs.

**Consequence:** New keys require code review/definition. Deployment secrets stay in the approved
secret store/environment, never the database configuration catalog or frontend variables.

## D-080 - Provider-Neutral Observability, Local Infrastructure

**Decision:** Expose normalized metric and error-reporting protocols, structured safe request logs,
and authorized health projections with honest no-op providers. Add no monitoring/BI vendor, queue,
broker, scheduler, or service in Phase 9.

**Reason:** The platform needs stable instrumentation boundaries now, but a vendor choice or
distributed infrastructure is not justified by implemented volume/evidence.

**Consequence:** Future providers plug into platform contracts without domain imports. Health shows
`not_configured` rather than a false success. PostgreSQL concurrency, load, alerts, retention, and
provider validation remain production evidence gates.

## D-081 - Focus Is an Independent Product Domain

**Decision:** Focus owns its sessions, workspace snapshots, annotations, sync, recovery contracts,
renderer adapter, viewer, toolbar, and extension slots. Only a narrow API integration resolves an
authorized content version/file and checks the generic `focus.workspace` entitlement.

**Reason:** Importing assessment, community, AI, motivation, or commerce state into the study
workspace would make its performance and release lifecycle depend on unrelated products.

**Consequence:** Other domains consume Focus events or use explicit future adapters. Focus business
services do not import their models. No plan-name flag or notification call exists inside Focus.

## D-082 - Renderer-Independent Immutable Annotation Storage

**Decision:** Never modify the PDF. Store owner/version/page annotations separately with normalized
geometry, typed payload, collection revision, record revision, soft deletion, and idempotent sync.

**Reason:** Source integrity, zoom/device portability, recovery, renderer replacement, and future
layers require marks to be learning data rather than mutations of document bytes.

**Consequence:** PDF.js types stay in one adapter. The backend validates geometry/tool payloads and
page bounds. Undo may restore the same soft-deleted UUID, while collisions across collections fail.

## D-083 - Dual-Layer Autosave Truth

**Decision:** Persist a schema-versioned, account/document-scoped, deeply validated IndexedDB
recovery record before debounced optimistic server sync. Expose local, offline, saving, saved,
conflict, and failed states separately.

**Reason:** Browsers and connections terminate unexpectedly, but local persistence is not server
acknowledgement. Conflating them loses work or falsely tells a student it is durable remotely.

**Consequence:** PWA updates and unload receive guards while changes are pending. Sync clears only
the exact mutation version sent; newer edits survive older acknowledgements. Completion waits for a
clean server-acknowledged state.

## D-084 - Virtual PDF Rendering Behind an Adapter

**Decision:** Pin PDF.js behind `PdfDocumentAdapter`; activate only near-viewport pages, separately
track the visible current page, cap render DPR, cancel obsolete tasks, and release page/document
resources.

**Reason:** Hundreds of pages and image-heavy textbooks cannot be rendered eagerly on phones and
tablets without memory, latency, and rerender costs.

**Consequence:** Focus can replace or upgrade PDF.js without changing annotation/session contracts.
The service worker never runtime-caches authenticated PDFs. Representative device memory/input
latency remains a production evidence gate.

## D-085 - Honest Stylus, Touch, and Accessibility Contract

**Decision:** Pen/mouse may annotate; finger input pans and drives pinch/double-tap. Retain pressure
and tilt only when Pointer Events report them. Provide keyboard equivalents, extracted text where
available, high contrast, reduced motion, RTL, live save status, and explicit clear confirmation.

**Reason:** A web PWA can offer a professional workspace but cannot guarantee device palm rejection
or turn an image-only canvas into inherently accessible document text.

**Consequence:** Product copy makes no perfect palm-rejection claim. Image-only PDFs truthfully state
that text extraction is unavailable. Real stylus/device testing remains required.

## D-086 - No New Distributed Infrastructure for Focus

**Decision:** Keep Focus sync request/response and session events on the existing modular-monolith
and after-commit in-process event architecture.

**Reason:** Current incremental batches and session transitions do not demonstrate a need for a
broker, worker, WebSocket, Redis, Celery, or microservice.

**Consequence:** Collaboration and background document processing are extension points only. Any
future infrastructure proposal must identify a real feature, delivery guarantee, performance
measurement, and operating cost before approval.

## D-087 - Hardened Single-Host Production Baseline

**Decision:** Deploy the modular monolith initially as a non-root Nginx edge, non-root Gunicorn
backend, and private PostgreSQL service with durable static/media/database volumes.

**Reason:** This meets the approved product architecture with the fewest operational failure modes.
The current workload has not demonstrated a need for a distributed cache, worker, broker, or
microservice.

**Consequence:** The database and private media have no public port/path. Multi-host media/object
storage and horizontal scale require measured demand and a separately approved storage design.

## D-088 - Separate Migration Owner and Runtime Database Roles

**Decision:** Only a one-shot release task uses the PostgreSQL owner. Preflight and the application
use a distinct role without schema create, elevated role attributes, or audit mutation.

**Reason:** Migrations need DDL; requests do not. Audit integrity must survive an application bug or
compromise.

**Consequence:** Deployments fail if the roles match or runtime privilege evidence is unsafe. CI and
staging must exercise real PostgreSQL grants; SQLite evidence cannot satisfy this gate.

## D-089 - Fail-Closed Production Boundaries

**Decision:** Production rejects weak/missing secrets, wildcard/HTTP origins, untrusted proxy
headers, non-PostgreSQL storage, fake/unknown payments, public API docs, and non-clean file use.

**Reason:** Development convenience must never become an accidental production default.

**Consequence:** Upload ingestion cannot launch until an approved scanner supplies clean evidence.
The payment route remains unavailable until an approved adapter exists. Secret values live outside
source and may be mounted by file.

## D-090 - Explicit Release and Preflight Gates

**Decision:** Migrations/static collection/grants run in `release`; privilege, migration, file, and
static evidence run in `production_preflight` before backend startup.

**Reason:** Mixing migration authority into every application startup creates races and makes
rollback/release evidence ambiguous.

**Consequence:** Operators retain the one-shot outputs and never bypass a failed preflight. The
backend long-running process has no DDL credential.

## D-091 - Evidence-Based Performance Gates

**Decision:** Add stable query-count and gzip bundle budgets plus bounded load-probe tooling, while
making no 2,000-concurrent-user claim without production-equivalent measurement.

**Reason:** Budgets prevent known regressions; synthetic health traffic cannot prove learning,
assessment, Focus, or commerce capacity.

**Consequence:** Worker/pool/cache/infrastructure changes require representative latency, query,
memory, locking, and error evidence. Correctness remains a hard stop condition.

## D-092 - Verified Coordinated Recovery and Provider-Neutral Observability

**Decision:** Treat a recovery point as database + private media + image/config evidence, verify
restores in isolation, and keep monitoring contracts independent of a vendor.

**Reason:** A database-only backup may reference missing media, and vendor coupling inside business
domains harms portability/testability.

**Consequence:** RPO/RTO are not claimed until drills measure them. Production launch requires
approved metrics/error/log sinks and tested alerts without changing domain code.

## D-093 - Legacy Visual Layer, Current Application Core

**Decision:** Rebuild the legacy visual language as typed React components and an imported legacy
stylesheet on top of the current frontend architecture. The reference frontend remains read-only
and supplies no runtime code, data access, or state management.

**Reason:** The desired outcome is the proven current platform behavior with the original product
appearance, not a rollback to mock data, Supabase, or obsolete routing/security patterns.

**Consequence:** Every migration slice keeps the current Django API, session/CSRF auth, route and
permission boundaries, tests, and PWA behavior. New current-only domains must use the legacy visual
language while remaining owned by their existing feature modules.

## D-094 - One Portable Database Contract

**Decision:** Accept `DATABASE_URL` as the primary database configuration in every environment, and
let explicitly set `POSTGRES_*` values override individual parts of it.

**Reason:** Managed providers and container hosts publish exactly one connection URL, while the
self-hosted deployment needs owner and runtime roles against the same database. One contract with a
defined precedence serves both, so moving between hosts is a configuration change rather than a code
change.

**Consequence:** Production still refuses an incomplete connection or an unstated `sslmode`, and
still rejects `allow`/`prefer` because both silently downgrade to plaintext. The release step keeps
migrating under the owning role by overriding only the credential pair.

## D-095 - Object Storage Behind Authorized Delivery

**Decision:** Store private study material in S3-compatible object storage selected entirely by
`STORAGE_*` environment values, and keep delivering it through the entitlement-checked API rather
than through public or signed bucket URLs.

**Reason:** Container disks are ephemeral and a host volume cannot follow the application across a
migration, so files must leave the application filesystem. Handing out bucket URLs would move the
access decision outside the application, where publication state and clean-scan evidence cannot be
checked.

**Consequence:** Files survive a host migration untouched, and changing provider is a change of
environment values. Because every read is proxied, the read path issues ranged GETs instead of using
the storage library file object, which would otherwise stage a whole object per request. No
deployment may expose a `/media/` route or a public bucket.

## D-096 - Starting the Image Is Part of the Gate

**Decision:** Require CI to build the production image, start it, and prove it drops privileges, passes
release and preflight, and serves a request before any change is considered production-ready.

**Reason:** A green unit suite says nothing about whether the container runs. Every failure this gate
catches — a missing writable path for an unprivileged nginx, an entry point that exits, a preflight
that cannot reach its database — is invisible to the test suite and fatal on deploy.

**Consequence:** The quality gate fails when the runtime job fails, so an image that has never
started cannot ship. The job also exercises the generic S3 backend against MinIO, which proves the
storage path before any provider credential exists.

## D-097 - ClamAV Sets the Hosting Shape

**Decision:** Run Phase 1 on the VPS rather than a managed container host, keeping Supabase and
Cloudflare R2 for managed data and files. If a managed host is later required, use Fly.io.

**Superseded for the initial launch.** Scanning is no longer mandatory in code; it is a stated
configuration, and the launch runs without it because uploads are restricted to trusted
administrators. Without ClamAV the deployment fits a 2 vCPU / 4 GB host, so the sizing below
applies from the day scanning is enabled, not before. See `docs/DEPLOYMENT.md` and
`docs/PRODUCTION_READINESS_HISTORY.md`.

**Reason:** Malware scanning is mandatory and fail-closed, and ClamAV is the largest memory consumer
in the architecture: about 1.6 GB resident and 2.4 GB during its daily reload. On a managed host that
is a separate paid 4 GB instance, which makes managed hosting cost several times the VPS while
delivering less control and still requiring the Phase 2 migration.

**Consequence:** The deployment starts on the architecture it will keep, so there is no second
migration. On 8 GB the scanner needs room: either keep PostgreSQL managed, or build ClamAV with
CLAMAV_CONCURRENT_RELOAD=false. The reasoning and the figures behind it are in docs/HOSTING.md.
