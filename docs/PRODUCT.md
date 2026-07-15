# Lock-in Product Specification

Status: Phase 1 specification  
Product owner: Platform administrator  
Last updated: 2026-07-15

## Register

product

## Product Identity

Lock-in is a university learning platform designed for focused, structured study on phones, tablets, and desktop browsers. The rebuilt application preserves the recognizable dark identity, gold and purple accent family, mascot, premium atmosphere, and study-first tone of the reference application without copying its screens or implementation.

The interface is a tool. Visual choices must help students understand what to do next, reduce mistakes during high-stakes quiz flows, and make management work efficient for moderators, creators, and administrators.

## Users

### Student

University students primarily using phones and tablets to find educational material, resume study, answer questions, complete timed quizzes, review mistakes, participate in the community, and track progress.

### Moderator

A trusted student-level user with limited additional authority to review reports, moderate public community content, correct confirmed question errors, and inspect their own moderation history. A moderator is not an administrator.

### Content Creator

A normal user with configurable publishing authority for assigned educational areas. Creators manage drafts, authorized files, content status, and their private creator space without automatically gaining public-community moderation powers.

### Administrator

The platform owner or delegated operator with full control over users, roles, education structure, content, quizzes, community, reports, subscriptions, configuration, analytics, audit records, and system status.

## Product Purpose

Lock-in exists to give university students one reliable place to:

- find the correct material quickly;
- study documents and media comfortably on mobile devices;
- practice and complete quizzes without losing answers;
- understand results and resume weak areas;
- communicate in moderated academic communities;
- see progress, achievements, notifications, and subscription status;
- trust that roles, scores, files, and account data are handled correctly.

Product success means students can complete the core study loop with little instruction:

1. open Lock-in;
2. see the next useful action;
3. reach the relevant lesson or quiz;
4. study or answer safely;
5. receive clear feedback;
6. resume later without lost progress.

## Brand Personality

Focused, trustworthy, premium.

The tone is encouraging and calm rather than childish, competitive to the point of stress, or institutionally cold. The mascot can add warmth at meaningful moments such as onboarding, empty states, recovery, and achievements, but must not distract during reading or timed quizzes.

## Anti-references

Lock-in must not become:

- a pixel-for-pixel copy of the current prototype;
- a wall of identical glass cards;
- a desktop admin table squeezed onto a phone;
- a game-like interface that obscures academic progress;
- a dashboard where every metric competes for attention;
- a collection of decorative animations that delay the task;
- an interface that invents unfamiliar controls where standard controls are clearer;
- an Arabic translation layered onto a left-to-right layout;
- an offline experience that appears to save or submit data when it has not;
- a role-based UI that relies on hidden buttons instead of backend permissions.

## Design Principles

### Next action first

Every student surface should make the next meaningful study action obvious. Supporting metrics remain available but must not dominate continuation, deadlines, due review, or an active quiz.

### Calm under pressure

Quiz, password, subscription, upload, and moderation flows must use clear status, recovery, and confirmation language. The interface must not create uncertainty about whether work was saved or submitted.

### Familiar controls, distinct identity

Navigation, forms, dialogs, tables, menus, and feedback use familiar interaction patterns. Lock-in’s identity comes from its atmosphere, voice, mascot, and deliberate accent use rather than unusual controls.

### Mobile is a complete product

Phone and tablet users must be able to study, take quizzes, moderate reports, and manage content without falling back to a desktop-only workflow.

### Evidence over claims

Performance, concurrency, accessibility, security, and reliability claims require automated or measured evidence. A locally working feature is not evidence of production readiness.

## Accessibility and Inclusion

The release target is WCAG 2.2 AA for all supported user and management flows.

Required principles:

- semantic landmarks, headings, labels, and native controls wherever possible;
- full keyboard operation and visible focus;
- no disabled page zoom;
- correct document language and direction for English and Arabic;
- text contrast of at least 4.5:1 and large-text/UI contrast as required by WCAG;
- status messages that do not rely on color alone;
- reduced-motion support for all non-essential motion;
- touch targets sized and spaced for phone use;
- screen-reader names for icon-only actions;
- focus trapping and restoration for true modal dialogs;
- accessible tables or equivalent mobile list/detail views;
- captions/transcripts as future media metadata fields, with visible availability state;
- content remains usable at 200% zoom and narrow reflow without two-dimensional page scrolling, except where an inherently two-dimensional canvas or document requires controlled panning.

## Scope and Release Boundaries

### Included in the rebuild

- React, TypeScript, Vite, and PWA frontend.
- Django and Django REST Framework backend.
- PostgreSQL as the primary development and production database.
- Stable versioned API suitable for a future native mobile application.
- Student, moderator, content creator, and administrator roles.
- Education hierarchy, managed content, files, questions, quizzes, progress, community, moderation, rankings, achievements, notifications, subscriptions, analytics, and audit history.

### Explicitly excluded until justified

- Redis.
- Celery or another job queue.
- WebSockets and real-time chat.
- Microservices.
- A real payment provider.
- Invasive anti-cheating surveillance.
- Native mobile applications.
- Production deployment or service purchase without owner approval.

## Role and Permission Baseline

Users may hold more than one additional role. Student capability is the baseline for all normal accounts.

| Capability | Student | Moderator | Creator | Administrator |
|---|---:|---:|---:|---:|
| Study published permitted content | Yes | Yes | Yes | Yes |
| Manage own profile | Yes | Yes | Yes | Yes |
| Post in public community | Yes | Yes | Yes | Yes |
| Moderate public community | No | Yes | Only with separate moderator role | Yes |
| Manage assigned educational content | No | Only confirmed question correction within policy | Yes, within assigned scope | Yes |
| Manage own creator space | No | Only where assigned/permitted | Yes | Yes |
| Review reports | No | Yes, within assigned scope | No unless separately permitted | Yes |
| Manage roles, subscriptions, configuration | No | No | No | Yes |
| View full audit and system status | No | Own/relevant moderation history only | Own content history only | Yes |

All permission decisions are enforced by the backend. Frontend role checks only control presentation.

## Feature Specifications

### F-01 Application Shell, Navigation, Language, and RTL

**Roles:** Visitor and every authenticated role.

**User story:** As a user, I want predictable navigation in my preferred interface language so I can move through Lock-in without relearning the layout on each device.

**Permissions:** Public authentication/help routes are available to visitors. Authenticated routes require an active account and apply role and subscription access rules.

**Expected behavior:**

- English is the default interface language; Arabic is available globally.
- Interface copy comes from translation catalogs. Educational content and questions remain in their stored language.
- The document language and direction change with the selected interface locale.
- Phone navigation prioritizes the most frequent student tasks and exposes remaining areas through an accessible menu.
- Tablet and desktop layouts may use a persistent side navigation when space allows.
- Role-specific navigation shows only relevant management areas.
- Current location, page title, loading state, errors, and unsaved state are clear.

**Edge cases:**

- Mixed Arabic interface and English educational material.
- Long translated labels.
- A user with both moderator and creator roles.
- Direct navigation to an unauthorized or missing route.
- 320 px viewport, 200% zoom, landscape phone, and split-screen tablet.

**Acceptance criteria:**

- No hardcoded duplicate English/Arabic strings in feature components.
- HTML language and direction match the selected interface locale.
- Navigation is keyboard and screen-reader operable.
- Unauthorized links are absent from navigation and unauthorized API access is still rejected.
- Core routes reflow without accidental horizontal page scrolling.
- Route transitions announce loading and page changes appropriately.

**Required tests:** Translation key checks, locale persistence unit tests, component accessibility tests, permission-aware navigation tests, and Playwright flows in English/Arabic at phone, tablet, and desktop sizes.

### F-02 Registration, Email Verification, Login, Session, and Logout

**Roles:** Visitor, student, and administrator for account intervention.

**User story:** As a student, I want to create and access my account securely without exposing my session or receiving confusing authentication errors.

**Permissions:** Public registration creates a student account only. Public clients cannot choose roles. Administrators may suspend, reactivate, or delete accounts according to policy.

**Expected behavior:**

- Registration requires full name, email, password, password confirmation, preferred interface language, and required policy acceptance.
- Email is normalized and unique case-insensitively.
- New public accounts receive the student baseline role.
- Email verification is required before full protected access.
- Authentication uses a server-managed HttpOnly session cookie and CSRF protection; no session identifier is stored in Web Storage.
- “Remember me,” if offered, changes only the documented session duration.
- Login and reset messages avoid revealing whether an account exists.
- Logout invalidates the active session; “log out all sessions” is available from account security.
- Suspended and deleted accounts cannot authenticate.

**Edge cases:**

- Duplicate or differently cased email.
- Expired/reused verification link.
- Lost network after submitting registration.
- Unverified, suspended, expired-subscription, or deleted account.
- Repeated failed login attempts.
- Session expiry while the user is editing or taking a quiz.

**Acceptance criteria:**

- Role fields from public registration payloads are ignored/rejected.
- Passwords use Django’s password APIs and configured validators.
- Verification and reset tokens are single-use and time-limited.
- Authentication responses are rate-limited and do not leak account existence.
- Session cookies have deliberate HttpOnly, SameSite, and production Secure settings.
- State-changing cookie-authenticated requests require a valid CSRF token.

**Required tests:** Registration, normalization, duplicate email, verification, login/logout, session expiry, suspended user, brute-force/rate-limit, CSRF, cookie settings, and negative role-injection tests.

### F-03 Password Recovery, Profile, and Account Security

**Roles:** Authenticated users; administrator for account management.

**User story:** As a user, I want to recover access and maintain my personal information without losing progress or accidentally weakening account security.

**Permissions:** Users edit only their own profile and security settings. Administrators manage accounts through audited privileged actions.

**Expected behavior:**

- Password recovery sends a generic response and a time-limited single-use reset link.
- Password change requires the current password unless using a valid reset flow.
- Email changes require verification of the new address.
- Profile exposes name, academic placement where configured, language, avatar/mascot preference if supported, notification preferences, and subscription summary.
- Account security lists active sessions at a useful device/time level without exposing tokens.
- Account deletion is a request/confirmation flow until legal retention rules are finalized.

**Edge cases:**

- Expired reset token, repeated reset request, already used link.
- Email change to an existing account.
- A role badge changing while a profile page is open.
- User requests deletion while holding creator-owned content or open moderation work.

**Acceptance criteria:**

- Reset and email-change tokens cannot be replayed.
- Password change invalidates other sessions by default or clearly offers the choice.
- Users cannot modify role, subscription state, audit fields, or another profile.
- Privileged account changes are audited.

**Required tests:** Reset lifecycle, replay prevention, password change, session invalidation, email re-verification, profile ownership, protected fields, and audited administrator actions.

### F-04 Roles, Permission Assignments, and Account Status

**Roles:** All roles; administrator manages assignments.

**User story:** As an administrator, I want centralized, understandable permissions so trusted users receive only the authority they need.

**Permissions:** Only administrators assign or revoke moderator/creator roles and creator scopes. No client-supplied role is trusted.

**Expected behavior:**

- Student is the baseline role.
- Moderator and creator capabilities are additive and may coexist.
- Creator permissions are scoped to assigned hierarchy nodes and allowed content actions.
- Moderator permissions are scoped to report/community/question-correction responsibilities.
- Account status is separate from role: active, suspended, or deleted.
- Every privileged action checks both global permission and object scope.

**Edge cases:**

- Role revoked during an open management session.
- Creator content remains after creator role removal.
- Moderator assigned to a report then suspended.
- Last administrator attempts to remove their own administrator access.

**Acceptance criteria:**

- Permissions are defined centrally through Django permissions/groups plus explicit object policy services.
- Every privileged endpoint has allow and deny tests.
- Role changes take effect on the next request and are audited.
- The final active administrator cannot accidentally remove the only recovery path.

**Required tests:** Full permission matrix, mixed-role user, object scope, role revocation, suspended account, last-admin protection, and direct API access without UI.

### F-05 Role-Appropriate Dashboards

**Roles:** Student, moderator, creator, administrator.

**User story:** As a user, I want my home page to prioritize the tasks associated with my role instead of showing a generic collection of metrics.

**Permissions:** Dashboard data is filtered by user, role, assignment, and object scope.

**Expected behavior:**

- Student: continue study, due review, subjects, recent content, active/upcoming quizzes, progress summary, ranking/achievement highlights, notifications, subscription status.
- Moderator: report queue, flagged content, question corrections, recent actions, and limited tools.
- Creator: drafts, uploads, publication status, assigned content, private space, and relevant engagement summaries.
- Administrator: users, roles, content, quizzes, community, reports, subscriptions, notifications, rankings, analytics, audit, configuration, and system-health summaries.
- The first screen emphasizes urgent/next actions; secondary metrics use progressive disclosure.
- Loading uses structural skeletons, not blank pages or central spinners.

**Edge cases:**

- New user with no data.
- User with multiple roles.
- Partial API failure for one dashboard panel.
- Expired subscription.
- Empty moderation or creator queues.

**Acceptance criteria:**

- Each dashboard has a useful empty state and partial-error recovery.
- Phone dashboards avoid desktop-sized tables.
- A panel failure does not erase unrelated successful panels.
- Dashboard values derive from authoritative data and link to their source detail.

**Required tests:** Per-role rendering, empty/loading/error states, mixed-role navigation, subscription gating, API permission tests, and phone/tablet/desktop E2E.

### F-06 University Education Hierarchy

**Roles:** Student browses; creator manages assigned nodes; administrator manages all.

**User story:** As a student, I want content organized according to my academic path so I can find the correct subject and lesson.

**Permissions:** Published nodes are visible according to access rules. Creators may manage only assigned nodes. Administrators manage the complete hierarchy.

**Expected behavior:**

- The launch model supports institution, faculty/college, department, academic year, semester, subject, unit/chapter, and lesson.
- The hierarchy is modeled flexibly enough to omit or add levels without hardcoding page routes to one university structure.
- Nodes support ordering, active/archive state, titles, slugs, and localized interface labels where needed.
- Launch assumes one institution, while the model remains ready for multiple institutions without claiming tenant isolation.

**Edge cases:**

- Institution omits a department or semester level.
- Node is moved with descendants.
- Attempt to create a cycle.
- Node is archived while it has published content or active quizzes.
- Duplicate names under different parents.

**Acceptance criteria:**

- Cycles are impossible.
- Sibling ordering and path generation are deterministic.
- Archiving hides future discovery without deleting historical attempts/progress.
- Permission checks follow hierarchy scope.
- Frequently browsed hierarchy queries are indexed and do not create N+1 access.

**Required tests:** Tree integrity, cycle prevention, ordering, archive behavior, scoped creator permissions, duplicate names, path lookup, and query-count tests.

### F-07 Content Lifecycle and Creator Workflow

**Roles:** Student consumes; creator manages assigned content; moderator may correct confirmed questions; administrator manages all.

**User story:** As a creator, I want a clear draft-to-publish workflow so students only see reviewed, authorized material.

**Permissions:** Creator actions are configurable by scope and action. Only authorized publishers or administrators publish/archive. Public students see only published and permitted content.

**Expected behavior:**

- Content states: draft, in review, published, archived, and rejected where useful.
- Content records include owner, academic location, type, title, summary, language, availability, download permission, audit timestamps, and version information.
- Creators can save drafts, submit for review, view feedback, revise, and track status.
- Administrators can publish, unpublish/archive, transfer ownership, and manage all content.
- Material deletion defaults to archive when historical progress or quiz references exist.

**Edge cases:**

- Two editors update the same draft.
- Creator permission revoked during review.
- Published content replaced while a student has it open.
- Content referenced by a completed quiz or report.
- Scheduled/pending review without an assigned reviewer.

**Acceptance criteria:**

- Students never receive drafts or rejected content through the API.
- State transitions are validated, permission-checked, and audited.
- Conflicting edits are detected rather than silently overwritten.
- Historical attempts retain the version they used.

**Required tests:** State transition unit tests, creator scope, unauthorized publish, concurrency conflict, archive history, API filtering, and audit-event tests.

### F-08 Managed Files, PDF, Audio, and Future Video

**Roles:** Student consumes permitted files; creator uploads within scope; administrator manages all.

**User story:** As a student, I want reliable document and audio access on mobile while the platform protects restricted files and unsafe uploads.

**Permissions:** View and download are separate content permissions. Upload, replace, publish, and delete follow creator/admin scope. Storage URLs alone must not grant unauthorized access.

**Expected behavior:**

- File bytes live outside PostgreSQL behind a storage abstraction.
- Local development storage and S3-compatible production storage expose the same application contract.
- Files have generated identifiers, metadata, owner, content type, size, checksum, processing status, and access policy.
- PDF viewing supports resume location and an accessible non-canvas document outline where practical.
- PDF annotation is a user feature but its mobile tools start collapsed and never obscure most of the reading surface by default.
- Audio supports standard playback controls, resume position, duration, and transcript/caption metadata.
- Video has a future-ready metadata model; full video delivery is not required before an approved feature phase.
- Download links are short-lived or permission-mediated.

**Edge cases:**

- Oversized, interrupted, duplicate, corrupted, or unsupported upload.
- Extension and actual content type disagree.
- Missing storage object.
- User loses access after a link was generated.
- Large PDF on poor connectivity.
- Browser lacks a media capability.

**Acceptance criteria:**

- Server validates configured size and content allowlists; extension alone is insufficient.
- Uploaded objects are stored outside application/static roots and cannot execute as application code.
- Quarantine/scan integration status exists even if a malware scanner is not yet configured.
- Unauthorized users cannot obtain file bytes by guessing identifiers.
- Range requests or equivalent efficient delivery are supported where storage permits.
- Viewer has loading, offline, permission, missing-file, and retry states.

**Required tests:** Upload validation, size/type mismatch, interrupted upload, ownership, signed/mediated link expiry, download permission, missing object, PDF/audio UI accessibility, and representative large-file performance tests.

### F-09 Browse, Search, Bookmarks, and Learning Resume

**Roles:** Authenticated users with content access; administrators may search management data separately.

**User story:** As a student, I want to find and resume useful material quickly without scanning the full hierarchy every time.

**Permissions:** Search returns only content the requesting user may view. Bookmarks and resume data are private to their owner.

**Expected behavior:**

- Browse follows the academic hierarchy and supports content-type filters.
- Search supports title, keyword, subject/location, type, and relevant status filters.
- Results are paginated with stable ordering and meaningful empty states.
- Users can bookmark permitted content and questions.
- Resume tracks meaningful progress such as lesson completion, PDF location, audio position, and current study task without claiming completion from a simple page open.
- Search terms do not translate educational content.

**Edge cases:**

- Empty/very long query, punctuation, Arabic UI with English content.
- Content archived after bookmarking.
- Permission or subscription changes.
- Duplicate bookmark request.
- Resume event arrives out of order.

**Acceptance criteria:**

- Unauthorized/private content never appears in result counts or snippets.
- Duplicate bookmarks are prevented by a unique rule.
- Progress updates are idempotent or revision-aware.
- Pagination does not duplicate or omit rows during normal browsing.
- Search response targets are measured in Phase 11.

**Required tests:** Search filtering, permission leakage, pagination, duplicate bookmark, archive behavior, out-of-order progress, and mobile browse/search E2E.

### F-10 Question Bank and Question Lifecycle

**Roles:** Student answers; moderator corrects confirmed mistakes within permission; creator manages assigned questions; administrator manages all.

**User story:** As an authorized author, I want validated, versioned questions so students receive gradeable and explainable practice.

**Permissions:** Students cannot read answer keys before the configured release point. Authoring and correction follow content scope. Publishing is separately controlled.

**Expected behavior:**

- Supported types: multiple choice, true/false, and completion-style selection from predefined options.
- A question stores prompt, options, correct option(s) as allowed by type, explanation, difficulty, academic scope, language, author, status, and version.
- Validation enforces the correct number of options and valid predefined answer.
- Questions can be drafted, reviewed, published, retired, and versioned.
- Historical attempts retain the question/version and answer ordering they received.

**Edge cases:**

- No correct answer, duplicate options, blank option, or invalid true/false setup.
- Published question edited while attempts are active.
- Question retired after appearing in a completed attempt.
- Confirmed mistake changes grading policy.

**Acceptance criteria:**

- Invalid questions cannot publish.
- Student endpoints do not expose answer keys before allowed.
- Published edits create or preserve an auditable version boundary.
- Correction behavior for active/completed attempts is explicit and audited; scores are never silently rewritten.

**Required tests:** Per-type validation, answer-key leakage, lifecycle permissions, version snapshots, retirement, correction audit, and serialization contracts.

### F-11 Quiz Definition, Practice Setup, and Attempt Start

**Roles:** Student takes; creator/admin author within permission; moderator may review confirmed errors; administrator controls all.

**User story:** As a student, I want to start the intended quiz or a permitted practice session with clear rules before the timer begins.

**Permissions:** Access depends on publication, academic/content access, subscription, availability window, and retry policy. Authors cannot bypass student rules through the public attempt API.

**Expected behavior:**

- Quiz configuration includes title, scope, question selection, typical size of 40–50 questions, time limit, retry policy, availability, randomization, result release, passing rule, ranking/achievement eligibility, and focus settings.
- Practice sessions can allow student-selected size, subject, and difficulty within configured limits.
- Starting an attempt creates a server record with immutable quiz/version snapshot, randomized question order, randomized option order where valid, server start/deadline, and status.
- Start is idempotent for retried requests so a lost response does not create accidental parallel attempts.

**Edge cases:**

- Not enough eligible questions.
- User double-clicks start.
- Existing active attempt.
- Quiz closes between setup and start.
- Retry limit reached.
- Server/client clocks disagree.

**Acceptance criteria:**

- The client cannot choose correct answers, score, or authoritative deadline.
- Randomization is stored and stable for the attempt.
- A retry of the same start request returns the same attempt.
- Rules are shown before start and remain available during the attempt.
- Invalid or unavailable quiz starts return clear machine-readable and user-readable errors.

**Required tests:** Quiz validation, access window, subscription, retry limit, idempotent start, randomization stability, deadline authority, insufficient pool, and concurrent start.

### F-12 Quiz Autosave, Recovery, Timer, and Focus Events

**Roles:** Student.

**User story:** As a student, I want every answer preserved and the timer enforced consistently even if my connection drops or the page refreshes.

**Permissions:** Only the attempt owner can read or modify an active attempt. Submitted/expired attempts reject normal answer edits.

**Expected behavior:**

- Each answer change is autosaved with attempt, question, selected option, client revision, and server acknowledgment.
- The server resolves stale/out-of-order writes deterministically.
- Refresh/reconnect restores server-acknowledged answers and authoritative remaining time.
- A short-lived user- and attempt-scoped client recovery buffer may retain unsent answer changes; it is validated as untrusted, cleared on logout/submission, and never treated as submitted.
- Server time determines expiration.
- Focus mode reduces non-essential navigation and can log start, page-leave warning, reconnect, and return events.
- Anti-cheating remains non-invasive and makes no claim of perfect prevention.

**Edge cases:**

- Offline answer followed by changed answer in another tab.
- Autosave response lost after server commit.
- Timer expires while offline.
- Two devices/tabs use the same attempt.
- Session expires mid-attempt.

**Acceptance criteria:**

- A saved indicator distinguishes saving, saved, offline/pending, and failed.
- Autosave retries do not duplicate answers or regress a newer answer.
- Reconnect restores the authoritative attempt without resetting the timer.
- Expired attempts cannot be extended by changing the client clock.
- Focus events are informational/configurable and do not block assistive technology.

**Required tests:** Autosave unit/API tests, revision conflicts, lost response, two tabs, refresh, reconnect, offline expiry, session renewal policy, server-clock enforcement, and realistic concurrent autosave load scenarios.

### F-13 Submission, Grading, Results, and Mistake Reporting

**Roles:** Student submits/views; moderator reviews reports; creator/admin manages source questions; administrator can audit.

**User story:** As a student, I want one trustworthy final result even if I click twice, reconnect, or receive a slow response.

**Permissions:** Only the owner submits the attempt. Score and result release follow server configuration. Moderators/admins see reports according to scope.

**Expected behavior:**

- Final submission requires an idempotency key and runs in a database transaction.
- The transaction finalizes the attempt once, grades the immutable snapshot, records answers/result, emits progress/ranking/achievement events or durable records, and returns the same result for a repeated key.
- Submission after deadline follows the configured automatic-finalization policy.
- Results show score, status, answered/unanswered counts, and review detail only when release policy allows.
- Students can report a question, answer, explanation, or content problem from the result.

**Edge cases:**

- Double click, refresh, repeated request, concurrent requests.
- Network fails after successful commit.
- Partial attempt, expired timer, or missing answer.
- Question corrected after submission.
- Result release delayed.

**Acceptance criteria:**

- One attempt has at most one authoritative final result.
- Duplicate submissions cannot duplicate XP, ranking credit, achievements, mistakes, or progress.
- A retry after an unknown network outcome returns the committed result.
- Answer keys remain hidden until release.
- Reports preserve the attempt/question version as evidence.

**Required tests:** Transaction rollback, duplicate/concurrent submission, lost response, expiry, grading per type, delayed release, event deduplication, report creation, and high-concurrency submission load tests.

### F-14 Public Community

**Roles:** Authenticated users; moderator and administrator have elevated moderation.

**User story:** As a student, I want a useful academic community where I can post and discuss material without losing clarity or safety.

**Permissions:** Users create/edit/delete their own permitted content. Moderators manage public content. Creators have no public moderation power unless they also hold moderator permission. Administrators manage all.

**Expected behavior:**

- Public community supports posts, comments, one reply level, badges, reporting, pagination, notifications, and search when justified.
- User content is rendered as safe text or a strictly controlled format; arbitrary HTML is not accepted.
- Authors may edit their content while it is active; edit history is retained for moderation.
- User deletion uses a tombstone/soft-delete when replies or audit requirements exist.
- Feeds use stable cursor pagination.
- Rate limits and spam controls apply to posting, commenting, editing, and reporting.

**Edge cases:**

- Parent post deleted with replies.
- Simultaneous edit and moderation removal.
- Suspended user’s historical content.
- Duplicate post/report caused by retry.
- Very long text, links, mentions, and abusive content.

**Acceptance criteria:**

- Ownership and moderation permissions are enforced at the API.
- Deleted content does not expose its body to normal users but retains required moderation evidence.
- User-generated content cannot execute markup/script.
- Feed pagination remains stable and has loading, empty, end, error, and retry states.
- Moderation actions are auditable.

**Required tests:** Ownership, moderator/admin action, creator without moderator role, safe rendering/XSS, soft deletion, edit history, cursor pagination, duplicate retry, rate limiting, and mobile community E2E.

### F-15 Creator Private Spaces

**Roles:** Invited/authorized students, creator owner, assigned moderator where permitted, administrator.

**User story:** As a content creator, I want a private asynchronous space around my content where authorized members can discuss it under clear boundaries.

**Permissions:** Membership and visibility are explicit. The creator moderates their own space. Public-community moderation does not automatically grant access unless policy assigns it. Administrators can access/manage all.

**Expected behavior:**

- Version 1 is an asynchronous threaded community, not real-time chat.
- A creator can manage space metadata and remove content within their own space.
- Members can post/comment according to space settings.
- Assigned moderators can review reported private content only where permitted.
- Membership and moderation changes are audited.

**Edge cases:**

- Creator role revoked.
- Space owner suspended.
- Member removed while composing.
- Private content linked from a public page.
- Moderator report access without general membership.

**Acceptance criteria:**

- Private-space data never appears in public feeds/search.
- Object-level membership checks apply to every read and write.
- Creator authority is limited to owned/assigned spaces.
- Removing membership prevents future access immediately without erasing required history.

**Required tests:** Membership matrix, owner moderation, cross-space access, public leakage, revoked role, assigned moderator, administrator override, and notification privacy.

### F-16 Reports, Moderation, Question Correction, and Audit History

**Roles:** Student reports; moderator handles assigned scope; administrator handles all.

**User story:** As a moderator, I want a prioritized evidence-based queue so I can resolve reports consistently and leave an accountable history.

**Permissions:** Reporters see their own report status where appropriate. Moderators see assigned/permitted reports. Administrators see all and manage assignments.

**Expected behavior:**

- Reports target questions, answers, educational content, posts, comments, private-space content where permitted, or technical issues.
- Report stores reporter, target type/id/version, reason, description, status, assignment, resolution notes, timestamps, and audit history.
- Statuses: open, triaged, in progress, resolved, rejected, and duplicate.
- Confirmed question correction creates an audited versioned change; it does not silently rewrite historical results.
- Moderation actions require reason and appropriate confirmation.
- Destructive administrator actions require confirmation and audit.

**Edge cases:**

- Target deleted/archived after report.
- Duplicate reports.
- Moderator loses role while assigned.
- Report involves the moderator or creator.
- Conflicting simultaneous resolution.

**Acceptance criteria:**

- Queue filters and pagination are permission-scoped.
- Audit events record actor, action, target, timestamp, and non-secret contextual metadata.
- Audit history is append-only to normal application roles.
- Duplicate reports can be linked without losing reporters.
- Conflict or self-review policy prevents inappropriate resolution.

**Required tests:** Target types, scope, assignment, duplicate linkage, conflict handling, role revocation, correction versioning, audit immutability, confirmation, and mobile moderation flows.

### F-17 Rankings and Achievements

**Roles:** Students view; administrator configures; authorized operators may inspect calculations.

**User story:** As a student, I want rankings and achievements that reflect real, understandable activity without making study feel arbitrary.

**Permissions:** Users see published ranking views and their own relevant detail. Administrators configure metrics, periods, visibility, and achievement definitions.

**Expected behavior:**

- Ranking metrics may use quiz score, eligible study activity, completed lessons, achievements, streaks, and subject performance.
- Ranking definitions, period, eligibility, tie-breaking, and privacy display are configurable.
- Page reads use stored snapshots or efficient aggregates, not expensive global recalculation.
- Achievements have configurable definitions, versioned criteria, active status, and unique earned records.
- Award/ranking inputs are deduplicated from authoritative events/results.

**Edge cases:**

- Tie, corrected quiz, revoked/invalid activity, privacy opt-out, suspended account.
- Metric definition changes mid-period.
- Recalculation fails or snapshot becomes stale.
- Same achievement awarded concurrently.

**Acceptance criteria:**

- Ranking pages display snapshot freshness and rules.
- Unique constraints prevent duplicate awards.
- Expensive calculation does not run on every page request.
- Corrective recalculation is auditable and does not silently manufacture activity.
- Privacy display policy is configurable.

**Required tests:** Metric calculation, tie-breaking, eligibility, duplicate award, corrected result, snapshot fallback/staleness, permission/configuration, and ranking load tests.

### F-18 Notification Center and Preferences

**Roles:** All authenticated users; administrator manages platform notices/templates.

**User story:** As a user, I want one dependable notification center and control over optional messages without missing security-critical information.

**Permissions:** Users read/update only their notifications and preferences. Administrators create authorized platform notices; they cannot impersonate another user’s private notification history.

**Expected behavior:**

- In-platform notifications support type, recipient, actor where relevant, safe target, read state, created time, and deduplication key.
- Users can mark one/all as read and manage optional category preferences.
- Security/account messages and legally required messages cannot be disabled where applicable.
- The model supports future email, PWA push, and mobile channels without assuming they are implemented.
- Initial in-platform creation must not require Celery; a durable asynchronous mechanism is added only when a real channel or measured workload requires it.

**Edge cases:**

- Deleted target, duplicate event, revoked access, large unread count.
- User changes preference while an event is being generated.
- Notification link points to unauthorized/archived content.

**Acceptance criteria:**

- A repeated domain event does not create duplicate notifications.
- Opening a notification rechecks target permission.
- Unread counts are efficient and accurate.
- Preferences are category/channel specific and have clear defaults.

**Required tests:** Ownership, mark read/all, deduplication, deleted/unauthorized target, preference enforcement, unread count, admin notice permission, and mobile notification-center E2E.

### F-19 Trial, Subscription State, and Access Rules

**Roles:** Student and other normal users; administrator manages overrides; future provider integration.

**User story:** As a student, I want a clear trial and subscription status so I know what access I have and never lose my learning history when access expires.

**Permissions:** Users view their subscription and initiate supported actions. Only administrators or verified provider events change authoritative paid state/overrides.

**Expected behavior:**

- Internal states support trialing, active, grace, expired, suspended, and administrator override.
- The one-month trial rule is configurable. Initial default: per user, starting when the account is verified/activated.
- Price, currency, grace duration, and provider remain unset/configurable until owner approval.
- Expiration restricts paid educational actions according to an access policy while leaving login, profile, subscription/help, and the user’s stored progress available.
- Expiration never deletes content history, attempts, progress, or account data.
- Phase 8 provides a fake development provider and a provider interface; no real payment integration is allowed without approval.

**Edge cases:**

- Verification delayed after registration.
- Clock/timezone boundary.
- Administrator grant overlaps a paid subscription.
- Future provider event arrives twice or out of order.
- Account suspended independently of billing.

**Acceptance criteria:**

- State transitions are validated, timezone-aware, and audited.
- Access decisions use the internal subscription domain, not frontend claims.
- Duplicate future provider events are idempotent.
- Expiration preserves data and clearly explains available actions.
- Trial start policy can change for future accounts without corrupting existing periods.

**Required tests:** Trial start/end, timezone, each state, access matrix, admin override, suspension precedence, data preservation, duplicate/out-of-order provider-event contract, and fake-provider tests.

### F-20 PWA Installation, Offline State, and Updates

**Roles:** All frontend users.

**User story:** As a mobile user, I want Lock-in to install cleanly, explain connectivity truthfully, and update without risking stale private or quiz data.

**Permissions:** Cached assets do not bypass API authorization. Logout clears user-scoped temporary recovery data.

**Expected behavior:**

- Installable manifest includes Lock-in identity, icons, colors, start URL, and appropriate display/orientation behavior.
- Service worker caches versioned static assets and a safe offline fallback.
- Private API responses, account data, answer keys, quiz submissions, and authenticated HTML are not placed in shared long-lived runtime caches.
- Offline state is explicit. Unsupported actions remain disabled or queued only through the documented attempt recovery mechanism.
- The service worker never fabricates a successful quiz submission.
- Update flow detects a new version, avoids interrupting an active quiz, and prompts/reloads at a safe point.

**Edge cases:**

- New version during active quiz.
- User switches accounts on one device.
- Cache corruption.
- Offline direct navigation.
- Storage quota exhausted.

**Acceptance criteria:**

- PWA passes installation requirements on supported browsers.
- Offline fallback does not expose another user’s data.
- Account switch/logout clears user-scoped recovery state.
- Active quiz is not force-reloaded by an update.
- Cache version activation removes obsolete caches safely.

**Required tests:** Manifest checks, service-worker unit/integration tests, offline navigation, account switch, cache cleanup, update during quiz, quota/error state, and Playwright PWA flows where browser support permits.

### F-21 Administrator Configuration, Analytics, and System Status

**Roles:** Administrator; limited relevant summaries for creator/moderator.

**User story:** As the platform owner, I want understandable controls and trustworthy operational summaries without editing source code.

**Permissions:** Administrator-only for global configuration and sensitive analytics. Moderator/creator analytics are scoped and aggregate only permitted data.

**Expected behavior:**

- Administration covers users, roles, hierarchy, content, questions, quizzes, community, reports, subscriptions, notifications, ranking definitions, achievements, and platform settings.
- Configuration changes are validated and audited.
- Analytics identify data source, period, timezone, and freshness.
- System status shows application health information safe for an administrator; secrets, raw tokens, and sensitive infrastructure details are never displayed.
- Destructive bulk actions use preview, explicit confirmation, result summary, and audit history.
- Mobile management uses list/detail, filters, and action sheets instead of wide desktop tables.

**Edge cases:**

- Bulk action partially fails.
- Administrator’s permission/session changes during action.
- Large result set.
- Stale analytics.
- Last administrator or critical configuration change.

**Acceptance criteria:**

- Global settings are typed, validated, and have safe defaults.
- Bulk operations are bounded, resumable or clearly report partial results, and audited.
- Sensitive values are redacted.
- Mobile administrator flows remain usable without horizontal table dependence.

**Required tests:** Administrator-only API, configuration validation, audit, bulk preview/partial failure, redaction, analytics freshness, last-admin protection, and responsive E2E.

### F-22 Loading, Empty, Error, Confirmation, and Recovery States

**Roles:** All.

**User story:** As a user, I want the product to explain what is happening and how to recover instead of showing blank, misleading, or destructive states.

**Permissions:** Error detail must respect role and must not reveal secrets or inaccessible object existence.

**Expected behavior:**

- Data surfaces have deliberate skeleton, empty, partial error, full error, retry, offline, and stale states.
- Forms preserve safe user input after recoverable validation/network errors.
- Destructive actions state the object and consequence, require confirmation at appropriate risk, and prevent accidental repeat.
- Toasts supplement but do not replace persistent status for important outcomes.
- API errors use a stable machine code, localized user message, field errors where relevant, and a support correlation identifier.

**Edge cases:**

- Partial dashboard failure.
- Slow request completes after route change.
- Double click.
- Error while dismissing/undoing.
- Screen reader needs status update.

**Acceptance criteria:**

- No primary route renders a blank page for loading/empty/error.
- Destructive actions cannot be triggered by an accidental repeated click.
- Error messages do not expose stack traces, SQL, secrets, or another object’s existence.
- Important asynchronous status is announced accessibly.

**Required tests:** Shared state components, form preservation, double-click prevention, API error contract, screen-reader live regions, partial failure, and representative E2E recovery.

## Cross-Cutting Non-Functional Requirements

### Performance targets

These are launch targets to validate, not claims:

- Core Web Vitals at the 75th percentile on supported mobile devices: LCP at or below 2.5 seconds, INP at or below 200 ms, CLS at or below 0.1.
- Initial authenticated route JavaScript budget: target at or below 250 KB gzip, with route-level lazy loading and documented exceptions.
- Typical paginated read APIs: p95 at or below 400 ms under the approved representative load environment.
- Autosave APIs: p95 at or below 500 ms.
- Final quiz submission: p95 at or below 1.5 seconds while preserving transaction correctness.
- Server error rate below 1% in target load scenarios, excluding expected client validation/authorization responses.
- No claim of 2,000 concurrent support before Phase 11 measured load tests.

### Capacity and data

- Initial design target: 5,000 registered students and realistic scenarios with 2,000 active users.
- Pagination is required for unbounded collections.
- Frequently used filtering/ordering columns require justified indexes.
- Query-count tests cover high-traffic list/detail APIs.
- Database connections use bounded application pooling/worker configuration rather than one connection per user.

### Security

- Django secure defaults, environment-based secrets, strict production hosts, CSRF middleware, secure cookie configuration under TLS, and deploy checks.
- Backend authorization on every privileged or object-specific action.
- React renders untrusted strings through safe JSX; arbitrary HTML is not a product requirement.
- No session identifiers in localStorage/sessionStorage.
- File uploads are untrusted and never served as executable application content.
- CSP and other security headers are delivered by Django/reverse proxy/edge as appropriate.
- Logs redact credentials, cookies, tokens, reset links, and sensitive personal data.

### Reliability and recovery

- All timestamps are timezone-aware and stored consistently.
- Quiz finalization and other multi-record invariants use database transactions.
- Idempotency protects externally repeated state-changing operations where duplicate effects matter.
- Provisional launch recovery targets: database RPO no greater than 24 hours and RTO no greater than 4 hours, subject to the selected hosting plan.
- Backup restoration must be tested before production launch.

### Browser and device support

- Current and previous major versions of Chrome, Edge, Firefox, and Safari where feasible.
- Current supported iOS/iPadOS Safari and modern Android Chrome.
- Progressive enhancement for unsupported PWA install or notification capabilities.

## Important Redesigns and Usability Reasons

| Current pattern | Product direction | Why it is better |
|---|---|---|
| Dense dashboard of competing cards | Next-action hierarchy with secondary details progressively disclosed | Reduces cognitive load and makes continuation obvious |
| One general navigation for every role | Role-aware destinations with consistent shared student context | Prevents management tools from overwhelming students and clarifies authority |
| PDF mobile tool drawer covering most content | Collapsed, task-based tool controls with explicit drawing mode | Protects reading space and reduces accidental annotation |
| Quiz embedded in the general app shell | Focused attempt shell with persistent save/timer state and constrained navigation | Reduces mistakes and makes high-stakes status visible |
| Community mock panels and unclear actions | Stable feed, thread detail, ownership, reporting, moderation states | Makes conversations understandable and enforceable |
| Desktop-like management density | Mobile list/detail workflows and progressive actions | Makes moderator/admin work possible on phones and tablets |
| Auth-only Arabic switch | Application-wide language and document-direction system | Prevents mixed-direction and inaccessible RTL behavior |
| “Private chat” requiring implied real time | Asynchronous creator spaces in version 1 | Satisfies discussion needs without unjustified WebSockets or operational complexity |

## Documented Assumptions

1. Lock-in launches for one institution. The hierarchy supports future additional institutions, but full multi-tenant isolation is not claimed.
2. Public email registration is allowed and requires verification.
3. The trial defaults to one month from account verification/activation and remains configurable.
4. No grace period, price, currency, coupon, or real payment provider is selected yet.
5. Private creator communication is asynchronous threaded discussion in version 1.
6. Public community replies are limited to one nested level initially.
7. The existing prototype contains no production data requiring migration. If real data is identified, migration becomes a separately reviewed requirement.
8. Existing Lock-in brand and mascot assets are assumed to be owned/licensed by the owner.
9. Video delivery is future-ready data modeling until explicitly scheduled for implementation.
10. Email and push delivery providers are not selected. In-platform notifications are the first guaranteed channel.
11. Legal retention, privacy policy, terms, and account-deletion timelines require owner/legal input before production launch.

## Behavior Not Yet Inferable

These items do not block Phase 2 because they are configurable or belong to later phases:

| Unknown | Working resolution |
|---|---|
| Subscription price/currency | Not set; configure in Phase 8 |
| Grace-period policy | Disabled by default; configurable later |
| Real payment provider | No provider until explicit approval |
| Exact quiz retry rules | Per-quiz configuration |
| Immediate vs delayed answer release | Per-quiz configuration |
| Ranking formulas and periods | Administrator-configurable definitions in Phase 7 |
| Achievement catalog | Seeded and reviewed in Phase 7 |
| Default PDF download permission | Per-content setting; administrator controls default |
| Institution/faculty names and real curriculum | Owner-provided content/configuration |
| Email service | Select only when implementing email flows |
| Push notification provider | Select only when implementing push delivery |
| Legal retention and account deletion | Must be approved before production |
| Report response SLA | Operational policy to be added before launch |
| Detailed anti-cheating additions | Extension points only until owner supplies approved ideas |

## Phase Acceptance

Phase 1 is complete when:

- this specification covers every requested feature with roles, permissions, behavior, edge cases, acceptance criteria, and required tests;
- assumptions and unknowns are visible;
- architecture and decision documents agree with this specification;
- no frontend/backend foundation or business code has been started;
- documentation validation passes;
- the owner reviews and explicitly approves Phase 2.

