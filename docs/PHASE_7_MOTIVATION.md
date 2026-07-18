# Phase 7 — Learning Motivation and Notifications

Last updated: 2026-07-18
Status: implementation and local validation complete; awaiting owner review

## Outcome

Phase 7 connects meaningful learning evidence to long-term motivation without creating a generic
gamification module. Achievement, XP, ranking, streak, and notification responsibilities are five
independent backend domains. Existing learning domains publish facts; the integration boundary
consumes them. The browser only presents server-authoritative state.

## Domain Ownership

| Domain | Owns | Does not own |
|---|---|---|
| XP | Append-oriented transactions, balances, award idempotency, rebuild | Learning completion or assessment grading |
| Achievements | Versioned definitions, evidence, progress, unique earned records | Source-domain eligibility decisions |
| Rankings | Eligible facts, privacy profiles, deterministic snapshots, audit/checksum | Live activity scoring or client-computed rank |
| Streaks | Versioned policy, qualifying-day evidence, projections, recomputation | Assessment, lesson, or Focus state |
| Notifications | User records, preferences, unread counters, safe targets, delivery records | Community/moderation workflow or channel providers |
| Motivation integrations | Event subscriptions and reconciliation only | Business state or public API |

No source domain imports a motivation engine. `apps.motivation_integrations` is the only subscriber
composition root and stores no business state.

## Evidence and Rules

- A first lesson completion awards 50 XP, qualifies the learning-day streak, and advances the first
  meaningful milestone.
- An eligible passed assessment awards mode-specific XP: practice 30, quiz 60, mastery 120. Ranking
  and achievement evidence respect the assessment's authoritative eligibility flags.
- A completed Focus session qualifies a streak at 20 minutes. At 25 minutes it earns bounded XP in
  25-minute blocks, capped at 80 XP per session; achievement evidence is capped at 120 minutes per
  session. Focus remains an independent product module.
- Community creates no repeatable XP. The first contextual discussion may advance a meaningful
  contribution milestone; reactions and raw posting volume do not count.
- Every durable effect has a source identity/idempotency key. Duplicate event delivery cannot
  duplicate XP, evidence, achievement awards, ranking facts, or notifications.

The initial reviewed achievement catalog contains First step, Mastery proven, Deep focus, Steady
week, and Helpful voice. Definitions and criteria are versioned so later rule changes never silently
reinterpret an earned record.

## Deterministic and Auditable Rankings

The initial global all-time learning ranking consumes only ranking-eligible XP evidence. Snapshot
generation is deterministic, uses an explicit tie policy, stores participant evidence counts,
rules, generation time, checksum, and status, and persists failed calculations for audit. Published
views read snapshots rather than calculating a global leaderboard per request.

Students control inclusion and display mode (`full_name`, `initials`, or `anonymous`). Ranking state
is rebuildable from its authoritative evidence ledger, and the browser cannot submit points or rank.

## Streak Policy

Streak evidence is recorded by qualifying local calendar day and recomputed deterministically even
when events arrive out of order. The active policy is versioned and already has explicit extension
fields for qualifying activity types, timezone, grace days, freeze-token behavior, and recovery
rules. Current Phase 7 behavior does not invent freeze tokens, grace, or recovery; those values stay
disabled until product rules are approved.

## Notification Safety

- Notification ownership is always scoped to the authenticated recipient.
- Required account/security preferences cannot be disabled.
- Optional in-app categories can be changed by the user; email and push are modeled as unavailable
  future channels and have no provider or delivery claim.
- Deduplication keys prevent repeated events from creating repeated messages.
- Opening a notification resolves an allowlisted same-origin application route and rechecks current
  permission for contextual discussion targets. Deleted or unauthorized destinations return an
  honest unavailable state.
- Unread counters update under a consistent database lock order to avoid lost concurrent updates.
- Authorized administrators may create bounded platform notices; users cannot create XP,
  achievements, ranking snapshots, streak evidence, or private notifications.

## Event and Recovery Model

The existing event bus remains synchronous, in-process, after-commit, and lightweight. New events
are `xp.awarded`, `streaks.updated`, `achievements.earned`, `rankings.snapshot_published`, and
`notifications.created`.

Because the bus is intentionally not durable, `rebuild_motivation` reconciles committed source
records into missing evidence and rebuilds balances, streak projections, achievement progress,
notification counters, and ranking facts. This is the recovery path for process interruption; no
Redis, Celery, queue, broker, WebSocket, microservice, or background worker was added.

## Product and Interface Design

The new `/progression` route presents learning momentum, what qualifies, milestone progress, a
published ranking snapshot, and ranking privacy in one calm flow. It deliberately avoids a badge
wall, confetti, urgency pressure, or activity-volume leaderboard. The new `/notifications` route is
a quiet action center with read state, safe destinations, preferences, loading, empty, error, and
unavailable-target states.

Material redesign reasons:

| Redesign | Why it is better |
|---|---|
| “Learning momentum” instead of “Gamification” | Frames the system around study evidence rather than point collection |
| “What counts” beside XP and streak | Makes rules understandable and discourages meaningless grinding |
| Progress milestones before ranking | Keeps personal mastery primary and competition secondary |
| Snapshot freshness and rule disclosure | Makes rank deterministic, explainable, and auditable |
| Ranking inclusion/name privacy on the same surface | Gives students control before exposing them to peers |
| One quiet notification center | Keeps useful learning actions visible without engagement noise |

The UI uses the existing primitive → semantic → component tokens, logical CSS properties, one
English/Arabic component tree, keyboard-operable native controls, visible focus, reduced-motion
behavior, mobile/tablet adaptation, and lazy route chunks. The main JavaScript bundle remains
102.67 KB gzip; progression and notification routes are separate 1.95 KB and 1.54 KB gzip chunks.

## Skills Used

| Skill | Phase 7 use | Why selected |
|---|---|---|
| `impeccable` | Motivation/notification information architecture, calm hierarchy, responsive/RTL/accessibility review | Most complete installed frontend product-quality skill |
| `design-system` | Existing token hierarchy, component states, spacing, contrast, and reuse | Best match for systematic consistency rather than one-off styling |
| `security-best-practices` | Server authority, deduplication, ownership, safe routes, privacy, locks, and API hardening | Direct Python/TypeScript secure-by-default guidance |
| `playwright` | Real desktop/mobile browser, Axe, RTL, overflow, and workflow checks | Best available real-browser E2E skill |

No additional relevant Skill was discovered during Phase 7, so the approved Skill set remained
unchanged. Security guidance caused concrete hardening of notification targets/counters and ranking
failure audit state. Browser/design review found and corrected muted metadata contrast before final
validation.

## Validation Evidence

- Backend: 131 tests passed; 85.90% branch-aware coverage (85% gate passed).
- Backend quality: Ruff passed; strict mypy passed across 234 source files; no migration drift.
- Frontend: 116 tests passed; 90.19% statements, 80.10% branches, 87.14% functions, 94.13% lines.
- Frontend quality: ESLint, TypeScript, and production Vite/PWA build passed.
- Browser: 23 Playwright tests passed and one intentional mobile-only desktop skip; Phase 7 passed
  Axe, English/Arabic RTL, keyboard/landmark, responsive, and horizontal-overflow checks on desktop
  and mobile Chromium.
- PWA: 34 static precache entries; private `/api/v1` responses remain outside runtime caching.

PostgreSQL concurrency and representative 2,000-active-user load tests were not run on this
workstation because no local PostgreSQL/Docker service was available. Local tests explicitly used
the SQLite test fallback. No PostgreSQL concurrency, load, email, push, or scheduled-delivery claim
is made.

## Explicit Exclusions

- No subscription/payment implementation (Phase 8).
- No email or push provider and no delivery worker.
- No reaction/popularity XP, follower ranking, random rewards, or repeatable grind loop.
- No freeze-token/grace/recovery behavior beyond versioned policy extension fields.
- No Focus workspace implementation change, AI feature/provider, Redis, Celery, queue, broker,
  WebSocket, microservice, or speculative infrastructure.

Stop after Phase 7. Do not begin Phase 8 without explicit owner approval.
