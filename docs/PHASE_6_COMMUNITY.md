# Phase 6 — Contextual Learning Community and Moderation

Last updated: 2026-07-17

Status: implemented and locally validated; awaiting owner review

## Outcome

Phase 6 adds a learning-context community, not a generic social network. A public discussion must
belong to a discoverable lesson, published learning object, published question, or published quiz.
Creator spaces are private, invitation-only, and bound to one of the same learning contexts.

The implemented journey is:

```text
Learning context -> Discussion -> Reply -> Report -> Evidence-preserving review -> Learning context
```

Standalone status posts, follower graphs, engagement feeds, direct messages, and reactions were not
added because they do not yet demonstrate a learning benefit.

## Backend Boundaries

`apps.community` owns:

- learning-context resolution and snapshots;
- public contextual discussions and one-level replies;
- optimistic revisions, idempotent writes, duplicate suppression, and soft-delete tombstones;
- contextual creator spaces, membership roles, revocation, and append-only membership history;
- database-backed discussion/comment/edit rate buckets;
- bounded cursor feeds and query-efficient author/role projections;
- reversible moderator remove/restore and discussion lock/unlock actions.

`apps.moderation` owns:

- reports for discussions, comments, questions, answer keys, explanations, and learning objects;
- immutable evidence snapshots captured at report creation;
- spam, abuse, duplicate, incorrect-question, incorrect-answer, and incorrect-explanation reasons;
- assignment, triage, investigation, resolution, rejection, and duplicate transitions;
- optimistic revision conflicts and server-authoritative transition validation;
- append-only audit entries and moderator-action events;
- strict private-space evidence isolation and conflict-of-interest checks.

The existing assessment issue-report endpoint remains backward compatible. It now creates the
central moderation record in the same transaction, so clients do not need an API migration while
the moderation domain becomes authoritative for review workflow.

## Privacy, Fairness, and Security Invariants

- Report evidence is never returned by the student serializer.
- A global moderator cannot discover or inspect a private creator-space report unless they are an
  active moderator of that space; administrators retain platform-wide authority.
- Reporters and target authors cannot adjudicate their own case.
- Non-administrative moderators may claim a report only for themselves.
- Creator-space membership is checked before email/user lookup to prevent account enumeration.
- Community text is stored and returned as text; the React client does not inject it as HTML.
- Every unsafe request continues to use the existing HttpOnly session and CSRF architecture.
- Deletes are tombstones and moderation evidence is snapshotted, preserving audit/dispute history.
- Django Admin exposes reports, revisions, and history records as read-only; workflow mutation must
  pass through the domain services that create revision/audit entries.
- Server transitions, revisions, permissions, idempotency keys, and rate limits are authoritative.

## Events and Notifications Boundary

Community and moderation publish typed facts only after transaction commit:

- `community.discussion.created`
- `community.reply.created`
- `community.content.changed`
- `community.space.membership.changed`
- `moderation.report.created`
- `moderation.action.recorded`

No notification model or delivery channel is implemented in Phase 6. Phase 7 may subscribe to these
events through an integration module; community and moderation do not import a notification domain.
The current bus remains lightweight, synchronous, in-process, best-effort, and broker-free.

## Frontend Experience

- `/community` is a contextual activity feed and deliberately has no standalone post composer.
- Context routes open a composer only after a valid learning object is known.
- Lesson, learning-object, quiz, and result/question surfaces link directly to their discussion.
- Discussion detail keeps replies, one-level response context, edit/delete state, and reporting in
  one reading sequence.
- Creator spaces expose their educational context and invite by email without a global user search.
- Moderation provides queue filters, immutable evidence, assignment/transition controls, and audit
  history to authorized moderators, creators for their spaces, and administrators.
- English and Arabic share one logical-property component tree. Desktop and mobile layouts preserve
  headings, landmarks, visible focus, reduced motion, status/error states, and no horizontal overflow.

## Performance Posture

- Public and private feeds use stable cursor pagination.
- Indexes align with context/status/activity, space/status/activity, author/status, duplicate digest,
  membership scope, moderation status/priority, assignment, target, reporter, and private space.
- Selectors use `select_related`/`prefetch_related`; automated query-budget tests cover discussion
  and moderation feeds as the number of authors/reports grows.
- Role checks are cached on the request user during serialization to prevent per-card group queries.
- The PWA still precaches static build assets only and does not cache `/api/v1` responses.

PostgreSQL concurrency and representative-volume load evidence remain deferred because this
workstation has no PostgreSQL/Docker service. No 2,000-user performance claim is made from SQLite.

## Skills Applied

| Skill | Phase 6 use |
|---|---|
| `impeccable` | Context-first hierarchy, calm discussion reading, moderation states, mobile/RTL/accessibility review |
| `design-system` | Reused primitive, semantic, and component tokens; no parallel social theme |
| `security-best-practices` | Evidence privacy, account-enumeration prevention, permission ordering, CSRF, conflict-of-interest, and safe text rendering |
| `playwright` | Desktop/mobile workflows, Arabic RTL, Axe, focus/landmarks, and horizontal-overflow validation |

No additional relevant Skill was discovered or used during Phase 6. No dedicated installed Skill was
available for Django, DRF, PostgreSQL, PWA, or load testing; the documented engineering and validation
fallback remains in effect.

## Validation Evidence

- Backend: 119 tests passed; branch-aware total coverage 85.62% (required minimum 85%).
- Backend static checks: Ruff format/check, strict mypy across 176 source files, migration drift, and
  Django system check passed.
- Frontend: 106 tests passed; 89.71% statements, 80.07% branches, 86.40% functions, 93.72% lines.
- Frontend static/build: ESLint, TypeScript, and production PWA build passed.
- Browser regression: 19 passed and 1 intentional desktop skip for a mobile-only assertion.
- Phase 6 browser slice: community, discussion/report, and moderation flows passed on Desktop Chrome
  and Pixel 7, including Axe, Arabic RTL, and overflow checks.
- Production PWA: 32 static precache entries, no private API runtime cache; main JavaScript 100.36 KB
  gzip and CSS 9.96 KB gzip.

## Explicitly Not Added

- No generic posts, follower graph, engagement ranking, reactions, direct messages, or study groups.
- No notification center or delivery provider; event contracts are ready for Phase 7 subscribers.
- No achievements, rankings, or subscription feature.
- No Focus renderer, annotation, toolbar, gesture, autosave, or storage coupling.
- No AI provider or feature.
- No Redis, Celery, WebSockets, broker, microservice, or background worker.

## Phase Boundary

Stop after the Phase 6 commit. Do not begin Phase 7 until the owner explicitly approves it.
