# Ready-to-use prompts for the implementation AI

## Shared instruction included in every phase prompt

Use only frontend files. Do not modify any backend file, Django setting, model, serializer, view,
route, permission, migration, test, task, WebSocket, static/media setup, or database. The current
replacement frontend is the visual source of truth: preserve its components, layout, CSS tokens,
fonts, colors, spacing, icons, images, animations, responsive behavior, navigation, light/dark
themes, loading visuals and empty/error states. Do not copy the legacy backup appearance.

Use real existing Django APIs only. Do not invent endpoints, response fields, roles, permissions,
tokens, refresh endpoints, mock services, Supabase or Firebase. Use session cookies with
credentials, CSRF for unsafe calls, exact serializer fields, server validation errors, and server
permission responses. Never calculate or grant answers, scores, XP, streak, completion, rank,
achievement, subscription, payment or entitlement client-side. Run the required checks, write a
phase report under frontend, and stop after the named phase.

---

## Phase 0 prompt — Shared API, authorization, and state foundations

Implement only Phase 0 from AI_FRONTEND_IMPLEMENTATION_PLAN.md.

Replace the generic adapter in src/lib/api.js with one explicit frontend API client and domain-ready
contract foundation. Support GET /api/v1/auth/csrf, GET /api/v1/auth/session and
POST /api/v1/auth/logout. Use session cookies, X-CSRFToken for all unsafe requests, FormData without
a forced JSON header, binary/204 responses, and Django errors shaped as
error.code, error.message, error.fields and error.request_id. There is no JWT/access-token/refresh
flow. A 401 clears client auth state and reaches the existing auth screen.

Create JSDoc contracts/normalizers, page/cursor helpers, UUID idempotency helper and role/capability
helpers. Add protected and forbidden route behavior without changing visible route design. Keep the
existing current shell, loading and error components. Remove mock/compatibility fallbacks only where
they conflict with this foundation; do not implement domain features.

Acceptance: one request path, no hardcoded server origin or bearer token storage, exact CSRF/cookie
behavior, field errors are available to forms, 409 details remain available, existing routes look the
same. Test CSRF, errors, FormData, 204/binary, 401 cleanup, helpers and build. Create
frontend/PHASE_0_IMPLEMENTATION_REPORT.md and stop.

## Phase 1 prompt — Account flows, security, and access

Implement only Phase 1, on top of an approved Phase 0.

Use these exact endpoints: POST /auth/register with full_name, email, password, password_confirm,
preferred_language, accept_policies; POST /auth/verify-email and /auth/resend-verification;
POST /auth/login; POST /auth/logout and /auth/logout-all; GET /auth/session;
POST /auth/password-reset and /auth/password-reset/confirm; GET,PATCH /account/profile;
POST /account/password, /account/email, /account/email/confirm; GET /account/sessions and
DELETE /account/sessions/{session_id}.

Preserve the current AuthPage/Profile/Settings/menu visual identity. Add only necessary hash routes
for verify-email, confirm-email and reset-password, plus a current-style security panel. Token values
must be read once from the route/query and never logged/stored. Render Django field errors beside
the relevant field; generic reset/resend responses remain generic. Registration must not send roles.
Use current session roles only to hide management links and show forbidden on direct access. Keep
theme/mascot/reminder explicitly device-local because no backend preference endpoint exists.

Acceptance: login/logout/session revocation works; public verification/reset/email confirmation work;
profile, language, password and email mutation contracts are exact; 401/403 are safe; desktop/mobile
appearance remains unchanged. Run API/component tests, lint/type checks, build and browser smoke.
Write frontend/PHASE_1_IMPLEMENTATION_REPORT.md and stop.

## Phase 2 prompt — Student discovery, content, files, bookmarks, and progress

Implement only Phase 2, on approved Phases 0–1.

Connect the existing Dashboard, Materials, Bookmarks, Sheet reader entry and top-bar search to:
GET /dashboard; GET /education/nodes with parent and GET /education/nodes/{node_id};
GET /learning-objects with node/content_type and GET /learning-objects/{id};
GET /learning/dashboard; GET /search with q, kinds, content_types, academic_path;
GET /progress/resume; GET,POST /bookmarks and DELETE /bookmarks/{learning_object_id};
GET,PUT /progress/learning-objects/{learning_object_id}. Use P25 response controls. Only expose
POST /progress/lessons/{lesson_id}/complete when a real backend lesson ID exists.

Preserve current pages and visual patterns. Implement hierarchy/breadcrumbs, learning object detail,
secure view/download links, real bookmarks and revision-safe progress. Use expected_revision returned
by Django. On 409 refetch and offer retry. Do not turn completed learning objects into fake question
metrics, accuracy or goals. Do not PWA-cache private files. If download_url is null, retain visual
design but make the download unavailable. Unsupported checkpoint/study-plan features remain visibly
unavailable, never successful.

Acceptance: filters and P25 paging work, server content/file access is respected, mutation refresh
works, empty/403/404/no-download states are honest, and layout/theme/mobile design is preserved.
Run real-backend node-to-file-to-bookmark-to-progress flow, tests, checks and build. Write
frontend/PHASE_2_IMPLEMENTATION_REPORT.md and stop.

## Phase 3 prompt — Quizzes, attempts, results, and review

Implement only Phase 3, on approved foundations.

Replace disconnected Questions behavior with real assessment endpoints:
GET /quizzes and /quizzes/{quiz_id}; POST /quizzes/{quiz_id}/attempts with idempotency_key,
question_count, difficulties and review_only; GET /attempts/{attempt_id};
PUT /attempts/{attempt_id}/questions/{attempt_question_id}/answer with selected_option_ids and
client_revision; POST /attempts/{attempt_id}/activities; POST /attempts/{attempt_id}/submit with
idempotency_key; GET /assessment-results/{result_id}; POST /assessment-results/{result_id}/reports;
GET /assessment-review.

Keep the replacement Questions/Review identity and create visually native detail/attempt/result routes
only as needed. Timer must use server_time/deadline_at. Use returned server_revision. On answer 409,
recover from current_answer. Use stable UUIDs for start/submit/activity and do not duplicate attempts.
Correct options, explanation and scores render only after result released is true and questions is
non-null. Never grade, score, award XP, reveal answers, cache answers publicly or convert the review
queue into a generic answer endpoint. Report issue only from a returned result question.

Acceptance: start/resume/save/submit/release/conflict/closed flows are real; validation states are
visible; mobile/keyboard appearance matches current UI. Run assessment contract tests, E2E flow,
lint/type checks/build. Write frontend/PHASE_3_IMPLEMENTATION_REPORT.md and stop.

## Phase 4 prompt — Focus workspace and annotations

Implement only Phase 4, preserving the current SheetStudy appearance.

Use GET /focus/documents/{documentVersionId}; GET,POST /focus/sessions; POST
/focus/sessions/{session_id}/{pause|resume|complete|abandon}; PATCH
/focus/sessions/{session_id}/workspace; GET,POST
/focus/documents/{documentVersionId}/annotations. All require the server focus.workspace entitlement.
Start uses document_version_id, client_instance_id and optional planned_duration_seconds. Workspace
uses expected_revision, current_page, page_count, zoom, sidebar, active_tool, layout and open_tabs.
Annotations use expected_collection_revision, idempotency_key, annotations, deleted_ids; query pages
contains at most 10 pages and sync has at most 100 mutations.

Reuse the current canvas/PDF toolbar, panels, animations and mobile sheet geometry. Replace local
authoritative state with real document/session/workspace/annotation state. Render access/entitlement
failure honestly. Keep unsynced annotations only as explicit recovery data, never as saved/completed.
Use revision conflict recovery, truthfully show saving/saved/conflict/offline, never award local XP,
unlock pages, run fake final quiz or cache private documents/API responses. Treat annotations as data,
never unsafe HTML.

Acceptance: entitled and denied paths work, sessions/actions/autosave/annotation sync are contract
correct, 409 recovery works, visual layout is unchanged on desktop/tablet/mobile. Run real backend
smoke, tests, build and write frontend/PHASE_4_IMPLEMENTATION_REPORT.md. Stop.

## Phase 5 prompt — Motivation, rankings, and notifications

Implement only Phase 5.

Connect existing Progress, Achievements, Ranked and notification UI to:
GET /progression/xp, /progression/xp/ledger, /progression/streak, /progression/achievements,
/progression/rankings/current; GET,PUT /progression/rankings/profile; GET /notifications,
GET /notifications/summary, GET,PUT /notifications/preferences; POST
/notifications/{notification_id}/read, /open and /read-all. Notification lists use cursor paging and
unread=true; preferences are the complete array of category, channel and enabled objects.

Keep current visual language. Remove fake duplicate leaderboards, fake champions/new badges and local
streak-freeze consumption because no freeze endpoint exists. Render only server summary/ledger/policy/
achievement/ranking values. Ranking privacy uses returned profile. On notification open, wait for
returned route and handle 410 target unavailable. Keep theme/reminder device-local; do not label them
notification preferences. Keep personal Analytics unavailable or truthful; do not call operations
analytics yet.

Acceptance: no client-authoritative XP/streak/rank/achievement, cursor/read/preference errors work,
empty/error/retry and mobile layout are preserved. Run contract tests, browser smoke, lint/type
checks/build. Write frontend/PHASE_5_IMPLEMENTATION_REPORT.md and stop.

## Phase 6 prompt — Contextual community and reporting

Implement only Phase 6.

Replace generic community behavior with:
GET,POST /community/discussions; GET,PATCH,DELETE /community/discussions/{discussion_id};
GET,POST /community/discussions/{discussion_id}/comments; PATCH,DELETE
/community/comments/{comment_id}; GET,POST /community/spaces; GET /community/spaces/{space_id};
POST,DELETE /community/spaces/{space_id}/members and member user id; GET,POST /moderation/reports;
GET /moderation/reports/{report_id}.

A discussion create body requires context_type, context_id, optional space_id, title, body and
client_request_id. Edit/delete requires expected_revision. Comments use parent_id, body,
client_request_id and revision for edit/delete. Spaces use lesson or learning_object context. Member
add uses user_id XOR email and role. Report create uses target_type, target_id, reason, description,
client_request_id. Discussion cursor filters require context_type and context_id together; handle
409/429.

Preserve the current Community visual identity, but link composer to a valid learning/quiz context.
Add current-style context/detail/space routes only as necessary. Do not render fake likes, tags,
announcements, generic global composer or successful unsupported action. Show edit/delete/manage only
from returned can_edit/can_delete/can_manage. Escape all text, refresh after mutations and use
existing panels for missing context, empty, error, rate-limit and conflict states.

Acceptance: contextual flow, comments, space membership and reporter flow use real backend data and
permissions; mobile responsive visual remains current. Test filters/cursor, mutations/409/429/403,
lint/type checks/build. Write frontend/PHASE_6_IMPLEMENTATION_REPORT.md and stop.

## Phase 7 prompt — Creator studio

Implement only Phase 7.

Implement current-style creator routes for hierarchy, content, questions and quizzes. Use:
GET,POST /management/education/nodes; PATCH /management/education/nodes/{node_id};
POST /move and /status; GET /management/education/scopes; GET,POST /management/content;
GET,PATCH /management/content/{id}; POST submit/publish/reject/archive/transfer; POST
/management/files as multipart kind/file; GET,POST /management/questions; GET,PATCH question detail;
question submit/publish/reject/retire; equivalent management quizzes endpoints/actions.

Creator or administrator plus scope/ownership controls all access. Node/content/question/quiz updates
and lifecycle actions use expected_revision; reject includes review_note. Content has the documented
academic_node/content_type/title/etc serializer fields. Question options are 2–12 with text and
is_correct. Quiz form must use the complete backend write contract. Use returned validation/scan
status before attaching upload. Never expose management correct options to student assessment pages.

Use the replacement Shell/Page/forms/lists/tables/mobile patterns. Add creator nav/routes only for
creator/admin. Scope display informs UI, backend response decides final action. Handle 403/409 with
current states. Do not copy the old management design.

Acceptance: exact JSON/multipart contracts, scope/ownership denial, refresh after every mutation,
correct answer isolation and responsive UI. Run role/contract/upload tests, lint/type checks/build.
Write frontend/PHASE_7_IMPLEMENTATION_REPORT.md and stop.

## Phase 8 prompt — Administrator, moderator, and operations core

Implement only Phase 8.

Create visually native privileged workspaces for:
GET /admin/users and PATCH /admin/users/{user_id}/roles with roles;
POST/DELETE management education scopes; POST /moderation/reports/{id}/assign with
expected_revision/assignee_id; POST transition with expected_revision/status/resolution_notes/
duplicate_of_id/content_action; GET /moderation/audit; GET /operations/session, /resources,
/dashboards/overview, /dashboards/content, /dashboards/support, /system-health, /operations/users
with q and P25; PATCH /operations/users/{id}/roles with roles/reason; POST
/notifications/platform-notices; POST /progression/rankings/{code}/build.

Product roles and operational roles are different. Operations routes/nav must derive from operations
session/resources and exact capability, not merely administrator label. Admin routes require
administrator; moderation uses returned can_manage and server conflict rules. Platform notice and
ranking build require confirmation and server refresh. Preserve current shell, panels, forms/mobile
lists and use a neutral forbidden state; do not create a Django Admin look.

Acceptance: product/operational role endpoints are never confused; direct 403 safe; moderation
reporter/target conflict blocked; scope/notice/ranking updates use real backend. Test role/capability
matrix, P25 search, conflict and mobile UI, lint/type/build. Write
frontend/PHASE_8_IMPLEMENTATION_REPORT.md and stop.

## Phase 9 prompt — Catalogue, billing, and entitlements

Implement only Phase 9.

Use GET /catalog/products with region; GET /subscriptions/current and POST
/subscriptions/current/cancel; GET /entitlements/me and /entitlements/me/{code}; POST
/payments/intents; GET /payments, /invoices and /refunds; admin POST /admin/refunds,
POST /subscriptions/admin/{id}/transition and POST /entitlements/admin/grants.

Build a current-style subscription/access route and guarded admin access/finance panels. Catalogue is
server product/plan/price data. checkout_available false is disabled/pending. Payment intent body is
only price_id and requires Idempotency-Key at least 12 characters. Use returned checkout only as
provider handoff; never claim payment success or calculate price locally. Render money from
amount_minor, currency and currency_exponent. Histories are P25. Cancellation/refund/transition/
grant must wait for server response and use current confirmation/error visuals. Do not add coupon,
orders, payment provider, webhook or client entitlement behavior.

Acceptance: real subscription/entitlement/history flows, exact headers/payloads, admin guards,
validation/empty/error/mobile states, visual preservation. Test checkout unavailable, money,
idempotency, paging, denial/success, lint/type/build. Write
frontend/PHASE_9_IMPLEMENTATION_REPORT.md and stop.

## Phase 10 prompt — Operational analytics, reports, configuration, actions

Implement only Phase 10.

Use capability-scoped endpoints: GET /operations/analytics with from, to and repeated metric;
GET /operations/audit with P25/domain/actor_id/target_id; GET /operations/reports,
POST /operations/reports/previews and POST /operations/reports/{export_id}/execute;
GET /operations/configuration and PATCH /operations/configuration/{key}; POST
/operations/actions/previews and POST /operations/actions/{run_id}/execute.

Extend only operations routes with current visual patterns. Analytics date range is at most 367 days;
finance metrics may be omitted by server and must not become fake zeros. Reports/actions require
preview first; keep confirmation_token only transient in component memory, then send it to execute.
Configuration update sends value, expected_version and reason. Never put confirmation tokens,
sensitive configuration or audit details into URL/local storage/logs. Use exact capability guards,
neutral fresh-403 state, responsive current list/detail layout, CSV browser download handling and
current confirmation/error treatment. Student #/analytics is not an operations route.

Acceptance: analytics/audit/filter/paging/report binary/config revision/action preview-execute work
with real backend and no premature destructive success. Test capability denial, dates, paging,
binary response, conflict, one-time token, responsive UI, lint/type/build. Write
frontend/PHASE_10_IMPLEMENTATION_REPORT.md and stop.

## Phase 11 prompt — Regression and approval preparation

Implement only Phase 11. Do not add a product feature or redesign.

Run full regression against the real Django backend for visitor, student, creator, moderator,
administrator and operational-capability account where available. Verify auth/CSRF/session, direct
protected routes, published learning/files/bookmarks/progress, assessment answer-release integrity,
Focus entitlement/session/annotations, contextual community, creator scope, admin/moderation,
notifications, billing and operations. Test validation, 401/403/409/429, pagination/filter reset,
idempotency, uploads/downloads/CSV and refresh after mutation.

Run lint, JSDoc/type checks, frontend tests, production build, browser desktop/tablet/mobile and
theme visual checks, plus Django manage.py check read-only. Inspect Git diff and diff check: no backend
file may be modified. Verify private API/files and answers/tokens/secrets are absent from runtime
cache/local storage. Record failures honestly rather than masking them. Preserve current frontend
appearance exactly.

Write frontend/PHASE_11_IMPLEMENTATION_REPORT.md with commands, results, real flows, remaining
backend limitations, visual evidence and changed frontend files. Stop after the report.

