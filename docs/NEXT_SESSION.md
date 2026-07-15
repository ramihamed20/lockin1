# Lock-in Next Session

Last updated: 2026-07-15

## Start Here

The rebuild project is documentation-only after Phase 1. Do not assume Phase 2 is approved unless the owner explicitly approves it in the conversation.

Read these files in order:

1. PRODUCT.md
2. DECISIONS.md
3. ARCHITECTURE.md
4. PROJECT_AUDIT.md
5. PROGRESS.md
6. TODO.md
7. CHANGELOG.md

## Current Paths

- Rebuild: C:\Users\ramih\Desktop\Dentify-Rebuild
- Read-only reference: C:\Users\ramih\Desktop\Dentify-Before-Edits

Never modify the read-only reference.

## Current Decisions

- Product name: Lock-in.
- Frontend: React, TypeScript, Vite, PWA.
- Backend: Django and Django REST Framework.
- Database: PostgreSQL.
- Architecture: modular monolith.
- Web authentication direction: Django session cookie plus CSRF.
- Accessibility target: WCAG 2.2 AA.
- Launch assumption: one institution, future-ready hierarchy.
- No Redis, Celery, WebSockets, microservices, or real payment provider without prior justification and approval.

## Phase 1 Result

PRODUCT.md contains 22 feature specifications. Each identifies roles, user story, permissions, expected behavior, edge cases, acceptance criteria, and required tests. Important unknowns are resolved through documented assumptions or deferred configuration.

No runnable application exists yet.

## If Phase 2 Is Approved

Before making changes:

1. Re-read the applicable Skills and announce how they apply.
2. Verify current supported Django, DRF, React, TypeScript, Vite, PostgreSQL, and testing-tool versions using official sources.
3. Explain the Phase 2 foundation plan in simple language.
4. List expected files and directories.
5. Keep feature implementation out of Phase 2.

Expected Phase 2 scope:

- backend/frontend scaffold;
- PostgreSQL development configuration;
- safe settings and environment example;
- formatting, linting, typecheck, and tests;
- simple reproducible start/stop workflow;
- CI baseline where hosting is available;
- logging and health/readiness;
- foundation documentation and tests.

## Stop Condition

After Phase 2 foundation starts and passes its agreed tests, update all source-of-truth documents, summarize the decisions, create the phase commit, and stop for review. Do not continue to authentication/design-system feature work without Phase 3 approval.

