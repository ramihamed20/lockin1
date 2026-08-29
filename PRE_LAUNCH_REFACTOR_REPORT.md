# Pre-Launch Refactor Report

**Project:** Lock-in university study platform  
**Review date:** 2026-08-14  
**Scope:** React/Vite PWA, Django/DRF API, PostgreSQL integration, authentication and authorization, deployment, responsive UI, accessibility, tests, dependencies, and release configuration.

## Executive Summary

Lock-in remains a modular monolith: a route-split React 18 client talks to a versioned Django REST API through same-origin, CSRF-protected sessions, while Django owns authorization, academic content, assessments, community, progression, moderation, subscriptions, entitlements, operations, and audit records. PostgreSQL is the production database and Nginx/Gunicorn are the production edge/runtime.

The pre-launch pass fixed concrete correctness, security, accessibility, PWA, responsive, and deployment defects instead of replacing the established architecture. Placeholder workspaces were connected to existing server APIs, dead implementations were removed, the profile interaction was rebuilt as a viewport-safe responsive component, error handling was consolidated, private API data was removed from service-worker caching, production configuration was made fail-closed, and the quality gates were widened.

No known code-level launch blocker remains for the currently declared production contract: paid checkout is disabled until a real payment adapter exists, and unscanned file ingestion remains fail-closed until an approved scanner is connected. The exact release still has to pass the repository's mandatory PostgreSQL/container/staging gates and receive real TLS, SMTP, legal, scanner, monitoring, and backup evidence. Those are release-environment conditions, not facts that can be proven on this workstation.

**Final verdict: READY WITH NON-BLOCKING FOLLOW-UP WORK**, subject to the release conditions above.

## Changes Made

### Architecture

- Preserved the modular-monolith boundary and server-authoritative business rules.
- Centralized route metadata, document titles, page identity, localized shell strings, normalized user-facing errors, and lazy-route recovery.
- Replaced deferred subscription and moderation workspaces with real API-backed routes.
- Integrated the existing entitlement inspector into the operations experience instead of keeping a duplicate/deferred surface.
- Kept Focus/PDF rendering isolated from the general application shell and retained its server-owned session, revision, and annotation contracts.

### Components

- Rebuilt the account/profile interaction as a top-layer responsive component:
  - phone: a compact side action panel with backdrop, scroll lock, safe-area padding, focus trap, Escape/tap-outside dismissal, and swipe dismissal;
  - iPad/tablet: a touch-sized anchored popover that repositions inside the viewport;
  - desktop: a compact anchored popover with improved hierarchy and focus/pressed states.
- Added a compact identity header, graceful name/email truncation, navigation chevrons only for routed actions, and visual separation for sign-out.
- Corrected confirmation-dialog backdrop semantics and focus behavior.
- Strengthened the application error boundary and lazy-chunk recovery path so failures do not produce a blank screen or reload loop.
- Added explicit install and service-worker update prompts without inventing unsupported PWA behavior.
- Added responsive mascot and theme-preview components that select appropriately sized assets.

### Hooks

- Added shared media-query and visibility hooks for responsive rendering and time-sensitive UI.
- Corrected stale callback/effect dependencies and cleanup in account-menu gesture, focus, and dismissal behavior.
- Kept async loading/error ownership inside the existing shared data hook rather than adding another state system.

### Services and API

- Consolidated requests through the same-origin API client, including safe path validation, CSRF bootstrap, JSON/multipart behavior, 204 handling, Django error envelopes, and authentication-state invalidation.
- Added real billing/subscription API bindings and real moderation assignment/transition/audit calls.
- Fixed capability-based operations authorization so a valid operational capability is not rejected merely because a product role is absent.
- Fixed optional platform notices: a recipient who disabled that category now produces an intentional `202 Accepted` response instead of reaching an assertion and returning a 500.
- Replaced production assertions on authenticated-user and persisted-version assumptions with explicit typing, guards, or domain errors.
- Preserved server-side ownership for grades, XP, rankings, entitlements, roles, moderation, and payment state.

### Styling

- Consolidated responsive shell behavior around shared tokens, safe areas, viewport-attached navigation, touch targets, and overlay layers.
- Corrected profile-panel stacking and clipping by using the browser top layer and viewport-aware sizing.
- Added phone, tablet, landscape, and wide-desktop rules without changing the established visual identity.
- Added pressed, hover, focus-visible, reduced-motion, RTL, truncation, and safe-area states for the account interaction.
- Removed remote font dependence and retained a system-font stack compatible with the production CSP.

### Responsive

- Eliminated horizontal overflow in the tested shell and major routes from 320px through 1440px.
- Kept the phone navigation, account panel, dialogs, forms, cards, and immersive workspaces inside safe viewport bounds.
- Preserved iPad portrait/landscape spacing and touch target sizes instead of applying compact desktop controls.
- Prevented background scrolling while the phone account panel is open and restored it after every dismissal path.

### Performance

- Kept route-level code splitting and recovered stale lazy chunks safely.
- Added intrinsic dimensions and responsive AVIF/WebP sources for large mascot, theme, and store artwork.
- Kept PDF work virtualized and its worker separate from the main application chunk.
- Added immutable caching for fingerprinted static assets while keeping the service worker and manifest revalidatable.
- Enforced a bundle budget in local scripts and CI.

### Security

- Retained same-origin session authentication with CSRF enforcement and server-side protected routes.
- Confirmed that client role/capability checks are presentation guards, not the authorization boundary.
- Hardened production cookies, proxy trust, HTTPS/HSTS, host/origin validation, secret-file loading, file-scan gating, and least-privilege PostgreSQL runtime-role checks.
- Added/validated CSP, frame denial, content-type protection, referrer policy, permissions policy, COOP, and CORP at Nginx.
- Removed API runtime caching and legacy private caches from the service worker.
- Added Ruff security rules to the normal backend lint gate with narrow test/development exceptions; production assertions were removed.
- Confirmed no hard-coded private key, common cloud key, or OpenAI-style secret pattern in the reviewed source tree.
- Kept uploads private, type/size/signature checked, and unusable in production until clean malware-scan evidence exists.

### Accessibility

- Added correct menu/dialog semantics according to breakpoint, `aria-expanded`, `aria-controls`, `aria-modal`, accessible names, and identity descriptions.
- Verified Escape dismissal, focus trapping on phone, visible focus states, focus restoration to the avatar, and keyboard-safe controls.
- Kept touch targets at least 44px and tablet action rows larger than compact desktop rows.
- Added/retained a skip link, semantic buttons, form labels, autocomplete hints, loading/error announcements, and reduced-motion support.
- Corrected the dialog backdrop from a non-semantic clickable element to a real button.

### Build and Configuration

- Standardized Node `24.16.x` and pnpm `11.19.0`; retained a single pnpm lockfile and removed the stale npm lockfile.
- Added separate development and production frontend Dockerfiles.
- Made production frontend builds reject missing/placeholder support, legal, policy, and immutable release values.
- Corrected development Compose proxy/port behavior and production immutable image tags.
- Added Nginx SPA fallback and cache rules without dropping inherited security headers.
- Strengthened CI with PostgreSQL 18.4, Python dependency audit, production owner/runtime-role gates, frontend quality/build/bundle checks, Chromium regression, Docker image builds, Nginx validation, Compose validation, and an aggregate fail-closed job.
- Made the Windows quality script fail immediately when any native command returns a non-zero exit code.
- Verified that the Python project builds as a wheel under its declared build-system constraints.

### Dependencies

- Upgraded React Router to the current reviewed v7 line and adapted the application without changing route behavior; this removed the advisories reported against the previous production dependency graph.
- Added `workbox-window` as a runtime dependency because the update UI imports it through `virtual:pwa-register/react`.
- Added pinned backend auditing/static-analysis tooling to the development dependency group.
- Removed the duplicate npm lockfile and kept package-manager/runtime versions explicit.
- Final production dependency audits reported no known vulnerabilities for both pnpm and Python.

## Removed Code

- Removed the unreachable second Lock-in render path and its duplicate session timer.
- Removed the obsolete Mandible study sheet and the default legacy sheet-study branch while retaining the active Focus PDF workspace.
- Removed the fabricated seeded team-chat UI and unused setup/deferred workspace shells.
- Removed the unused quiz-card component and obsolete API compatibility layer.
- Removed debug logging and temporary Playwright/database/build artifacts.
- Removed the tracked stale `package-lock.json` so pnpm is the only frontend package source of truth.
- Avoided deleting code merely because it was large; active PDF/Focus code was retained after usage and behavior checks.

## Major Refactors

### 1. Responsive account interaction

The former dropdown mixed phone, tablet, and desktop behavior and could render behind the application shell. The replacement uses one behavior model with breakpoint-specific presentation. Phone presentation is a safe-area-aware side panel; tablet and desktop use an anchored top-layer popover. Focus, scroll, Escape, outside click, and swipe lifecycles are owned in one component, which removes competing z-index and dismissal implementations.

### 2. Route, metadata, localization, and failure ownership

Route labels, titles, and public/private metadata now have a shared source. User-facing errors are normalized before rendering, lazy-route failures have bounded recovery, and the root error boundary offers an intentional recovery path. English/Arabic shell messages and direction changes remain centralized.

### 3. PWA lifecycle and caching

Installation and update prompts are explicit. A new worker waits until the user accepts the update, supports `SKIP_WAITING`, and deletes legacy private caches. The worker precaches only the shell/fingerprinted entry assets and never runtime-caches `/api/` responses or authenticated material.

### 4. Real subscription, moderation, and operations behavior

Deferred screens were replaced with existing Django contracts. Operations capability access was corrected, and entitlement inspection was consolidated into the active administration surface. No fake billing provider or client-owned moderation state was introduced.

### 5. Production release path

Build/runtime versions, environment inputs, proxy behavior, immutable image tags, owner/runtime database roles, Nginx headers/cache rules, release/preflight commands, and CI now form one fail-closed release path instead of relying on local development defaults.

## Bugs Fixed

- Profile UI appearing behind the shell or outside the viewport.
- Phone page scrolling while the profile panel was open.
- Missing focus trap/restoration and inconsistent Escape/outside-click behavior.
- Swipe dismissal not following the panel's side/direction reliably.
- Operations users with a valid capability being rejected by a product-role-only check.
- Optional platform notifications causing a production assertion/500 when disabled by the recipient.
- Production code relying on `assert` for authenticated users or required persisted versions.
- Service-worker updates activating eagerly and private legacy caches surviving upgrades.
- Potential caching of authenticated API responses.
- Lazy chunk recovery retrying without a bounded, versioned recovery marker.
- Confirmation-dialog backdrop using incorrect interactive semantics.
- Authentication/reset inputs missing relevant autocomplete hints.
- Duplicate Arabic translation keys found by the final type check.
- A React image-priority property warning found in the browser console.
- Quality scripts continuing after a failed child process.
- Development Compose proxying the frontend API to the wrong host/port contract.
- Placeholder production legal/version values being accepted during image builds.

## Verification

All results below were produced during this refactor; no result is inferred from an older report.

### Frontend automated checks

| Check | Result |
|---|---|
| `pnpm run lint` | Passed with zero warnings/errors. |
| `pnpm run typecheck` | Passed for application JSX/JS and the service worker. |
| `pnpm run test` | **62 passed, 0 failed**. |
| Production Vite/PWA build | Passed; Vite 6.4.3 transformed **1,688 modules**. |
| PWA generation | Passed; inject-manifest generated the worker and precached **13 entries / 678.60 KiB**. |
| Bundle budget | Passed; main application JS **98.1 KiB gzip**, main CSS **54.5 KiB gzip**. |
| `pnpm audit --prod` | Passed: **No known vulnerabilities found**. |
| Production-bundle Playwright test | **1 passed** in Chromium; public legal/support routes work without authentication. |

### Backend automated checks

| Check | Result |
|---|---|
| Ruff (including security rules) | Passed. |
| Ruff format check | Passed; **442 files already formatted**. |
| Strict mypy | Passed for **378 source files**. |
| Full pytest suite | **208 passed, 2 skipped** (PostgreSQL-only), 0 failed. |
| Coverage gate | Passed at **85.03%** against an 85% requirement. |
| Notification regression suite | **4 passed**, including disabled optional platform notices. |
| Migration drift | Passed: **No changes detected**. |
| Django system check | Passed: **0 issues** in the local test configuration. |
| Django production deploy check | Exited 0 at `--fail-level ERROR`; no errors. It reports 121 non-fatal schema/HSTS warnings described under technical debt. |
| Python dependency audit | Passed: **No known vulnerabilities found**. |
| Python wheel build | Passed; `lockin_backend-0.1.0-py3-none-any.whl` was built successfully. |

### Real-browser and responsive verification

An authenticated, Django-backed browser session was tested against the local application. The account component and major product routes were inspected rather than relying only on static analysis.

- Viewports checked: **320×700, 375×812, 390×844, 430×932, 640×900, 768×1024, 820×1180, 1024×768, 1280×800, and 1440×900**.
- No document/body horizontal overflow was observed at any tested width.
- Phone account panel at 375×812: stayed inside the viewport, used dialog semantics, locked background scrolling, exposed a 44×44 close target, trapped focus, closed on Escape/outside interaction, and returned focus to the avatar.
- Swipe dismissal closed the phone side panel and restored page scrolling/focus.
- iPad portrait: the anchored popover measured 280px wide, remained inside the viewport, and provided approximately 54px navigation rows.
- iPad landscape and 1024×768: the popover repositioned without clipping.
- Desktop: the anchored profile popover remained compact, connected to the avatar, and closed with Escape while restoring focus.
- Route smoke test passed for Dashboard, Materials, Questions, Review, Community, Store, Profile, Settings, Subscription, Lock-in, and Not Found; titles/headings were meaningful and no route overflow or page exception appeared.
- A console listener attached before the final Store navigation observed **zero new console errors** after the image-property fix.
- Expected anonymous/student authorization responses were handled without a React exception or blank screen.

### Verification limitations

- Docker, a local PostgreSQL server, and `psql` were unavailable on this workstation. PostgreSQL concurrency, owner/runtime role enforcement, Docker images, Nginx syntax, TLS mounting, and Compose resolution are enforced by CI and must pass for the exact release commit.
- The full local backend suite used SQLite; the two PostgreSQL-only checks were skipped locally by design.
- Real SMTP delivery, malware scanner efficacy, monitoring/alert destinations, and backup restoration require production-equivalent external systems.

## Remaining Technical Debt

| Severity | Item | Impact and required follow-up | Launch disposition |
|---|---|---|---|
| Critical | None known | No unresolved code defect was found that can bypass the declared production safety gates. | No blocker. |
| High | Exact-commit PostgreSQL/container/staging evidence | Run the mandatory CI quality gate, production release/preflight, TLS/Nginx/Compose validation, backup restore drill, and operational smoke checks with the immutable release identifier. | Required release procedure; not a missing code implementation. Do not deploy if it fails. |
| High | Malware-scanner provider before enabling production ingestion | The repository intentionally cannot certify arbitrary uploads as clean. Production is fail-closed, so pending files cannot be published/delivered. Connect an approved scanner, authenticate its evidence, alert on backlog/failure, and test quarantine/retry behavior. | Safe to launch only with ingestion disabled or with verified clean preloaded material; required before creator uploads are enabled. |
| Medium | OpenAPI/schema annotation debt | `drf-spectacular` reports serializer inference and operation-ID warnings for many plain `APIView` classes. API docs are disabled in production, and runtime endpoints/tests are unaffected, but reviewed schema publishing would require explicit serializers/annotations and enum-name overrides. | Non-blocking for the private runtime API. |
| Medium | CSS monolith and specificity debt | The active stylesheet remains large and contains many historical overrides/`!important` rules. A broad rewrite was avoided because it would create visual regression risk. Continue component-by-component extraction with visual baselines. | Non-blocking; tested viewports are stable. |
| Medium | Provider-backed payments | Production correctly forces `PAYMENT_PROVIDER=none`; subscription/entitlement display is real, but checkout must remain unavailable until a reviewed provider adapter, webhook secrets, reconciliation, refund, and financial operations are validated. | Non-blocking if monetization is not enabled at launch; blocking for paid checkout. |
| Medium | Limited offline product scope | The PWA safely caches only its shell/static assets. Authenticated study/API data is intentionally not available offline. A future offline feature needs an explicit encrypted/private-data and conflict-resolution design. | Intentional safe limitation. |
| Low | HSTS preload is off | HSTS is enabled with a conservative rollout value; preload should be enabled only after domain/subdomain ownership and long-term HTTPS guarantees are approved. | Non-blocking and safer than premature preload. |
| Low | Styling/source-file size | `styles.css`, responsive rules, and a few Focus/operations components are still large. Further separation is useful only with focused interaction and screenshot coverage. | Maintainability follow-up. |

## Launch Readiness

| Area | Rating | Rationale |
|---|---:|---|
| Architecture | **8.8/10** | Clear modular-monolith/domain boundaries and server authority; some large management/Focus surfaces remain. |
| Code Quality | **8.7/10** | Lint, strict typing, security rules, dead-code cleanup, and explicit errors pass; schema annotations remain incomplete. |
| Maintainability | **8.3/10** | Shared routing/errors/i18n/API behavior improved ownership; CSS remains the largest debt. |
| Security | **9.0/10** | Fail-closed sessions, CSRF, authorization, headers, secrets, scan gates, DB roles, and clean dependency audits; external scanner evidence is still required before ingestion. |
| Performance | **8.7/10** | Route splitting, responsive images, virtual PDF rendering, static caching, and bundle budgets are in place. |
| Responsive Quality | **9.3/10** | Phone through wide desktop and both iPad orientations passed overflow and account-menu checks. |
| Accessibility | **8.9/10** | Semantic dialogs/menus, keyboard/focus behavior, touch targets, safe areas, RTL, and reduced motion are covered; a formal assistive-technology session remains useful. |
| Reliability | **8.9/10** | 270 frontend/backend tests passed plus the browser regression; error states are explicit and release gates fail closed. |
| Production Readiness | **8.6/10** | Source/build/runtime configuration is ready; exact-commit infrastructure and external-provider evidence remain mandatory. |

## Final Verdict

**READY WITH NON-BLOCKING FOLLOW-UP WORK**

The application is reasonable to release under its declared safe feature set: authenticated study, assessment, community, progression, moderation, subscription/entitlement visibility, and operations. No paid checkout may be advertised or enabled while `PAYMENT_PROVIDER=none`, and production file ingestion must remain disabled until a real scanner is proven. Before traffic is sent to the release, the exact immutable commit must pass the mandatory PostgreSQL/container CI and production-equivalent deployment checklist with real TLS, SMTP, monitoring, legal/policy, backup/restore, and scanner decisions.

The highest-value follow-ups are the production scanner integration, exact-commit staging/recovery evidence, and incremental CSS/schema cleanup. Marketing-site SEO features remain intentionally irrelevant to this authenticated private application; private routes must stay `noindex`, excluded from a sitemap, and protected by server authorization.
