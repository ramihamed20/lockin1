# Phased frontend implementation plan

## Rules that apply to every phase

The replacement is a Vite + React 18 JavaScript app using HashRouter, a CSS theme system, and the
existing Page, LoadingPanel, ErrorPanel, EmptyState, ConfirmDialog, Shell, shared components and
Lucide icons. Reuse those patterns. Preserve its typography, colors, spacing, cards, forms, tables,
animations, responsive breakpoints, theme behavior, navigation and mobile layout. The legacy backup
is functional evidence only; never copy its markup, styling, or visual structure.

Django uses an HttpOnly session cookie and CSRF, not JWT. Send credentials with requests, get CSRF
from GET /api/v1/auth/csrf, and send X-CSRFToken for every unsafe request. There is no access-token
or refresh-token API. A 401 clears client authentication and returns to sign-in. A 403 is an honest
forbidden/access state. Errors have error.code, error.message, error.fields and error.request_id;
render fields beside controls and reload/retry revision conflicts (409), never overwrite server state.

Keep JavaScript. Do not do a speculative mass TypeScript migration. Phase 0 adds JSDoc request and
response contracts plus small runtime normalizers in src/api/contracts.js. Every mutation uses exact
Django field names, idempotency/revision data where required, and refreshes related server data only
after success. Answers, scores, XP, streaks, completion, ranking, entitlements, subscription and
payments are server authority only.

## Phase 0 — Shared API, authorization, and state foundations

**Objective:** Replace the generic compatibility mapper with an explicit contract-aware API layer
and reliable session/route behavior, with no visible page redesign.

**Features included:** CSRF/session transport, normalized errors, JSDoc contracts, query/page/cursor
helpers, idempotency UUID helper, session boot, protected route and role/capability helpers, mutation
refresh convention, and appropriate JavaScript lint/test/type-check scripts.

**Roles and endpoints:** Visitor and authenticated user. GET /auth/csrf, GET /auth/session,
POST /auth/logout, plus the common error envelope.

**Routes:** Bootstrap and existing hash-router fallback only; no visible route is added.

**Reuse:** App.jsx, ErrorBoundary, FullScreenState, LoadingPanel, ErrorPanel, useAsyncData, Shell,
the Vite proxy, and existing state styles.

**New reusable components/services:** src/api/client.js, src/api/contracts.js, src/api/pagination.js,
src/lib/authz.js with hasProductRole, hasOperationalCapability and canAccessRoute, plus a small
ProtectedRoute and ForbiddenState that reuse current visual components.

**State, permissions, and visual states:** Session context stores raw server user and derived helpers,
never credentials. A non-secret local marker is only a boot hint. On 401 clear it. Route guards only
control UI; backend still authorizes requests. Preserve current boot/loading/error panels and
breakpoints; add a retry action in the existing error/button treatment.

**Acceptance criteria:** One API client; no hardcoded server origin, duplicated fetch, mock fallback,
Supabase/Firebase, bearer token or token refresh logic. Unsafe JSON and multipart calls have
cookies/CSRF; 204 and binary responses work. Callers receive status/code/message/fields/request ID.
Existing pages render with the same visual shell.

**Tests:** CSRF, error parsing, FormData, 204/binary, query encoding, 401 cleanup, role/capability
truth tables, pagination reset, signed-in/signed-out shell smoke, production build.

**Likely files:** src/lib/api.js, src/App.jsx, src/hooks/useAsyncData.js, src/components/ui/index.jsx,
new src/api files/tests, and package/lock only if test tooling is added.

**Dependencies / out of scope:** First phase. No domain feature, dashboard metric or backend change.

## Phase 1 — Account flows, security, and route access

**Objective:** Complete existing Django account flows inside the current replacement auth/profile/
settings visual language.

**Features included:** Registration with policy/language, email verification/resend, login/logout/
logout-all, password reset request/confirm, profile name/language, password change, email change/
confirm, active session list/revoke, and role/capability-aware navigation.

**Roles and endpoints:** Visitor: POST /auth/register, /auth/verify-email, /auth/resend-verification,
/auth/password-reset, /auth/password-reset/confirm, /auth/login. Authenticated: GET /auth/session,
POST /auth/logout, /auth/logout-all, GET,PATCH /account/profile, POST /account/password,
/account/email, /account/email/confirm, GET /account/sessions, DELETE /account/sessions/{id}.

**Routes:** Preserve the auth screen; add only #/verify-email, #/confirm-email and #/reset-password
for backend email links. Preserve #/profile and #/settings. Place security in a current-style
profile/settings panel or subroute and retain the profile menu.

**Reuse:** AuthPage, Profile, Settings, existing form/button styles, ConfirmDialog, ErrorPanel, Shell.

**New reusable components/services:** AccountFormErrors, TokenActionPage, SessionList, RoleAwareNav,
and api/accounts.js.

**State, permissions, and visual states:** Refetch session after profile/language mutation and next
login. Hide management/operations links when session lacks permission; direct routes use forbidden
state. Never send a role during public registration. Field errors are local to fields; reset success
is generic; session list gets an empty state. Preserve auth art and narrow-mobile form layout.

**Acceptance criteria:** Registration uses exactly full_name, email, password, password_confirm,
preferred_language and accept_policies. Tokens are read once, never logged or stored. Password,
email and session mutations show backend errors and refresh truth. Logout-all/revoke current reaches
signed-out state. Theme, mascot and browser reminders remain explicitly device-local because no
server preference endpoint exists.

**Tests:** Login, registration/verify/resend, reset, profile/password/email, sessions, role-nav
guards, desktop/mobile keyboard flow and build.

**Likely files:** components/auth/AuthPage.jsx, pages/Profile.jsx, pages/Settings.jsx, App.jsx,
components/layout/index.jsx, api/accounts.js, account components/tests and scoped CSS.

**Dependencies / out of scope:** Phase 0. No avatar upload, deletion, server theme/reminder, admin roles.

## Phase 2 — Student discovery, content, files, bookmarks, and progress

**Objective:** Make Dashboard, Materials, Bookmarks, search and normal learning objects use published
Django data only.

**Features included:** Node hierarchy/breadcrumbs, learning-object list/detail, search, secure
view/download, learning dashboard/resume, bookmarks, revision-safe learning-object progress, and
truthful dashboard metrics.

**Roles and endpoints:** Authenticated content consumer: GET /dashboard, /education/nodes,
/education/nodes/{id}, /learning-objects, /learning-objects/{id}, /learning/dashboard, /search,
/progress/resume, GET,POST /bookmarks, DELETE /bookmarks/{learning_object_id}, and
GET,PUT /progress/learning-objects/{learning_object_id}. Enable POST
/progress/lessons/{lesson_id}/complete only with a real backend lesson ID.

**Routes:** Upgrade #/, #/materials, #/materials/:nodeId,
  #/materials/:nodeId/sheets/:learningObjectId, #/bookmarks and top-bar search destination without
changing their current visual structures.

**Reuse:** Dashboard, Materials, SheetStudy shell only for ordinary object reading, Bookmarks, Page,
ListRow, ProgressLine, EmptyState, loading/error panels and top-bar search.

**New reusable components/services:** PaginatedList, page controls, EducationBreadcrumbs,
LearningObjectCard, FileViewerLink, BookmarkButton, RevisionMutationNotice and
api/education.js, api/learning.js, api/progress.js, api/search.js.

**State, permissions, and visual states:** Use server is_bookmarked/progress. PUT uses returned
revision; 409 refetches object and offers retry. Success refreshes object, bookmarks, resume and only
affected dashboard panels. Never map completed content to question count, accuracy or daily goals.
Use independent dashboard-panel skeleton/error states. Preserve material grid/table/mobile layout.
Disable download where download_url is null; render 403/404/unavailable with current panels.

**Acceptance criteria:** Parent/node/content-type/search filter and P25 paging contracts are exact.
Only published server content/file URLs appear and private files are not PWA cached. Bookmark/progress
mutations are real and revision-safe. Page count/completion/availability/download permission are
server facts. Existing Materials/Sheet visuals remain; unsupported checkpoint actions say unavailable.

**Tests:** Filters/page navigation/revision conflict, node-to-object-to-file-to-bookmark-to-progress
against Django, empty/no-download/403/404, desktop/mobile visual and overflow checks, build.

**Likely files:** pages/Dashboard.jsx, Materials.jsx, Bookmarks.jsx, SheetStudy.jsx, layout,
API modules, shared list/breadcrumb/bookmark components, tests/CSS.

**Dependencies / out of scope:** Phases 0–1. No Focus annotations, quiz/checkpoint, question bank,
study plan or client-created goals.

## Phase 3 — Quizzes, attempts, released results, and review queue

**Objective:** Replace disconnected Questions behavior with server-authoritative published quizzes,
safe attempts, results and due review while preserving the current visual identity.

**Features included:** Quiz list/detail, start/resume, focused attempt, server-clock timer, answer
save/conflict recovery, activity events, submit, result/release, question issue report and review queue.

**Roles and endpoints:** Attempt owner: GET /quizzes, /quizzes/{id}; POST /quizzes/{id}/attempts;
GET /attempts/{id}; PUT /attempts/{id}/questions/{attemptQuestionId}/answer;
POST /attempts/{id}/activities and /submit; GET /assessment-results/{id};
POST /assessment-results/{id}/reports; GET /assessment-review.

**Routes:** Evolve #/questions into quiz discovery/review entry; add
  #/questions/quizzes/:quizId, #/questions/attempts/:attemptId and
  #/questions/results/:resultId only where necessary. Do not use legacy layout.

**Reuse:** Questions, Review, QuestionCard visual vocabulary, ConfirmDialog, ProgressLine, existing
loading/error/empty states and any current completion animation only after a server result.

**New reusable components/services:** QuizCard, AttemptShell, AttemptTimer, AnswerSaveIndicator,
QuestionNavigator, SubmissionConfirmation, ResultReleaseState, ReportQuestionForm, assessment API.

**State, permissions, and visual states:** Generate stable UUID before start/submit/activity. Use
returned attempt/server_time/deadline/server_revision. Results render correct options/explanation
only when released is true and questions is non-null. Review queue is not a generic answer endpoint.
Use question skeletons; show saving/saved/conflict/closed, idempotent-submit pending and
pending-release states; maintain current phone control behavior.

**Acceptance criteria:** No client grading or XP/ranking/streak change; no answer leakage in storage,
logs or PWA cache. Requests use exact option UUID/client revision/idempotency. 409 can recover
current_answer; closed attempts cannot claim saved. Issue report is only for a real result question.
Visual/mobile behavior stays current-replacement native.

**Tests:** Resume, conflict, deadline/closed, submit idempotency, hidden/released results, report
errors, review empty, keyboard/mobile E2E and build.

**Likely files:** pages/Questions.jsx, Review.jsx, shared QuestionCard, new assessment components/
pages, api/assessments.js, App routes/tests/scoped CSS.

**Dependencies / out of scope:** Phases 0–1; Phase 2 links content. No creator editor or sheet quiz.

## Phase 4 — Entitled Focus workspace and annotation synchronization

**Objective:** Connect the existing SheetStudy surface to real Focus document/session/annotation
contracts without simulated save, time, completion or entitlement.

**Features included:** Document/access state, start/pause/resume/complete/abandon, workspace restore/
autosave, annotation load/sync/delete and conflict recovery.

**Roles and endpoints:** Authenticated user with focus.workspace entitlement:
GET /focus/documents/{documentVersionId}, GET,POST /focus/sessions,
POST /focus/sessions/{id}/{pause|resume|complete|abandon},
PATCH /focus/sessions/{id}/workspace, GET,POST /focus/documents/{documentVersionId}/annotations.

**Routes:** Keep #/materials/:materialId/sheets/:sheetId entry; add #/focus/:documentVersionId only
when a learning object supplies focus_context. Both resolve to a single Focus screen.

**Reuse:** SheetStudy canvas/PDF chrome/toolbar, ConfirmDialog, current panels and responsive PDF CSS.
Keep appearance; replace fake state plumbing only.

**New reusable components/services:** FocusAccessState, FocusSessionController, WorkspaceAutosave,
AnnotationSyncQueue, ConflictRecoveryBanner and api/focus.js.

**State, permissions, and visual states:** Stable client_instance_id/idempotency UUID. Workspace
uses server revision; annotations use collection revision, pages query and batches no more than 100.
Unsynced actions may be explicit recovery data only, not claimed save/completion. Reconcile after 409.
Server session response is sole focus time/completion authority. Reuse current panels for document/
entitlement errors and show truthful saving/saved/conflict/offline state. Preserve desktop/tablet/
mobile geometry; do not rewrite PDF viewer.

**Acceptance criteria:** Server view_url is used after entitlement validation. No fake XP/page unlock/
completion/final quiz/local authoritative annotation save. Session/action/revision contracts work.
Annotation data is never unsafe HTML and private document/API data is not PWA cached. Denial is an
honest visually non-disruptive state.

**Tests:** 403 access, duplicate session start, workspace 409, annotation batching/pages, offline
failure/retry, complete flow, desktop/tablet/phone visual smoke and build.

**Likely files:** SheetStudy.jsx, Materials.jsx, optional Focus route extraction, api/focus.js,
Focus components/tests/CSS.

**Dependencies / out of scope:** Phases 0–2. No shared annotations, real time, client indexing, sheet quiz.

## Phase 5 — Motivation, rankings, and notification center

**Objective:** Make personal progression/notifications truthful and remove local fake metrics/actions.

**Features included:** XP/ledger, streak policy, achievements, ranking/privacy profile, notification
list/summary/read/open/read-all and preference editor.

**Roles and endpoints:** Authenticated user: GET /progression/xp, /xp/ledger, /streak,
/achievements, /rankings/current, GET,PUT /rankings/profile; GET /notifications,
/notifications/summary, GET,PUT /notifications/preferences, POST /notifications/{id}/read,
/open and /read-all.

**Routes:** Upgrade #/progress, #/achievements, #/ranked and header dropdown; add #/notifications
only if necessary. Keep #/analytics personal/unavailable until Phase 10; do not call operations API.

**Reuse:** Progress, Achievements, Ranked, StatsGrid, StreakCard, notification dropdown, Page,
ProgressLine, MiniFeature and existing state panels.

**New reusable components/services:** CursorFeed, XpLedgerList, StreakPolicyCard,
RankingPrivacyForm, NotificationCenter, NotificationPreferenceForm and domain APIs.

**State, permissions, and visual states:** Display snapshot/own entry as returned; remove fake
weekly/monthly copies. Profile PUT uses returned state. Notification open waits for server route and
handles 410. Remove local streak-freeze mutation: no consume endpoint exists. Keep existing cards and
phone nav; handle cursor, empty, target-gone, field-error and retry states.

**Acceptance criteria:** React never grants/calculates XP/streak/achievement/rank. No fake champion,
badge or frozen-streak state. Cursor notifications, reads, 410 and full preference-array payload work.
Device-local theme/reminder is not passed as notification preference.

**Tests:** Ledger paging, ranking privacy, disabled freeze, notification open/read-all, preferences,
empty/error/retry/mobile/keyboard and build.

**Likely files:** pages/Progress.jsx, Achievements.jsx, Ranked.jsx, Analytics.jsx, layout/constants,
motivation/notification APIs/components/tests.

**Dependencies / out of scope:** Phase 0. No ranking build, platform notice or operational analytics.

## Phase 6 — Contextual community and reporting

**Objective:** Convert generic Community to contextual discussions, comments, spaces and reporting.

**Features included:** Context discussion list/detail/create/edit/delete; comments; spaces/members
when can_manage; reporter submission/status; removal of fake likes/tags/announcements.

**Roles and endpoints:** GET,POST /community/discussions; GET,PATCH,DELETE
/community/discussions/{id}; GET,POST /community/discussions/{id}/comments; PATCH,DELETE
/community/comments/{id}; GET,POST /community/spaces; GET /community/spaces/{id};
POST,DELETE /community/spaces/{id}/members[/user_id]; GET,POST /moderation/reports;
GET /moderation/reports/{id}.

**Routes:** Preserve #/community; add #/community/context/:contextType/:contextId,
  #/community/discussions/:id and #/community/spaces/:id. Link valid learning/quiz context.

**Reuse:** Community, current post/list visual, Page/forms/buttons, ConfirmDialog, EmptyState,
drawer/theme.

**New reusable components/services:** CommunityContextHeader, DiscussionCard, DiscussionEditor,
CommentThread, SpaceMembers, ReportForm, CursorFeed and community/moderation APIs.

**State, permissions, and visual states:** Create uses client_request_id UUID; edit/delete uses
expected_revision. Render actions only for can_edit/can_delete/can_manage; server 403 is final.
Reset cursor on filter/context change. Reporter never assumes moderator evidence. Missing context is
non-postable. Use present panels for 429, 409, empty states and delete confirmation; avoid mobile
overflow.

**Acceptance criteria:** No unaffiliated post, likes/tags, fake announcement or fake success.
Context type/id are both supplied or omitted. Text stays escaped. Mutations refresh affected data and
handle rate/conflict. Visual identity remains replacement-native.

**Tests:** Context list/create, cursor, conflict, comments, space membership permissions, reporter
response, 429/403, phone/desktop and build.

**Likely files:** Community.jsx, discussion/space/report pages/components, api/community.js,
api/moderation.js, App/layout/tests/CSS.

**Dependencies / out of scope:** Phases 0–3. No moderator queue action, WebSockets or direct message.

## Phase 7 — Content-creator studio

**Objective:** Add creator hierarchy/content/files/questions/quizzes with scopes, ownership and
revision contracts.

**Features included:** Creator nav; node list/create/edit/move/status; own scope read; content
list/detail/create/edit/lifecycle/transfer; multipart file upload; question/quiz management.

**Roles and endpoints:** Creator/administrator plus server scope/ownership. All
/management/education/nodes endpoints, GET /management/education/scopes, /management/content
endpoints, POST /management/files, /management/questions endpoints and /management/quizzes endpoints.
Lifecycle uses expected_revision; reject requires review_note.

**Routes:** #/creator/education, #/creator/content, #/creator/content/:id,
  #/creator/questions, #/creator/questions/:id, #/creator/quizzes, #/creator/quizzes/:id.

**Reuse:** Shell, Page, forms/lists/buttons, ConfirmDialog, error/empty/loading panels and themes.

**New reusable components/services:** CreatorRoute, RevisionForm, WorkflowStatusChip,
LifecycleActions, ScopedNodePicker, FileUploadField, QuestionOptionsEditor, QuizQuestionPicker,
responsive PageTable and management API.

**State, permissions, and visual states:** Scope UI is advisory only; backend result controls action.
Use latest revision and reload after success/409. Show file validation/scan before use. Isolate correct
management answers from student assessment state. Empty means no access, not fake drafts; nested
errors map to options/files; tables collapse to existing mobile list style.

**Acceptance criteria:** Non-creators see neither data/form nor usable route. JSON/multipart payloads
match serializers and refresh after mutation. UI never claims authority outside scope. Correct answers
never appear in student route/cache.

**Tests:** Creator/admin/student guard, scope denial, workflow conflict, upload validation, option
limits, quiz contract, responsive form and build.

**Likely files:** pages/creator, components/creator, management API/contracts, App/layout/tests/CSS.

**Dependencies / out of scope:** Phases 0–2. Admin scope grant/revoke, moderation and operations are Phase 8.

## Phase 8 — Administrator, moderator, and operations-core workspaces

**Objective:** Deliver scoped privileged workspaces for product users/roles, creator scope grants,
moderation, operations core, ranking build and platform notice.

**Features included:** Admin product-user list/role assignment; creator scope grant/revoke; moderator
assign/transition/audit; operations session/resources/overview/content/support/system health;
operational user search/roles; platform notice; ranking build.

**Roles and endpoints:** Administrator: /admin/users, /admin/users/{id}/roles, scope POST/DELETE,
POST /notifications/platform-notices, POST /progression/rankings/{code}/build. Moderation:
POST /moderation/reports/{id}/assign and /transition, GET /moderation/audit. Operational:
GET /operations/session, /resources, /dashboards/overview, /content, /support, /system-health,
/users; PATCH /operations/users/{id}/roles requires operational_roles.manage and roles/reason.

**Routes:** #/admin/people, #/admin/creator-scopes, #/moderation,
  #/operations/{overview|content|support|users}. Operations nav comes from session/resources, not
product-role label alone.

**Reuse:** Existing shell/theme/mobile nav, Page/lists/ConfirmDialog/error/empty/loading panels.
Do not build a Django Admin clone.

**New reusable components/services:** AdministratorRoute, ModerationRoute,
OperationalCapabilityRoute, ServerResourceNav, UserDirectory, RoleEditor, ScopeGrantForm,
ReportQueue, RevisionActionPanel, OperationalDashboardPanel and APIs.

**State, permissions, and visual states:** Product roles and operational roles are distinct. Fetch
operations session first. Mutations with reason/revision/confirmation reload source. can_manage and
reporter/target conflicts remain backend authority. Use forbidden neutral state, mobile line/list
patterns and current confirmation UI.

**Acceptance criteria:** Privileged nav/routes/actions use current role/capability and safely handle
403. Product and operational role forms use different endpoints/payloads. Moderator conflict is
blocked; admin scope/ranking/notice action confirms/reloads. Health only shows redacted server data.

**Tests:** Mixed role matrix, admin denial, moderator conflict, operational capability matrix, P25
user search, role/revision mutation, mobile workspace and build.

**Likely files:** pages/admin, pages/operations, pages/moderation, API modules, App/layout/constants,
shared components/tests/CSS.

**Dependencies / out of scope:** Phase 0 and creator display from Phase 7. Finance/access and reporting/
configuration are later.

## Phase 9 — Catalogue, subscription, payments, and entitlements

**Objective:** Deliver truthful user access/billing and narrowly supported administrator financial/
access actions.

**Features included:** Product catalogue, current subscription/cancel, entitlement list/decision,
payment intent handoff, payment/invoice/refund history, admin refund/subscription transition/manual
grant.

**Roles and endpoints:** User: GET /catalog/products?region=, GET /subscriptions/current,
POST /subscriptions/current/cancel, GET /entitlements/me, /entitlements/me/{code},
POST /payments/intents, GET /payments, /invoices, /refunds. Admin: POST /admin/refunds,
POST /subscriptions/admin/{id}/transition, POST /entitlements/admin/grants.

**Routes:** Add #/subscription and admin-only #/admin/access / #/admin/finance. Focus may link to
entitlement decision but never become client-enabled.

**Reuse:** Profile/settings/account panels, Page/list rows, ConfirmDialog, state panels, mobile list
patterns.

**New reusable components/services:** PlanSummary, EntitlementList, CatalogueList, BillingHistory,
PaymentCheckoutButton, Money, IdempotentMutation, admin grant/refund forms, commerce API.

**State, permissions, and visual states:** Price is server data. Intent sends only price_id and
Idempotency-Key length 12+. Follow checkout only as returned; never declare success locally. Refetch
subscription/entitlements afterward. Admin controls require role/confirmation. checkout_available
false is disabled/pending. Format amount_minor with currency_exponent/currency, not assumed cents.
Histories are P25 with empty/error state.

**Acceptance criteria:** No coupons, orders, client price/entitlement or fake payment success.
Cancellation persists before UI updates. Idempotency, fields and paging are exact. Non-admin cannot
access money/access mutations.

**Tests:** Checkout unavailable, money format, intent/header, P25 histories, cancellation error,
entitlement decision, admin denial/success, mobile billing and build.

**Likely files:** Billing/admin-access pages/components, api/commerce.js, App/layout links/tests/CSS.

**Dependencies / out of scope:** Phase 0 plus Phase 8 guard. No provider/webhook, coupon/order or
speculative checkout form.

## Phase 10 — Operational analytics, audit exports, configuration, and action preview

**Objective:** Complete remaining server operational tools with capability gates and two-step server
confirmation.

**Features included:** Analytics series, audit filters, report catalogue/preview/CSV export,
configuration list/update, operational action preview/execute.

**Roles and endpoints:** GET /operations/analytics needs analytics.view; GET /operations/audit needs
audit.view; GET /operations/reports, POST /operations/reports/previews and
POST /operations/reports/{id}/execute need reports.export; GET/PATCH /operations/configuration needs
configuration view/manage; action preview/execute needs operational_actions.execute. Finance metrics
are server-filtered by payments capability.

**Routes:** Extend operations: #/operations/analytics, /audit, /reports, /configuration and /actions.
Do not make student #/analytics a privileged operations route.

**Reuse:** Existing analytics visual motifs only where suitable, Page/panels/lists/forms,
ConfirmDialog, ErrorPanel, LoadingPanel and responsive shell.

**New reusable components/services:** OperationalDateRange, MetricSelector, AuditFilterList,
ReportPreviewConfirm, CsvDownload, ConfigurationEditor, ActionPreviewConfirm and operations API.

**State, permissions, and visual states:** Query uses from, to, repeated metric, with max 367 days.
Preview first; confirmation token stays transient component state then execute. Config sends server
version as expected_version and reason. Tokens/secrets never go in URL, storage, telemetry or logs.
Fresh 403 is neutral. Missing finance metrics are not zero-filled. Dense data follows mobile detail
patterns.

**Acceptance criteria:** Matching server capability guards nav/route/action. Analytics filters, audit
P25, CSV, configuration revision and preview/execute contracts work. No destructive success before
execute response. Student analytics has no privileged/fabricated data.

**Tests:** Capability matrix, date/filter validation, audit page, report binary, config conflict,
one-time action token, desktop/mobile operations and build.

**Likely files:** Operations API/pages/components/tests, App/layout/nav and minimal CSS.

**Dependencies / out of scope:** Phase 8. No backend catalog/configuration/role changes.

## Phase 11 — Full regression, security, and visual-integrity approval

**Objective:** Verify every phase against real Django and prove backend source/config/tests/migrations
were untouched and current visual identity was preserved.

**Features included:** No product feature. Cross-role direct-route/auth/CSRF, ownership, revision/
idempotency, files/uploads/exports, filters/pagination/validation, responsive/theme, PWA private
cache and Git scope audit.

**Roles/endpoints:** Visitor, student, creator, moderator, administrator and operational-capability
user where demo data permits. Exercise each implemented matrix endpoint through its frontend route.

**Routes:** All implemented routes/deep links; no new route.

**State/visual checks:** Check each loading, empty, error, retry, disabled, forbidden, pending-release
and entitlement state in current themes and phone/tablet/desktop breakpoints.

**Acceptance criteria:** Lint, contract/type checks, frontend tests and production build pass. Real
flows verify login/logout/CSRF, protected routes, files/progress, assessment integrity, Focus
entitlement, scoped management, notifications, commerce and operations. Browser storage never holds
session token, correct answers, confirmation token, entitlement grant, server score or secret; private
responses are not cached. Visual screenshots show the replacement rather than legacy UI, no overflow
or console error. Git diff check and name-only output confirm no backend file changed; run Django
manage.py check read-only.

**Tests:** Full automated suite, manual browser pass, Django system check, diff inspection and review
protocol evidence.

**Likely files:** Frontend tests/config/package scripts, frontend/reviews and phase reports only.

**Dependencies / out of scope:** All approved phases. Stop after corrections/approval; add no new product.
