# Dentify Frontend Visual & Technical Audit

**Audit date:** 10 August 2026  
**Audit type:** Inspection and analysis only  
**Code changes:** None  
**Audited application:** React/Vite frontend in `frontend/`

## Executive Summary

Dentify already has a distinctive, coherent visual identity and a much better mobile shell than a typical desktop-first dashboard. The edge-to-edge phone header, compact bottom navigation, tablet rail, desktop sidebar, iOS safe-area handling, focus styling, semantic labels, and interactive mobile drawer are all strong foundations.

The application is not yet release-ready as a fully dependable mobile/iPad product. Three issues are critical: the Settings section navigation breaks the HashRouter route, stale PWA clients can fail to load newly deployed lazy chunks, and Profile displays fabricated fallback achievements/ranking values when server data is absent or legitimately zero. The most important responsive weaknesses are the phone Focus Workspace, 320px reflow, over-collapsed tablet layouts, very long mobile pages, and small chart/toolbar targets. The largest technical risk is the CSS architecture: approximately 362 KB of source CSS is split across two global cascade layers with 58 media-query blocks and 246 `!important` declarations.

### Overall verdict

- **Responsive shell:** Strong and intentionally designed.
- **Phone content experience:** Functional on most routes, but several data-dense pages are too long or depend on small/horizontally scrolling controls.
- **Tablet experience:** Stable, but frequently behaves like a stretched phone instead of an intentional intermediate layout.
- **Accessibility:** Good semantic baseline and focus visibility; touch sizing, reflow, chart keyboard burden, contrast, and menu focus behavior need work.
- **Frontend architecture:** Route-level lazy loading is good, but global CSS and several very large page components are costly to maintain.
- **Anti-pattern verdict:** Some noticeable generic dashboard patterns remain—especially nested translucent cards, repeated oversized radii, and card-wall layouts—but the product does not feel visually generic overall.

## Scope and Method

### Project understanding

- React 18.3 with React Router 6 `HashRouter` and route-level `lazy()` imports.
- Vite 6 with `vite-plugin-pwa`, Workbox precaching, and a custom runtime asset cache.
- Styling is primarily global CSS: `src/styles.css` plus the later-loaded `src/responsive.css`, with additional page CSS for immersive workspaces.
- Reusable shell components provide the sidebar, tablet rail, top bar, mobile drawer, bottom navigation, account menu, notifications, page shell, loading/error states, and shared buttons/cards.
- The design system uses a premium dark study identity with gold/purple accents, theme/character variants, safe-area variables, spacing/radius/motion tokens, and RTL direction switching.
- More than 45 protected route patterns were inventoried, including student, creator, operations, community, assessment, store, profile, settings, and immersive study routes.

### Browser/device coverage

The UI was run against live local frontend/API data and a stable preview. It was manually resized between breakpoints and tested at:

- **Phones:** 320×568, 360×800, 375×812, 390×844, 393×852, 412×915, 430×932.
- **Tablet portrait:** 640×960, 768×1024, 810×1080, 820×1180, 834×1194.
- **Tablet landscape / compact laptop:** 900×1024, 1024×768, 1080×810, 1180×820, 1194×834, 1199×900.
- **Desktop:** 1200×900 and 1440×1000.
- Continuous resizing was performed around 639/640, 899/900, 1199/1200, and 1439/1440.

### Routes and interactions covered

Authenticated student routes tested with real data included Dashboard, Materials, catalog sheets, sheet landing, Focus Workspace, Lock In, Search, Questions, Quiz Detail, Review, Community, Ranked, Bookmarks, Progress, Achievements, Notifications, Store, Profile, and Settings. Authentication was checked in Arabic and English at phone and tablet sizes. Drawer full drag, partial drag/snap-back, vertical scrolling, backdrop dismissal, focus return, background inertness, body locking, and destination dismissal were exercised.

Assessment submission/start actions and account-changing saves were deliberately not triggered because this audit is read-only. Creator/operations routes were source-audited because the demo student account did not have those permissions.

### Automated/static checks

- ESLint: passed.
- TypeScript phase configuration: passed.
- Test suite: 50 passed, 1 failed.
- Static checks covered route structure, media queries, hardcoded dimensions/directions, focus semantics, image sizes, event/timer usage, error boundaries, PWA caching, localization, and component size.

## Confirmed Strengths

- The top bar is flush with the viewport on all tested sizes; the phone header is flush left/right/top and the phone bottom navigation is flush left/right/bottom.
- The tablet rail and desktop sidebar remain flush with the physical viewport edge and do not cover main content.
- No document-level horizontal overflow appeared from 360px upward on the primary shell/routes tested.
- The phone bottom navigation is approximately 53px high and preserves compact, understandable primary destinations.
- The mobile drawer is approximately 87vw at 320px, preserves visible backdrop, follows the finger during drag, fades its backdrop proportionally, snaps back after a partial drag, and allows vertical scrolling without accidental dismissal.
- Drawer accessibility is strong: focus enters the close control, background regions become inert/hidden, Escape is supported, focus returns to the launcher, and reduced motion is addressed.
- Auth language switching correctly updates `lang` and `dir`; the Arabic login layout is visually coherent at normal phone widths.
- Core pages use real headings, landmarks, native form controls, named icon buttons, skip navigation, and highly visible focus rings.
- Materials, Questions, Quiz Detail, Community, and the iPad Focus Workspace generally preserve the intended brand and content hierarchy well.

## Issue Register

### FVT-001 — Settings section links break application routing

- **Category:** Critical Functional / Navigation
- **Page / Component:** `/settings` — `.settings-local-nav`
- **Device / Width:** All devices; reproduced at 390px
- **Severity:** **Critical (P0)**
- **Problem:** Selecting Character, Themes, Reminder, or Account changes `#/settings` to a bare fragment such as `#settings-account`. With `HashRouter`, the application interprets that as a route change and redirects to `#/` (Dashboard).
- **Root Cause:** `src/pages/Settings.jsx:73` uses raw `href="#settings-*"` anchors inside a hash-routed application.
- **Why It Matters:** Users are unexpectedly removed from Settings, lose their scroll/context, and cannot use the local navigation reliably.
- **Recommended Fix:** Use router-safe section state: buttons that call `scrollIntoView()` and move focus, or a route-preserving query such as `#/settings?section=account`. Preserve back/forward behavior without replacing the router hash.

### FVT-002 — A stale PWA client can crash on a missing lazy chunk

- **Category:** Critical Functional / PWA / Error Recovery
- **Page / Component:** Application bootstrap and all lazy routes
- **Device / Width:** All devices; reproduced on the live local client
- **Severity:** **Critical (P0)**
- **Problem:** An authenticated client initially loaded an older entry bundle and attempted to import a deleted Dashboard chunk. The shell displayed `Failed to fetch dynamically imported module...` through the ErrorBoundary. A manual reload recovered to the current build.
- **Root Cause:** Open/stale entry bundles can reference no-longer-retained content-hashed chunks. `skipWaiting()`, `clientsClaim()`, auto-update, and cache-first optional JS/CSS caching do not provide an atomic client/chunk upgrade handshake. The ErrorBoundary only resets React state and exposes the raw technical error.
- **Why It Matters:** A normal deployment can strand active mobile/PWA users on a broken screen until they know to reload. This is especially damaging in standalone installed mode.
- **Recommended Fix:** Retain previous hashed assets for at least one release window or deploy atomically; add a single guarded recovery reload for chunk-load failures; show a human message with an explicit “Update and reload” action; coordinate service-worker activation with the app; version/clean the runtime asset cache deliberately.

### FVT-003 — Profile renders fabricated achievement and ranking data

- **Category:** Critical Functional / Data Integrity / Trust
- **Page / Component:** `/profile` — overview and Academy Rank
- **Device / Width:** All devices
- **Severity:** **Critical (P0)**
- **Problem:** Missing or zero-valued server fields are replaced with believable fixed values such as `384h 20m`, 63 days, 1,248 reviews, rank 241, 8,240 points, and 36 evidence items.
- **Root Cause:** `src/pages/Profile.jsx:97-112` uses `value || hardcodedFallback`, which also replaces legitimate numeric zero values.
- **Why It Matters:** The interface presents unsupported performance claims as factual. That violates the product’s evidence-first promise and can materially mislead users.
- **Recommended Fix:** Remove fabricated production fallbacks. Distinguish loading, unavailable, zero, and real server values; use nullish checks (`??`) only where a neutral default is valid; render “Unavailable” or an explanatory empty state when evidence is missing.

### FVT-004 — Phone Focus Workspace has overflowing actions and undersized tools

- **Category:** Visual Bug / Mobile / Accessibility
- **Page / Component:** `/materials/catalog/:material/sheets/:sheet/workspace`
- **Device / Width:** 320–430px; measured at 390×844
- **Severity:** **High (P1)**
- **Problem:** The selected-text action bar measured 297px client width versus 418px scroll width, visibly clips actions, and renders a native horizontal scrollbar. The document toolbar also overflows slightly. Most top/annotation controls are 36–38px and color swatches are 20px.
- **Root Cause:** `catalog-focus-workspace.css` uses `width: max-content`, fixed 78–88px action minimums, horizontal overflow, and fixed 20/36/38px control sizes.
- **Why It Matters:** Important study actions are hidden, the active document feels cramped, and repeated precision taps are difficult on a phone.
- **Recommended Fix:** Convert phone selection actions into a compact anchored sheet or 2×N action grid with priority actions plus “More”; keep every actionable target at least 44px; allow the toolbar to group/collapse by task rather than expose a scrollbar; preserve the document as the primary surface.

### FVT-005 — The 320px layout fails true reflow

- **Category:** Responsive / Accessibility
- **Page / Component:** Global shell and authentication
- **Device / Width:** 320×568 and narrow/zoomed desktop reflow
- **Severity:** **High (P1)**
- **Problem:** At a 320px viewport with a classic 15px scrollbar, the content viewport becomes 305px while the document remains 320px wide. A horizontal scrollbar appears and the RTL auth panel shifts partly off-screen.
- **Root Cause:** `src/styles.css:228` forces `body { min-width: 320px; }`.
- **Why It Matters:** The smallest required phone width and WCAG-style zoom/reflow scenarios cannot fit without two-dimensional scrolling.
- **Recommended Fix:** Remove the body minimum width; enforce `min-inline-size: 0` on grid/flex descendants; clamp phone padding and long content; verify at 320px with non-overlay scrollbars and at 200% zoom.

### FVT-006 — Tablet layouts over-collapse into long phone-like pages

- **Category:** iPad / Tablet UX / Breakpoint
- **Page / Component:** Dashboard, Settings, Profile, Questions, Progress
- **Device / Width:** 640–899px, especially 768–834px portrait
- **Severity:** **High (P1)**
- **Problem:** Important areas are forced to one column across the entire tablet range. At 834px, Dashboard was about 2,585px tall, Profile 2,852px, Progress 2,149px, and Settings 4,664px. Character cards stack into roughly 873px and the account section into more than 2,100px despite 707px of usable content width.
- **Root Cause:** Broad tablet rules in `responsive.css` collapse profile hero/detail grids and related layouts to `1fr`; earlier global CSS also carries overlapping max-width rules.
- **Why It Matters:** iPad space is underused, scanning slows down, and tablet feels like a stretched phone instead of an intentional intermediate experience.
- **Recommended Fix:** Introduce component/container breakpoints: retain two-column character/profile/form groupings where cards remain at least 280–320px; use asymmetric primary/secondary columns in landscape; keep only dense linear tasks single-column.

### FVT-007 — Installed PWA is locked to portrait

- **Category:** iPad / PWA / Responsive Architecture
- **Page / Component:** Web app manifest
- **Device / Width:** Installed phone/tablet PWA, especially iPad landscape
- **Severity:** **High (P1)**
- **Problem:** Browser landscape layouts work, but the manifest declares `orientation: "portrait"`.
- **Root Cause:** `frontend/vite.config.js:30` hardcodes portrait orientation.
- **Why It Matters:** Installed users cannot use the carefully designed tablet landscape/desktop-like workspace, including document study modes where landscape is particularly useful.
- **Recommended Fix:** Use `orientation: "any"` or omit the lock; verify rotation and safe areas in installed iOS/iPadOS and Android modes.

### FVT-008 — Profile activity grid creates tiny targets and excessive tab stops

- **Category:** Accessibility / Data-Dense UI
- **Page / Component:** `/profile` — Study Activity heatmap
- **Device / Width:** Phone and tablet; approximately 20×13px on phone and 43×18px at 834px
- **Severity:** **High (P1)**
- **Problem:** The 13-week activity visualization renders roughly 91 daily buttons plus another 21-day grid, producing more than 100 tiny interactive targets and tab stops.
- **Root Cause:** Every heatmap cell is implemented as a native button; mobile CSS reduces minimum height to 13px (`styles.css:12907`).
- **Why It Matters:** Touch selection is impractical, keyboard traversal is exhausting, and screen-reader navigation becomes noisy.
- **Recommended Fix:** Use one focusable chart with roving keyboard selection, or focus by week with arrow-key day navigation. Provide an accessible table/list alternative and a detail summary for the selected cell; do not simply enlarge 112 independent buttons.

### FVT-009 — Store phone UI is excessively long and purchase targets are too small

- **Category:** Mobile UX / Accessibility
- **Page / Component:** `/store` — add-ons, catalogue, cart actions
- **Device / Width:** 320–430px; page measured about 6,753px at 390px
- **Severity:** **High (P1)**
- **Problem:** Add-ons become a very long single-column sequence and the repeated purchase icon buttons are 36×36px. Category and cart surfaces add further vertical density.
- **Root Cause:** The add-on grid collapses to one column below 500px and `styles.css:11455-11460` fixes purchase controls at 36px.
- **Why It Matters:** Shopping requires excessive scrolling and small repeated targets invite accidental purchases/misses.
- **Recommended Fix:** Use compact two-column add-ons where 320px still permits readable cards, or horizontally paged/category sections with a clear item detail; make the full purchase affordance at least 44px; retain a compact sticky category control without stacking every catalogue section at once.

### FVT-010 — Several mobile pages become unnecessarily long

- **Category:** Mobile UX / Information Architecture
- **Page / Component:** Settings, Store, Profile, Progress, Notifications, Dashboard
- **Device / Width:** 360–430px
- **Severity:** **High (P1)**
- **Problem:** At 390px, Settings was about 6,532px, Store 6,753px, Profile 3,419px, Notifications 2,641px, Progress 2,538px, and Dashboard more than 2,200px. Content technically fits but important sections are buried.
- **Root Cause:** Desktop sections are mostly stacked wholesale; large illustrative cards, all customization previews, complete activity grids, and unavailable/secondary content remain expanded.
- **Why It Matters:** One-handed use becomes tiring and users lose their location and task priority.
- **Recommended Fix:** Apply task hierarchy instead of universal stacking: progressive disclosure, section tabs/accordions, “show more,” compact summaries, virtualized/paginated histories, and sticky local context where beneficial. Keep next actions visible before decoration or archival data.

### FVT-011 — Arabic preference changes direction but not most interface copy

- **Category:** RTL / Localization / Architecture
- **Page / Component:** Authenticated application
- **Device / Width:** All devices in Arabic preference
- **Severity:** **High (P1)**
- **Problem:** The app sets `document.lang` and `document.dir`, but most authenticated components contain hardcoded English strings. Static search found Arabic UI copy only in Auth and a SheetStudy workspace dictionary.
- **Root Cause:** There is no application-wide message catalogue/translation layer; locale is treated primarily as a direction flag.
- **Why It Matters:** Users can select Arabic and receive an RTL English interface, which is incomplete localization and creates awkward mixed-direction layouts.
- **Recommended Fix:** Introduce centralized message keys, locale-aware plural/date/number formatting, and route/component coverage tests. Translate shared shell and high-traffic student routes first; keep content data language separate from interface locale.

### FVT-012 — The frontend test suite is red

- **Category:** Technical Debt / Release Quality
- **Page / Component:** `frontend/tests/phase5.test.js`
- **Device / Width:** Build pipeline
- **Severity:** **High (P1)**
- **Problem:** 50 tests pass and one fails because the test at line 89 attempts to read `src/pages/Analytics.jsx`, which no longer exists.
- **Root Cause:** The phase test was not updated when Analytics was removed/renamed or its route ownership changed.
- **Why It Matters:** A broken release gate hides future regressions and prevents the team from distinguishing expected failures from new ones.
- **Recommended Fix:** Update the assertion to the current authoritative analytics/operations implementation, or restore the intended module if it was removed accidentally. Keep CI at zero unexpected failures.

### FVT-013 — Responsive CSS depends on a fragile override cascade

- **Category:** CSS Architecture / Breakpoint
- **Page / Component:** Global styles
- **Device / Width:** All responsive modes
- **Severity:** **High (P1)**
- **Problem:** `styles.css` is about 320.8 KB and `responsive.css` about 41.3 KB. Together they contain roughly 14,000 lines, 58 media-query blocks, and 246 `!important` declarations. Legacy floating-shell rules in `styles.css` are corrected later by visual-refresh rules and corrected again by `responsive.css`.
- **Root Cause:** Multiple generations of responsive design remain active in one global cascade; success depends on import order and selector specificity.
- **Why It Matters:** Small changes can regress unrelated widths, RTL, or components, and engineers cannot reason locally about final geometry.
- **Recommended Fix:** Establish one shell layer, one token layer, and component-scoped responsive rules. Remove superseded media blocks after visual regression coverage exists. Prefer cascade layers and container queries; reserve `!important` for documented exceptions.

### FVT-014 — Authentication is not intentionally designed for iPad landscape

- **Category:** iPad / Tablet UX
- **Page / Component:** Login/register/recovery shell
- **Device / Width:** 1024×768 and similar landscape tablets
- **Severity:** **High (P1)**
- **Problem:** At 1024×768 the layout remains a tall single-column phone form, grows to about 832px, scrolls below the viewport, and leaves large unused horizontal space. The visual/auth art disappears.
- **Root Cause:** Tablet auth rules keep a full-width one-column flex surface instead of defining a landscape tablet composition.
- **Why It Matters:** The first product impression on iPad feels stretched and less polished than the authenticated shell.
- **Recommended Fix:** Use a balanced two-pane or centered split card in landscape, retain a restrained brand/benefit panel, keep the form within viewport height, and preserve the existing one-column portrait layout.

### FVT-015 — 1199→1200px causes an abrupt workspace contraction

- **Category:** Breakpoint / Layout Shift
- **Page / Component:** Application shell sidebar/content
- **Device / Width:** Boundary between 1199px and 1200px
- **Severity:** **Medium (P2)**
- **Problem:** The rail changes from 88px to a 260px full sidebar in one pixel, so the main workspace shrinks by roughly 171px even though the viewport becomes wider.
- **Root Cause:** A binary breakpoint swaps two fixed navigation widths.
- **Why It Matters:** Manual resizing and small-laptop window changes create a conspicuous reflow; dense layouts can become narrower exactly when crossing into “desktop.”
- **Recommended Fix:** Add a compact desktop/sidebar state or use a fluid/clamped width before full expansion. Allow content/container capacity—not only viewport width—to decide when labels expand.

### FVT-016 — Dashboard statistics communicate scrollability poorly

- **Category:** Mobile Visual / Interaction
- **Page / Component:** `/` — statistics strip
- **Device / Width:** 320–430px
- **Severity:** **Medium (P2)**
- **Problem:** Cards overflow internally by roughly 700–800px, the second card is abruptly clipped, and a native horizontal scrollbar is visibly rendered.
- **Root Cause:** The statistics grid becomes an `overflow-x: auto` strip without a polished scroll affordance/snap treatment.
- **Why It Matters:** The strip technically works but looks broken, and users may not realize more metrics are available.
- **Recommended Fix:** Use scroll snap, consistent peek width, edge fade/progress dots, hidden platform scrollbar only after a replacement affordance exists, and keyboard-accessible previous/next controls where appropriate.

### FVT-017 — Progress calendar day controls are below touch guidance

- **Category:** Accessibility / Data-Dense UI
- **Page / Component:** `/progress` — four-week activity calendar
- **Device / Width:** Phone and tablet; 34×34px cells
- **Severity:** **High (P1)**
- **Problem:** Thirty day buttons are 34×34px, while adjacent labels/legend increase visual density.
- **Root Cause:** `styles.css:13919-13920` fixes cells at 34px.
- **Why It Matters:** Repeated small targets are difficult for touch and motor-impaired users.
- **Recommended Fix:** Provide at least a 44px hit area without necessarily enlarging the visible dot; use padding/pseudo-elements or a roving calendar interaction; preserve clear selected/focus states.

### FVT-018 — Auth inputs can trigger iOS zoom and secondary controls are small

- **Category:** Mobile Forms / Accessibility
- **Page / Component:** Authentication forms
- **Device / Width:** iPhone widths, especially 320px
- **Severity:** **Medium (P2)**
- **Problem:** Auth inputs use `0.95rem` (about 15.2px), below the common 16px iOS zoom threshold. The language control was about 33px high and password reveal about 38px.
- **Root Cause:** Desktop-sized typography and icon sizing are retained for phone form controls.
- **Why It Matters:** Focusing a field can unexpectedly zoom the page; small auxiliary controls are harder to tap.
- **Recommended Fix:** Set phone input text to at least 16px and give language/reveal controls a 44px hit area while keeping their visual glyphs compact.

### FVT-019 — Dates/numbers ignore the selected interface locale

- **Category:** RTL / Localization
- **Page / Component:** Notifications, Progress, Review, Ranked, Achievements, account sessions, community/admin dates
- **Device / Width:** All devices; visible in English UI
- **Severity:** **Medium (P2)**
- **Problem:** English interface screens displayed Arabic-formatted dates because many calls use `toLocaleString()`/`toLocaleDateString()` with the browser default instead of the application locale.
- **Root Cause:** Formatting is duplicated across components and often passes `undefined` or no locale.
- **Why It Matters:** Mixed language and bidi order reduce comprehension and visual consistency.
- **Recommended Fix:** Centralize date/number formatters around the chosen app locale and calendar/numbering policy; wrap mixed-direction user/server strings with `dir="auto"` or `<bdi>` where needed.

### FVT-020 — Error states can lose page identity

- **Category:** Error State / Accessibility
- **Page / Component:** Dashboard, Questions, Review, Bookmarks, Achievements, Ranked, community/detail routes, and other early returns
- **Device / Width:** All devices
- **Severity:** **Medium (P2)**
- **Problem:** Many pages return `<ErrorPanel>` before rendering `<Page>`. In error scenarios, the document title can remain “Dentify,” no route-specific `h1` is present, and only the shell title supplies context.
- **Root Cause:** Loading/error branches live outside the page landmark/title wrapper.
- **Why It Matters:** Screen-reader and keyboard users lose page context exactly when recovery guidance is most important.
- **Recommended Fix:** Keep Page/title/heading mounted for loading, empty, and error states; place the state panel within it; update document title consistently.

### FVT-021 — Tertiary text token fails normal-text contrast on dark surfaces

- **Category:** Accessibility / Visual
- **Page / Component:** Global metadata/tertiary text
- **Device / Width:** All devices and themes using `--soft`
- **Severity:** **Medium (P2)**
- **Problem:** `--soft: #687088` measures about 4.02:1 on `#060a14` and 3.78:1 on `#0c1223`, below 4.5:1 for normal text. It is used for small auth icons/copy and metadata.
- **Root Cause:** The tertiary token was tuned for subtlety without a minimum contrast constraint across elevated surfaces.
- **Why It Matters:** Small secondary information becomes difficult to read, especially on mobile and low-quality displays.
- **Recommended Fix:** Raise the dark-theme tertiary token to a verified 4.5:1 minimum on its darkest/elevated usage backgrounds, or reserve the current value for non-text decoration/disabled content.

### FVT-022 — Shared compact controls repeatedly stop at 38–42px

- **Category:** Accessibility / Shared Components
- **Page / Component:** Account menu, Settings local nav, Dashboard actions, Lock In join form, store/cart, workspace quick actions
- **Device / Width:** Phone and touch tablet
- **Severity:** **Medium (P2)**
- **Problem:** Multiple touch actions measure 38–42px high. Examples include 42px account-menu rows, 42px Settings section links, 42px Dashboard material action, 42px Lock In team controls, and 38px workspace quick actions.
- **Root Cause:** There is no enforced shared touch-hit-area token; individual components optimize visible height independently.
- **Why It Matters:** Near-miss taps accumulate across the product even when each isolated control looks acceptable.
- **Recommended Fix:** Define a 44px minimum interactive hit-area token for coarse pointers, allowing visual contents to remain smaller through padding/pseudo-hit areas. Add automated target-size checks for primary touch routes.

### FVT-023 — Tablet rail destinations are icon-only without a touch discovery path

- **Category:** Navigation / Tablet UX
- **Page / Component:** 640–1199px compact rail
- **Device / Width:** Touch tablets, especially 768–834px
- **Severity:** **Medium (P2)**
- **Problem:** Rail labels are hidden and several destinations (Ranked, Progress, Store, etc.) are not self-evident from icons alone. Native title/hover discovery does not help touch users.
- **Root Cause:** Tablet CSS hides `.nav-btn > span` for the full range and relies on `title`/accessible names.
- **Why It Matters:** The rail is accessible to screen readers but less learnable visually, increasing navigation errors.
- **Recommended Fix:** Provide tap/long-press labels, an optional expandable rail, or short persistent labels where width allows; keep the current icon identity and active-state treatment.

### FVT-024 — Motion is globally broad and occasionally too decorative

- **Category:** Animation / Performance
- **Page / Component:** Global theme transitions, page entry, auth, cards, progress, assessment states
- **Device / Width:** All devices, more noticeable on lower-end phones
- **Severity:** **Medium (P2)**
- **Problem:** A large selector list transitions background, border, shadow, color, opacity, and filter for nearly every surface/control. Several page/card entries use staggered or overshooting spring curves; multiple independent reduced-motion blocks are required to suppress them.
- **Root Cause:** Theme and interaction motion are mixed into global selectors; new component animations accumulated over time.
- **Why It Matters:** Theme changes can animate expensive paint properties across the full UI and decorative entry delays can make content feel slower.
- **Recommended Fix:** Separate theme color transitions from interaction motion; default to opacity/transform only; remove page-wide stagger from routine navigation; consolidate reduced-motion rules and test every infinite animation.

### FVT-025 — Large visual assets are not sized as responsive thumbnails

- **Category:** Performance / Media
- **Page / Component:** Dashboard, Settings themes, Store
- **Device / Width:** Mobile networks and all smaller viewports
- **Severity:** **High (P1)**
- **Problem:** Source assets include a 1.96 MB dashboard light scene, 1.75 MB Store hero, and eight theme previews around 1.0–1.47 MB each. The built CSS is about 286 KB and main entry JS about 276 KB before lazy routes.
- **Root Cause:** Full-resolution PNG artwork is reused where cards need only small previews; only some images are lazy-loaded and there is no responsive `srcset`/modern-format thumbnail pipeline.
- **Why It Matters:** Settings/Store can consume many megabytes, delay decoding, increase memory pressure, and degrade mobile first render/scroll smoothness.
- **Recommended Fix:** Generate AVIF/WebP thumbnails at rendered sizes, provide responsive sources, keep high-resolution art only for full views, set intrinsic width/height/aspect ratio, and audit route-level transfer/decode budgets.

### FVT-026 — Several React modules are too large to reason about safely

- **Category:** React Architecture / Maintainability
- **Page / Component:** `SheetStudy.jsx`, `LockInMode.jsx`, layout `index.jsx`, App route/bootstrap
- **Device / Width:** All modes
- **Severity:** **High (P1)**
- **Problem:** `SheetStudy.jsx` is about 2,413 lines/93.5 KB, `LockInMode.jsx` about 967 lines/87.6 KB, and the layout module about 770 lines. They mix data synchronization, gestures, lifecycle guards, timers, panels, responsive rendering, and visual components.
- **Root Cause:** Feature growth remained in page-level modules rather than domain hooks/state machines and focused components.
- **Why It Matters:** Responsive/interaction changes carry high regression risk, rerender boundaries are coarse, and targeted tests are difficult.
- **Recommended Fix:** Extract domain hooks (session lifecycle, document tools, gesture state, chat polling), pure view components, and route-specific error boundaries. Preserve behavior with interaction tests before moving code.

### FVT-027 — Layering and direction logic rely on hardcoded physical properties

- **Category:** CSS Architecture / RTL
- **Page / Component:** Global CSS, focus workspaces, study toolbars/drawers
- **Device / Width:** RTL and overlay-heavy routes
- **Severity:** **Medium (P2)**
- **Problem:** The styles contain at least 140 explicit `left:`/`right:` declarations, additional physical margins/padding/borders, 26 `translateX` occurrences, and z-index values up to 9999. Focus workspace panels explicitly open from the right and use physical borders/margins.
- **Root Cause:** Direction and overlay layering are implemented component by component rather than through logical properties and a shared layer scale.
- **Why It Matters:** RTL can look directionally wrong even when the document flips, and new dialogs/drawers may unexpectedly cover each other.
- **Recommended Fix:** Define named z-index layers; migrate structural rules to `inset-inline-*`, `margin-inline-*`, `border-inline-*`; centralize direction-aware transforms; retain physical coordinates only for intentionally non-directional artwork.

### FVT-028 — Route-level timers can rerender large trees every second

- **Category:** Performance / React
- **Page / Component:** Store, Catalog Focus Workspace, Lock In
- **Device / Width:** All devices, especially ordinary phones
- **Severity:** **Medium (P2)**
- **Problem:** Store updates `now` every second; Focus Workspace and Lock In update tick state every second in already large page trees.
- **Root Cause:** Timer display state is owned high in route components rather than isolated to a small memoized clock/countdown boundary.
- **Why It Matters:** Unrelated cards and panels may reconcile every second, wasting battery and reducing gesture/scroll headroom.
- **Recommended Fix:** Isolate timers into small components/hooks, pause when hidden, derive only the minimum displayed unit, and profile commit durations on low-end mobile hardware.

### FVT-029 — Route, page, and document titles are inconsistent

- **Category:** Visual Polish / Information Hierarchy
- **Page / Component:** Settings, Lock In, selected error/loading states
- **Device / Width:** All devices
- **Severity:** **Low (Polish/P3)**
- **Problem:** `/settings` is labeled “Settings” in the shell but renders a Page title of “Themes.” `/lock-in` keeps document title “Dentify” and its only `h1` can be the current team name (for example “D”), not the workspace name.
- **Root Cause:** Page metadata is decentralized and immersive routes bypass the standard Page title contract.
- **Why It Matters:** Browser history, assistive navigation, and visual context feel inconsistent.
- **Recommended Fix:** Add route metadata as one source of truth for shell label, document title, and default `h1`; immersive routes may visually hide the heading but should preserve a descriptive accessible name.

### FVT-030 — Card-wall styling weakens hierarchy on dense pages

- **Category:** Visual Polish / Design System
- **Page / Component:** Settings, Store, Profile, Progress, Dashboard
- **Device / Width:** Mobile and tablet
- **Severity:** **Low (Polish/P3)**
- **Problem:** Many sections use nested translucent panels, borders, large radii, and shadows at the same hierarchy level. On long pages, every block competes as a premium card.
- **Root Cause:** The brand surface treatment is applied uniformly instead of being reserved for primary groupings/actions.
- **Why It Matters:** The product remains attractive, but scanning is slower and the page can feel like a collection of separate cards rather than one workflow.
- **Recommended Fix:** Keep the signature gold/purple identity while flattening secondary groups, using spacing/dividers for low-priority content, and reserving elevated/glass cards for primary tasks and outcomes.

### FVT-031 — Prominent unavailable features create dead-end surfaces

- **Category:** UX Improvement / Empty & Disabled States
- **Page / Component:** Dashboard study plan, catalog sheet landing, Focus Workspace quick actions
- **Device / Width:** Primarily phone and tablet
- **Severity:** **Medium (P2)**
- **Problem:** Large areas advertise disabled Save, Download, Bookmark, Discuss, AI, summary, flashcard, and practice actions. Dashboard also gives substantial space to unavailable planning content.
- **Root Cause:** Future/server-dependent capabilities are rendered in full layout positions even when unavailable.
- **Why It Matters:** Users repeatedly encounter controls they cannot use, while available next actions move farther down long mobile pages.
- **Recommended Fix:** Collapse unavailable groups into one concise explanatory notice, reveal disabled capabilities contextually, or hide them until eligibility exists. Keep genuine next actions visually dominant.

### FVT-032 — Account menu does not implement expected menu focus behavior

- **Category:** Interaction State / Accessibility
- **Page / Component:** Top-bar Profile menu
- **Device / Width:** Keyboard users at all widths
- **Severity:** **Medium (P2)**
- **Problem:** The menu opens with `role="menu"`/`menuitem`, but focus remains on the trigger and the component has no roving focus or arrow-key behavior. Rows are also about 42px on phone.
- **Root Cause:** The component handles outside pointer and Escape dismissal but does not implement the full ARIA menu keyboard pattern.
- **Why It Matters:** Keyboard users receive menu semantics without the interaction model those semantics promise.
- **Recommended Fix:** Either implement focus-first-item, arrow/Home/End navigation and focus restoration, or use a simpler disclosure/navigation list semantic if standard Tab behavior is preferred.

### FVT-033 — Lock In route lacks descriptive page semantics

- **Category:** Accessibility / Route Context
- **Page / Component:** `/lock-in`
- **Device / Width:** Phone and tablet; reproduced at 390px
- **Severity:** **Medium (P2)**
- **Problem:** The document title remains “Dentify,” the main landmark can be named only after the current team, and the `h1` is the team name rather than “Lock In.”
- **Root Cause:** The immersive route bypasses shared metadata and uses live team identity as the top-level page identity.
- **Why It Matters:** A screen reader/browser history entry may announce an opaque single-letter team name without explaining the current workspace.
- **Recommended Fix:** Use “Lock In — [team] — Dentify” for the document title and a descriptive visually hidden `h1`; keep the visible compact team header unchanged.

### FVT-034 — Invalid material deep links can display raw backend HTML

- **Category:** Error State / Robustness
- **Page / Component:** Dynamic materials route and API error presentation
- **Device / Width:** All devices
- **Severity:** **Medium (P2)**
- **Problem:** Navigating to the ambiguous `/materials/catalog` deep link matched a dynamic material route and rendered the complete HTML 404 document inside an alert.
- **Root Cause:** The dynamic route accepts the reserved `catalog` segment, and API response text is surfaced without sanitizing/normalizing HTML errors.
- **Why It Matters:** Users see technical markup instead of a recoverable not-found state; route collisions can produce confusing failures from old links/bookmarks.
- **Recommended Fix:** Reserve conflicting route segments, normalize API errors to safe user messages, and render a route-aware not-found Page with a link back to Materials.

## Critical Functional Problems

1. **FVT-001:** Settings local navigation exits the route.
2. **FVT-002:** Stale PWA clients can fail on missing lazy chunks.
3. **FVT-003:** Profile presents fabricated evidence/rank values.

These should block a production release because they affect navigation, availability after deployment, and data trust.

## Visual Bugs

- **FVT-004:** Phone Focus Workspace action overflow and clipping.
- **FVT-005:** 320px horizontal reflow failure.
- **FVT-015:** Abrupt workspace contraction at 1200px.
- **FVT-016:** Native scrollbar/clipped Dashboard statistic strip.
- **FVT-021:** Low-contrast tertiary copy.

## Mobile Problems

- **FVT-004, FVT-005:** Workspace overflow and smallest-width reflow.
- **FVT-008, FVT-017, FVT-022:** Tiny/repeated touch targets and chart interaction burden.
- **FVT-009, FVT-010:** Extremely long Store/Settings/Profile/Progress/Notifications flows.
- **FVT-016:** Weak horizontal-scroll affordance.
- **FVT-018:** iOS input zoom and compact auth actions.
- **FVT-031:** Large disabled sections displace usable actions.

## iPad / Tablet Problems

- **FVT-006:** Broad one-column collapse underuses tablet capacity.
- **FVT-007:** Installed PWA blocks landscape orientation.
- **FVT-014:** Landscape authentication is a stretched phone layout.
- **FVT-015:** The rail-to-sidebar boundary is too abrupt.
- **FVT-023:** Icon-only rail is difficult to learn on touch.

## Global Component Problems

- **FVT-002:** Application-level lazy-route/PWA recovery is not deployment-safe.
- **FVT-013:** The global cascade makes shared shell/component behavior depend on override order.
- **FVT-020/FVT-029:** Shared Page and route metadata do not consistently own loading/error/document identity.
- **FVT-021/FVT-022:** Shared color and control sizing tokens do not guarantee contrast/touch targets.
- **FVT-024:** Global transition selectors animate too many surfaces and paint-heavy properties.
- **FVT-027:** Overlay layers and direction behavior lack shared z-index/logical-property contracts.

## Navigation & Drawer Problems

- **FVT-001:** Settings fragment navigation conflicts with HashRouter.
- **FVT-023:** Tablet rail needs a touch label/discovery mechanism.
- **FVT-032:** Account menu semantics and keyboard focus model are incomplete.

The mobile drawer itself passed the tested gesture, dismissal, focus, inertness, safe-area, and vertical-scroll checks and should be preserved.

## Interaction State Problems

- **FVT-002:** Error recovery cannot repair a stale lazy chunk without reload.
- **FVT-016:** Horizontal statistics do not clearly signal or structure scrolling.
- **FVT-031:** Disabled future actions occupy primary interaction space.
- **FVT-032:** Profile menu focus behavior does not match `role="menu"`.
- Error/loading/empty patterns are reusable and visually consistent, but **FVT-020** shows that they need to retain page identity.

## CSS Architecture Problems

- **FVT-013:** Global override cascade, 58 media blocks, 246 `!important` rules.
- **FVT-015:** Fixed-width breakpoint discontinuity.
- **FVT-027:** Physical direction properties and unbounded z-index values.
- **FVT-024:** Theme/motion transitions apply too broadly.

### Recommended breakpoint strategy

- Keep **phone ≤639px** as the attached header/content/bottom-nav architecture.
- Treat **640–899px portrait tablet** as a compact rail plus adaptive two-column component canvas, not a universal single column.
- Treat **900–1199px landscape tablet/small laptop** as a compact desktop workspace; let high-capacity components expand through container queries.
- At **≥1200px**, expand navigation only when the remaining content container stays above its minimum useful width.
- Use viewport queries for shell/navigation mode and container queries for cards, forms, charts, and dense panels.

## Breakpoint Problems

- **FVT-005:** The fixed 320px body minimum defeats narrow reflow.
- **FVT-006:** The 640–1199px tablet range applies one-column decisions too broadly.
- **FVT-009:** Store add-ons drop to one column too early for compact card content.
- **FVT-014:** Auth lacks a landscape-tablet composition.
- **FVT-015:** Navigation jumps from 88px to 260px at one pixel.
- **FVT-016:** Dashboard stats switch to overflow without a complete carousel/scroll pattern.

Breakpoint cleanup should be component-capacity driven, with the shell retaining only a small set of navigation-mode thresholds.

## React / Frontend Architecture Problems

- **FVT-026:** Very large page modules mix data, lifecycle, gestures, and UI.
- **FVT-028:** Timer state can rerender large route trees every second.
- **FVT-020/FVT-029:** Route metadata/error identity is decentralized.
- Route-level lazy loading is a strong architectural choice, but it needs the deployment recovery work in **FVT-002**.

## Animation Problems

- **FVT-024:** Global color/shadow/filter transitions and routine staggered page entries are broader than necessary.
- The mobile drawer’s transform/opacity gesture animation is appropriately GPU-oriented and reduced-motion aware; keep that implementation model.

## Accessibility Problems

- **FVT-005:** 320px/zoom reflow.
- **FVT-008/FVT-017:** Heatmap/calendar targets and keyboard burden.
- **FVT-018/FVT-022:** Sub-44px phone controls and 15.2px inputs.
- **FVT-020/FVT-029/FVT-033:** Missing/inconsistent page identity.
- **FVT-021:** Tertiary contrast.
- **FVT-032:** Menu focus model.

Positive accessibility foundations include a working skip link, native form labeling, meaningful landmarks, focus-visible styling, named icon buttons, inert drawer background, Escape dismissal, and reduced-motion coverage.

## RTL / Localization Problems

- **FVT-011:** No complete authenticated translation system.
- **FVT-019:** Locale-unaware dates/numbers create mixed-language UI.
- **FVT-027:** Physical left/right styling remains extensive in complex workspaces.
- Auth RTL switching and the mobile drawer’s direction-aware opening/swipe logic are strong and should be retained.

## Performance Problems

- **FVT-002:** PWA update/cache integrity.
- **FVT-024:** Broad paint-heavy transitions.
- **FVT-025:** Multi-megabyte PNG preview/hero assets.
- **FVT-026/FVT-028:** Large component trees and timer-driven rerenders.
- The current service worker correctly avoids caching authenticated API responses, which is a positive privacy/performance boundary.

## Visual Polish Opportunities

- **FVT-016:** Refine horizontal statistic scrolling.
- **FVT-029:** Align route/shell/page naming.
- **FVT-030:** Reduce nested card/glass density.
- **FVT-031:** Compress unavailable capability messaging.
- Preserve the gold/purple accent, restrained dark palette, mascot identity, current active states, and compact attached shell.

## UX Improvements

- Put the next available study action before disabled/future capabilities (**FVT-031**).
- Use progressive disclosure rather than stacking every section on phone (**FVT-009, FVT-010**).
- Give tablet layouts their own information density and hierarchy (**FVT-006, FVT-014, FVT-023**).
- Replace tiny cell-by-cell interaction with accessible chart/calendar navigation (**FVT-008, FVT-017**).
- Make horizontal content intentionally discoverable and controllable (**FVT-004, FVT-016**).
- Preserve user context through router-safe local navigation, descriptive errors, and consistent titles (**FVT-001, FVT-020, FVT-029, FVT-033, FVT-034**).

## Technical Debt

- **FVT-012:** Stale test references a removed module.
- **FVT-013:** Global CSS/cascade debt.
- **FVT-026:** Monolithic route components.
- **FVT-027:** Physical RTL rules and z-index escalation.
- **FVT-034:** Dynamic route/error normalization gap.

## Frontend Health Score

| Dimension | Score (0–4) | Rationale |
|---|---:|---|
| Accessibility | 2 | Good semantics/focus foundation, but reflow, contrast, chart targets, and menu keyboard behavior are material. |
| Performance | 2 | Lazy routes help, but large assets/CSS, global effects, and timer rerenders remain. |
| Responsive design | 3 | Shell is strong and most routes fit; 320px, Focus Workspace, and tablet composition need work. |
| Theming / RTL | 3 | Strong tokens/themes/safe areas and direction switching; localization and physical direction rules are incomplete. |
| Anti-pattern resistance | 2 | Distinctive brand, but nested cards/glass and repeated oversized surfaces remain noticeable. |
| **Total** | **12/20** | **Acceptable foundation with significant work required before a polished production release.** |

## Final Responsive and Technical Scores

| Area | Score | Why |
|---|---:|---|
| Visual Polish | **7.0/10** | Strong identity and attractive surfaces; density, native scrollbars, over-carded pages, and some hierarchy inconsistency remain. |
| Mobile UX | **6.0/10** | Shell/drawer are excellent, but Focus Workspace, long pages, charts, Store, and 320px reflow reduce comfort. |
| iPad UX | **5.0/10** | Stable and visually coherent, but too many layouts collapse like phone and auth/PWA landscape behavior is weak. |
| Responsive Quality | **6.5/10** | No broad overflow above 320px and shell breakpoints work; component breakpoints and 1199/1200 transition need redesign. |
| Interaction Quality | **7.0/10** | Drawer/primary navigation feel polished; horizontal affordances, unavailable controls, and account-menu focus need refinement. |
| Animation Quality | **5.5/10** | Drawer motion is strong; global theme/page/card motion is over-broad and occasionally decorative. |
| Accessibility | **6.0/10** | Solid semantic/focus baseline, offset by touch targets, reflow, contrast, page identity, and chart navigation. |
| CSS Architecture | **3.5/10** | Functional output depends on a large, overlapping, specificity-heavy cascade. |
| React Architecture | **5.0/10** | Good routing/lazy boundaries and shared APIs, but several route modules are too monolithic. |
| Performance | **5.5/10** | Lazy loading and private-cache restraint help; image transfer, CSS size, effects, and timers are mobile risks. |
| RTL Robustness | **6.0/10** | Shell/auth/drawer direction behavior is promising; most content is untranslated and complex CSS is physically directional. |
| Design Consistency | **7.0/10** | Brand language is coherent, though naming, hierarchy, and surface elevation are not uniformly disciplined. |
| Maintainability | **4.0/10** | Global CSS debt, very large components, a red test, and decentralized metadata/localization make change risky. |
| **Overall Frontend Quality** | **5.8/10** | A strong visual/product foundation with several release-blocking functional and architectural issues. |

## Priority Implementation Plan

### Phase A — Critical release blockers

1. Fix Settings router-safe section navigation (**FVT-001**).
2. Implement atomic PWA/lazy-chunk update recovery (**FVT-002**).
3. Remove fabricated Profile data (**FVT-003**).
4. Resolve 320px reflow and phone Focus Workspace interaction (**FVT-004, FVT-005**).
5. Remove the installed-PWA portrait lock (**FVT-007**).

### Phase B — Shared system fixes

1. Establish touch-target and contrast tokens (**FVT-021, FVT-022**).
2. Centralize route metadata/error-page identity (**FVT-020, FVT-029, FVT-033, FVT-034**).
3. Create locale-aware message/date/number infrastructure (**FVT-011, FVT-019**).
4. Repair the failing test before broader refactoring (**FVT-012**).

### Phase C — Mobile and iPad structure

1. Recompose tablet grids and landscape auth (**FVT-006, FVT-014**).
2. Reduce long mobile flows with progressive disclosure (**FVT-009, FVT-010, FVT-031**).
3. Redesign activity/calendar interaction and tablet rail discovery (**FVT-008, FVT-017, FVT-023**).
4. Smooth the 1199/1200 navigation transition and refine statistics scrolling (**FVT-015, FVT-016**).

### Phase D — Technical cleanup

1. Consolidate CSS layers and remove superseded breakpoint blocks (**FVT-013**).
2. Split large route components and isolate timers (**FVT-026, FVT-028**).
3. Standardize z-index and logical direction properties (**FVT-027**).
4. Add screenshot/reflow/touch regression coverage around the audited breakpoint matrix.

### Phase E — Performance and polish

1. Build responsive AVIF/WebP artwork variants and route budgets (**FVT-025**).
2. Narrow animation scope and simplify routine page entry (**FVT-024**).
3. Flatten secondary card groups while preserving the brand identity (**FVT-030**).

## Recommended Verification After Fixes

- Repeat the full phone/tablet/desktop matrix from this report, including continuous resize around all shell boundaries.
- Run 200% browser zoom and 320px with classic scrollbars.
- Test installed PWA update from version N to N+1 while an old client remains open, then navigate to every lazy route.
- Test Arabic authenticated pages, not only Auth, with mixed Arabic/English content and long labels.
- Test touch targets using coarse-pointer emulation and real device tapping.
- Test Profile/Progress chart navigation with keyboard and screen reader.
- Run transfer/decode profiling for Dashboard, Settings, Store, Profile, and Focus Workspace on a throttled mobile profile.
- Restore a completely green lint/type/test pipeline before release.

## Final Audit Rule

This report is inspection-only. No application code, CSS, configuration, assets, tests, or backend behavior was modified. Implementation should begin only after explicit approval.

You can ask me to run these one at a time, all at once, or in any order you prefer.

Re-run `$impeccable audit` after fixes to see your score improve.
