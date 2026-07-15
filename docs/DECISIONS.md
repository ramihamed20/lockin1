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

## Decisions Requiring Later Owner Input

- Subscription price, currency, grace policy, and real payment provider.
- Real curriculum names/content and creator assignments.
- Legal privacy, retention, terms, and account-deletion policy.
- Email and push-notification providers.
- Ranking formula and achievement catalog.
- Additional approved anti-cheating ideas.
- Whether a future multi-institution release needs true tenant isolation.

