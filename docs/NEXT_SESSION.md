# Lock-in Next Session

Last updated: 2026-07-18

## Start Here

Phase 7 is implemented and locally validated. Do not begin Phase 8 unless the owner explicitly
approves it in the conversation.

Read in order:

1. `PRODUCT.md`
2. `PHASE_7_MOTIVATION.md`
3. `DECISIONS.md`
4. `ARCHITECTURE.md`
5. `EVENTS.md`
6. `DESIGN.md`
7. `PHASE_6_COMMUNITY.md`
8. `PHASE_5_ASSESSMENTS.md`
9. `FOCUS_MODE.md`
10. `AI_EXTENSION_POINTS.md`
11. `PROGRESS.md`
12. `TODO.md`
13. `CHANGELOG.md`

## Paths

- Rebuild: `C:\Users\ramih\Desktop\Dentify-Rebuild`
- Read-only reference: `C:\Users\ramih\Desktop\Dentify-Before-Edits`
- Phase 7 isolated validation copy: `C:\tmp\Lockin-Rebuild-Phase7`

Never modify the read-only reference.

## Current Implementation

- Branch: `codex/phase-7-motivation-system`.
- Frontend: React 19.2.7, TypeScript 6.0.3, Vite 7.3.6, static-only PWA cache.
- Backend: Django 5.2.16 LTS, DRF 3.17.1, modular monolith.
- Database: PostgreSQL default; SQLite only behind `LOCKIN_TEST_USE_SQLITE=true` for local tests.
- Motivation domains: XP, Achievements, Rankings, Streaks, Notifications; no combined gamification app.
- Integration: stateless event subscribers plus `rebuild_motivation` reconciliation.
- XP: idempotent ledger, server-owned balance, eligibility metadata, deterministic rebuild.
- Achievements: versioned catalog/evidence/progress/unique earned state; five meaningful seeded rules.
- Rankings: eligible facts, deterministic audited snapshots, tie strategy, checksum, privacy profile.
- Streaks: versioned qualifying policy, daily evidence, out-of-order recomputation, future rule fields.
- Notifications: recipient ownership, unread counter, safe target, deduplication, preferences, future
  email/push channel records marked unavailable.
- Frontend: lazy `/progression` and `/notifications` routes; accessible English/Arabic mobile-first UI.
- Focus: independent; only the completed-session event crosses the integration boundary.
- AI: no package/provider/endpoint; extension ports only.
- Excluded: subscriptions/payments, real email/push, engagement grinding, freeze/grace implementation,
  Redis, Celery, WebSockets, broker, microservices, and background workers.

## Validation Snapshot

- Backend: 131 tests, 85.90% branch-aware coverage; Ruff/mypy/migration checks passed.
- Frontend: 116 tests; 90.19% statements, 80.10% branches, 87.14% functions, 94.13% lines.
- Browser: 23 Playwright passes and 1 intentional desktop skip; Phase 7 desktop/mobile slice passed
  Axe, Arabic RTL, landmark/focus, and overflow checks.
- PWA: 34 static precache entries, no API runtime cache; main JS 102.67 KB gzip, CSS 11.44 KB gzip.
- PostgreSQL concurrency/load: not run locally; no evidence claim.

## Review Focus

1. Confirm the five domain boundaries and absence of a catch-all gamification module.
2. Review award eligibility, caps, idempotency, audit, and anti-grind behavior.
3. Review achievement catalog/versioning and unique award guarantees.
4. Review streak policy extension fields without unapproved freeze/grace behavior.
5. Review ranking determinism, ties, failure audit, privacy, freshness, and rebuild path.
6. Review notification ownership, safe target permission recheck, counters, and required preferences.
7. Confirm reconciliation is sufficient for the current lightweight event bus.
8. Confirm Focus, AI, infrastructure, and Phase 8 subscription boundaries remain intact.

## Stop Condition

Stop after the Phase 7 commit and wait for owner approval.
