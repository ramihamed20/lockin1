# Lock-in Internal Domain Events

Last updated: 2026-07-18

## Purpose

Lock-in is a modular monolith. Important business facts are explicit events so analytics,
notifications, achievements, future recommendations, and later background processing do not force
domains to call one another's internal models.

The Phase 2 event mechanism is deliberately small:

- immutable typed event objects;
- event name and schema version owned by the emitting domain;
- in-process subscribers;
- publication registered with `transaction.on_commit`;
- subscriber isolation in normal runtime and strict failures in unit tests;
- no Redis, Celery, Kafka, RabbitMQ, WebSockets, or separate service.

## Event envelope

Every event carries:

- random event UUID;
- UTC occurrence time;
- stable event name;
- schema version;
- optional actor, correlation, and causation UUIDs;
- domain-specific identifiers and facts.

Events contain identifiers and minimum facts, not ORM objects, passwords, tokens, answer keys, raw
request bodies, or unrestricted personal data.

## Ownership and catalog

| Event | Owning domain | Current state |
|---|---|---|
| `accounts.user_registered` | Accounts | Implemented; emitted after committed registration |
| `accounts.user_email_verified` | Accounts | Implemented; emitted after committed verification |
| `accounts.user_roles_changed` | Accounts | Implemented; emitted after committed role replacement |
| `education.lesson_completed` | Progress/Education integration | Implemented; emitted after committed first completion |
| `focus.session_started` | Focus | Implemented and emitted after commit |
| `focus.session_completed` | Focus | Implemented and emitted after commit |
| `question.published` | Questions | Implemented; exact question/version/node identifiers |
| `quiz.published` | Assessments | Implemented; exact quiz/version/node/mode identifiers |
| `quiz.attempt.started` | Assessments | Implemented after committed attempt snapshot |
| `quiz.attempt.autosaved` | Assessments | Implemented after committed answer revision |
| `quiz.attempt.submitted` | Assessments | Implemented; result plus eligibility facts |
| `assessment.report.created` | Assessments | Implemented; report/result/question/category identifiers |
| `community.discussion.created` | Community | Implemented; discussion author/context/space identifiers |
| `community.reply.created` | Community | Implemented; reply/parent/discussion/context identifiers |
| `community.content.changed` | Community | Implemented; edit/delete/moderation action identifiers |
| `community.space.membership.changed` | Community | Implemented; space/user/action/role identifiers |
| `xp.awarded` | XP | Implemented; transaction/balance facts after idempotent award |
| `streaks.updated` | Streaks | Implemented; policy version and recomputed day totals |
| `achievements.earned` | Achievements | Implemented; exact definition/version/earned-record identifiers |
| `rankings.snapshot_published` | Rankings | Implemented; definition/snapshot/checksum identifiers |
| `notifications.created` | Notifications | Implemented; recipient/category/template identifiers only |
| `subscriptions.subscription_activated` | Subscriptions | Reserved contract; not coded yet |
| `moderation.report.created` | Moderation | Implemented; report/target/reason identifiers |
| `moderation.action.recorded` | Moderation | Implemented; audit/action/target and conflict identifiers |
| `content.content_published` | Content | Implemented; includes object/version/node/type after committed publication |

Remaining reserved events are documented instead of placed in a central fake code catalog. A domain
defines its event only when it implements the authoritative state change. Publication and lesson
completion became real in Phase 4. Question, quiz, attempt, and report events became real in Phase 5
and have domain-owned classes and contract/transaction tests. Assessment events contain no answer
key, explanation, option text, session token, or unrestricted metadata.

Community and moderation events became real in Phase 6. They contain identifiers and bounded action
or reason facts; immutable evidence remains inside the permission-protected moderation record.

Phase 7 adds `apps.motivation_integrations` as a stateless subscriber composition root. It consumes
existing account, lesson, Focus, assessment, community, and moderation facts and calls the public
service boundary of the owning XP, achievement, ranking, streak, or notification domain. Source
domains do not import those consumers.

| Source event | Current Phase 7 consumers |
|---|---|
| `accounts.user_email_verified` | In-app account notification |
| `education.lesson_completed` | XP, streak, achievement evidence |
| `focus.session_completed` | Bounded XP, streak, focus achievement evidence |
| `quiz.attempt.submitted` | Eligibility-aware XP, ranking fact, achievement and streak evidence |
| `community.discussion.created` | First contextual-contribution achievement evidence only |
| `community.reply.created` | Recipient in-app reply notification |
| `moderation.action.recorded` | Report owner in-app moderator-action notification |
| `achievements.earned` | Achievement notification |
| `xp.awarded` | Ranking fact only when the award is ranking eligible |

## Transaction behavior

Domain state changes occur first inside a database transaction. The event is dispatched only after
that transaction commits. A rolled-back transaction emits nothing.

The current bus is not durable. If the process exits after the commit but before a subscriber
finishes, the subscriber work can be lost. Therefore subscribers in this phase may enrich
best-effort process behavior but must not be the only record of authoritative grading, progress,
billing, or audit state.

Phase 7's durable effects are idempotent and recoverable. The `rebuild_motivation` management
command scans committed authoritative source records, replays missing evidence/notifications, and
rebuilds XP balances, streaks, achievement progress, ranking facts, and unread counters. It does not
regrade assessments or rewrite source-domain history.

## When durability is justified

A transactional outbox and background delivery may be proposed later only when a real subscriber
requires retry/delivery guarantees. The proposal must identify the event, delivery guarantee,
idempotency key, retry/dead-letter behavior, measured request impact, and operating cost. That
proposal comes before any queue or broker is added.

## Subscriber rules

- Subscribe through a domain integration module, not module import side effects hidden in models.
- Treat each event handler as idempotent when it creates durable data.
- Recheck permissions when creating user-visible targets such as notification links.
- Do not let a best-effort subscriber roll back an already committed domain transaction.
- Use event ID or a domain deduplication key when duplicate effects matter.
- Add contract, transaction, and duplicate-delivery tests for every durable subscriber.
