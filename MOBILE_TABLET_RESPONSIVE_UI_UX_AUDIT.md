# Mobile & iPad Responsive UI/UX Audit

**Phase:** Inspection and analysis only  
**Code changes:** None  
**Audit date:** August 9, 2026

No application code was modified during this audit. Temporary audit artifacts were removed, and all existing user files were preserved.

The audit used the Impeccable audit framework and a real-browser Playwright workflow. The existing production build was served against the local demo backend because the checked-in Vite executable links were incomplete and rebuilding would have altered generated files.

## Executive summary

The website has a strong visual identity and generally avoids full-page horizontal scrolling. Forms, buttons, focus states, reduced-motion support, empty states, and confirmation dialogs are mostly well implemented.

However, the responsive layer is not ready for production approval yet. Two existing functional blockers affect every viewport, and the current tablet transition creates significant clipping around 820–1024px.

The highest-priority findings are:

1. Editing a profile crashes the application.
2. Assessment question prompts are hidden, making quizzes unusable.
3. Focus Workspace breaks in iPad portrait around 820–900px.
4. The 900→901px navigation transition squeezes content into a desktop layout too early.
5. Important phone navigation actions disappear.
6. Achievement, profile, progress, dashboard, and operations content is internally clipped.
7. First-load PWA precaching downloads approximately 19.5 MB, including unrelated artwork and theme previews.

## Audit coverage

### Technology and design system

- React 18, Vite, HashRouter and PWA/Workbox.
- Route-level lazy loading.
- Predominantly hand-written CSS with approximately 14,000 lines in the main stylesheet.
- Token-based navy, gold and violet visual system.
- Shared shell, sidebar, top bar, mobile drawer, bottom navigation, cards, lists, forms, dialogs, empty/error/loading states and progress components.
- Responsive rules distributed across the main stylesheet and specialized Focus/Lock In stylesheets.

### Routes inspected

- Authentication: login, registration, forgotten password.
- Student: dashboard, materials, catalogs, sheets, learning objects, Focus, Lock In, search, questions, quiz detail, attempt, result, review, community, discussions, spaces, reports, ranked, bookmarks, progress, achievements, notifications, store, profile and settings.
- Creator: education, content, question and quiz lists/details, plus creation/edit forms.
- Operations: overview, users, purchases, subscriptions, notifications, reports, audit, settings, system and exports.
- Permission, empty, loading, error and unavailable states.

### Viewports

Core shell and breakpoint-sensitive components were tested at:

- Phones: 320×568, 360×800, 375×812, 390×844, 393×852, 412×915 and 430×932.
- Tablets in portrait and landscape: 768×1024, 810×1080, 820×1180, 834×1194 and 1024×1366.
- Intermediate widths including 374, 390, 420, 430, 480, 560, 620, 700, 720, 820, 899, 900, 901, 980, 1024, 1080, 1180 and 1194px.

Every accessible route received a 390px phone pass. Core, data-dense and specialized workspaces received the complete phone/tablet breakpoint sweep.

## Detailed issue register

| ID | Page / Route | Component | Device / Width | Severity | Problem | Why it matters | Recommended solution |
|---|---|---|---|---|---|---|---|
| 1 | `/profile` | Edit profile form | All tested widths | **Critical** | Selecting “Edit profile” throws `AccountFieldErrors is not defined` and activates the route ErrorBoundary. The missing reference is visible in `frontend/src/pages/Profile.jsx:143`. | A primary account task is completely unusable. The error state can persist when navigating to other pages until recovery is triggered. | Import the existing field-error component, add a profile-edit interaction test, and verify recovery does not contaminate later navigation. |
| 2 | `/questions/attempts/:attemptId` | Assessment question card | All widths | **Critical** | The question prompt is completely hidden by `.session-panel > .question-card .card-head { display:none; }` in `frontend/src/styles.css:4603`. Only answer choices are visible. | Users cannot know what question they are answering. The assessment is functionally unusable and inaccessible. | Restore the prompt for assessment cards. Hide only duplicated metadata through a dedicated class, never the entire question heading. |
| 3 | `/focus/:documentVersionId` | Focus header and controls | 820–900px portrait, most severe at 834×1194 | **High** | The desktop toolbar activates too early. The title collapses into a narrow multi-line column, overlaps subtitle/status content, and right-side controls are clipped. | iPad portrait is a core study context; session controls and document status become difficult or impossible to interpret. | Keep the stacked/tablet toolbar through portrait tablet widths. Introduce a compact tablet command bar and switch to the full desktop header only when container space supports it. |
| 4 | Global authenticated shell | Sidebar, content frame and top bar | 901–1024px | **High** | At 900px the UI has a 76px bottom nav; at 901px it abruptly gains a 232px sidebar. At 901px the content frame is only about 592px wide and internally overflows to 642px. | One pixel changes the entire information architecture and causes hidden dashboard content on small landscape tablets and resized windows. | Add an intermediate compact-rail mode. A full-width sidebar should require roughly 1180–1200px of usable width, not 901px. |
| 5 | Global phone shell | Search, notifications and navigation drawer | 320–430px | **High** | Desktop search and notification controls are hidden. Search has no drawer/bottom-nav equivalent, and notifications lose their direct phone affordance. Achievements also lacks a clear primary-nav entry. | Important routes exist but are undiscoverable or require indirect navigation/deep links on phones. | Add Search and Notifications to the phone header or a clearly labeled “More” destination. Ensure every desktop primary action has a touch equivalent. |
| 6 | `/achievements`, `/profile`, `/progress` | Achievement cards, ID card and progress bars | Primarily 320–430px; also narrow tablet content regions | **High** | Several internal elements are approximately twice their visible container width and are hidden rather than reorganized. At 390px, an achievement card measured 331px visible versus 661px internal width. | Progress information and achievement content can silently disappear while the page itself reports no horizontal overflow. | Remove inherited desktop widths/transforms. Rebuild these card interiors with mobile-specific grids and percentage-based progress tracks. |
| 7 | `/`, `/operations/admin/*` | Statistics grids and stat-card metadata | 320–430px, 768–834px, 901–1024px | **High** | Four or five cards are forced across insufficient width. Statuses such as “Action Due,” “Active subscriptions” and supporting labels are truncated or clipped. At 834px the operations stats grid measured 792px visible versus 923px content width. | These are high-value summary metrics; clipped labels make the numbers ambiguous. | Use 2 columns on phones, 2–3 on tablet portrait and 4–5 only when each card meets a defined minimum content width. Do not hide supporting labels. |
| 8 | `/creator/education` | Hierarchy node list | 390×844 and 834×1194 | **High** | The page reaches approximately 14,893px at 390px for 24 nodes. Long UUID ancestry paths wrap across several lines and dominate every row. | Managing hierarchy becomes exhausting and error-prone; mobile users cannot scan or compare nodes efficiently. | Use a collapsible tree/list, show human-readable ancestry, move UUIDs into details/copy actions, and provide search/filter plus progressive disclosure. |
| 9 | First authenticated load | PWA Workbox precache | All devices; most harmful on mobile networks | **High** | The service worker precaches the whole approximately 19.5 MB build, including all theme images, Store artwork, PDF runtime and lazy route bundles. Individual images reach 1–1.9 MB. | Route-level lazy loading loses much of its benefit; first load consumes substantial bandwidth and cache storage. | Precache only the app shell and essential offline assets. Runtime-cache optional routes and imagery, provide responsive image variants, and avoid preloading all theme previews. |
| 10 | Most standard routes | Global heading hierarchy | All devices | **High** | The persistent greeting is the page’s H1 while the actual route title is often suppressed or rendered as H2. `Page` defaults `showHeading` to false in `frontend/src/components/ui/index.jsx:5`. | Screen-reader orientation is incorrect, and visual page context is weak—especially after mobile navigation. | Make each route title the H1. Convert the greeting to secondary text and show a compact route title in the mobile/tablet header. |
| 11 | `/focus/:id` | Mobile toolbar and status region | 320–430px | **High** | Save status can occupy three lines; the PDF viewport becomes very short. Bottom annotation tools are partially clipped/off-screen, particularly at 320px and 390px. | Core document tools are difficult to discover and the reading surface is crowded by controls. | Collapse save status into a compact indicator, use a horizontally scrollable tool strip with visible affordance or a bottom-sheet tool picker, and reserve safe-area space. |
| 12 | Global shell and dashboard pages | Tablet information architecture | 768–900px portrait | **Medium** | Tablets inherit the phone bottom navigation and frequently a single wide column. Cards stretch across large empty areas while dense sections remain stacked. | Tablet space is underused and the experience feels like an enlarged phone. | Add a tablet-specific mode: compact rail or drawer, selective two-column layouts, and secondary panels beside rather than below main content where appropriate. |
| 13 | `/operations/admin/*` | Operations tabs | 390px and 768–834px | **Medium** | Ten tabs occupy roughly 1,205px inside 348px/792px containers. Only the first few are visible and the horizontal-scroll affordance is weak. | Administrators may not realize that Audit, Settings, System and Exports exist. | Replace with a mobile select/menu or grouped “More” control. Tablet can use wrapping two-row tabs or a compact sub-navigation rail. |
| 14 | `/creator/*` | Creator tabs | 320–430px | **Medium** | Education, Content, Questions and Quizzes occupy about 506px inside a 333px container, producing a visible horizontal scrollbar. | Role navigation feels unfinished and current/hidden destinations are harder to scan. | Use equal-width two-by-two tabs, a compact selector, or a horizontally snapping tab list with gradient edge affordance. |
| 15 | Global phone shell | Bottom navigation | 320–430px | **Medium** | Labels such as Dashboard and Bookmarks are ellipsized. Five long labels compete for limited width. | Navigation recognition suffers, particularly for new users and at 320px. | Shorten labels intentionally, reduce to four primary destinations plus More, or use icons with complete accessible labels and a selected text label. |
| 16 | `/store`, `/settings`, creator quiz detail, operations settings | Long card/form walls | 320–430px | **Medium** | Page heights reached approximately 6,790px, 5,296px, 4,361px and 5,606px respectively. Everything is stacked without section navigation or progressive disclosure. | Technically responsive pages still become inefficient, tiring mobile experiences. | Add section summaries, sticky local navigation, accordions and staged workflows. Preserve expanded desktop views where appropriate. |
| 17 | Authentication | Login and registration shell | 320×568 and 1024×768 | **Medium** | At 320px the large logo and intro push the primary login action below the initial viewport. At 1024 landscape, a narrow phone form sits in a large field of unused space. | Primary authentication action is delayed on small phones, while tablets feel visually unfinished. | Shrink/reposition branding on short phones. Use a balanced tablet split layout or wider two-region composition at landscape widths. |
| 18 | Materials, community discussion/space and learning-object routes | Breadcrumbs | 320–430px | **Medium** | Long breadcrumb pills clip or horizontally scroll with little indication that more content exists. | Users lose hierarchy and back-navigation context. | Show the current page plus one parent on phones, move the full trail into an expandable control, and add scroll-edge affordances where scrolling remains necessary. |
| 19 | Catalog Focus workspace | Toolbars, document canvas and notes panel | 320–430px | **Medium** | Selection actions horizontally scroll; right-most labels are clipped. The notes panel consumes about 330px, leaving a sliver of the document, while handles/progress controls overlap the canvas. | The workspace feels crowded and touch interactions compete for the same space. | Turn notes into a true full-width bottom sheet on phones, consolidate selection tools and avoid floating handles over primary content. |
| 20 | Global drawer | Theme selector, role navigation and modal isolation | 320–430px | **Medium** | Theme selection consumes much of the first drawer viewport, while Creator Studio/Operations entries are far below. Background navigation remains exposed in the accessibility tree while the drawer is open. | Frequent navigation is deprioritized, and assistive-technology users can encounter controls behind a modal surface. | Put navigation before appearance settings, prioritize role-specific workspaces, and make background content inert/aria-hidden while the drawer is open. |
| 21 | `/progress`, `/profile` | Activity calendar and heatmap cells | Touch devices | **Medium** | Individual day values are exposed through native `title` attributes, which depend on hover and do not provide a reliable touch interaction. | Phone/tablet users cannot inspect the same detail available to mouse users. | Make cells buttons or provide tap/focus popovers with an accessible label and dismiss behavior. |
| 22 | Focus, profile and Arabic registration | Localization | Phones and tablets | **Medium** | English sessions contain Arabic Focus controls and Arabic-formatted dates; the Arabic registration form contains an English API limitation message. | Mixed direction and language increase cognitive load and can create unexpected wrapping. | Drive all labels and date formatting from one active locale, set the document direction globally, and test long Arabic labels at phone widths. |
| 23 | Assessment attempt/result | Information hierarchy | 320–430px | **Medium** | Four metrics precede answer content, and result pages devote a large hero to the score followed by stacked stat cards. | The user’s primary task is pushed down, producing avoidable scrolling and distraction. | Put the question and answers first; collapse attempt metadata into a compact row. Use a concise result summary with expandable detail. |
| 24 | Responsive architecture | Media-query system | All widths | **High** | Responsive logic is spread across more than twenty thresholds—374, 390, 420, 430, 480, 500, 560, 576, 600, 620, 640, 700, 720, 768, 820, 900, 980, 1024, 1050, 1080, 1180, 1220 and 1440px—with page-specific conflicts. | Components change behavior unpredictably, and fixing one width risks regressions at another. The 900/901 failure is direct evidence. | Establish a small semantic breakpoint set and add component/container queries for cards, tabs and toolbars. Document ownership of every breakpoint. |
| 25 | Dashboard, notifications, progress and operations | Long labels and metadata | 320–430px and compressed tablet layouts | **Low** | Titles, badges and metadata are frequently truncated without a way to reveal their full value. | The interface looks visually clipped even when core functionality remains available. | Allow important labels to wrap to two lines; reserve ellipsis for secondary text and provide accessible full text where truncation is necessary. |
| 26 | Store and theme surfaces | Decorative imagery | Phones and tablet portrait | **Low** | Large desktop imagery consumes significant visual space and bandwidth even when rendered relatively small. | Decorative assets delay primary content and lengthen already-long mobile pages. | Supply mobile crops and modern formats, reduce hero height, and load decorative imagery only when its section enters the viewport. |

## Critical Problems

- **#1 Profile editing crashes the routed application.**
- **#2 Assessment prompts are invisible, making quizzes unusable.**

These should be repaired and regression-tested before any responsive polish work, because they block basic product tasks at every device size.

## Mobile Problems

The most important phone-specific issues are:

- Lost Search and Notifications affordances: #5.
- Internally hidden achievement/profile/progress content: #6.
- Squeezed statistic cards: #7.
- Clipped Focus tools: #11.
- Creator and operations tab scrolling: #13–14.
- Truncated bottom navigation: #15.
- Extremely long Store/settings/management workflows: #16.
- Small-phone authentication hierarchy: #17.
- Breadcrumb and workspace crowding: #18–19.
- Drawer prioritization and modal isolation: #20.
- Hover-only calendar data: #21.
- Assessment hierarchy: #23.

## iPad / Tablet Problems

- Focus Workspace switches to its desktop header too early: #3.
- The full sidebar activates abruptly at 901px: #4.
- Summary cards overflow in portrait: #7.
- 768–900px behaves like a large phone rather than a designed tablet experience: #12.
- Operations navigation still exceeds available width at 834px: #13.
- Authentication leaves large unused landscape space: #17.

A compact tablet rail and container-aware toolbars would resolve much of this category.

## Global Component Problems

- `Page`/Topbar heading ownership: #10.
- Shared stat-card sizing: #7.
- Mobile navigation parity and labels: #5 and #15.
- Drawer structure and modal behavior: #20.
- Shared progress-track/card sizing: #6.
- Breadcrumb behavior: #18.
- Localization source of truth: #22.
- PWA asset strategy: #9.

## Breakpoint Problems

The central architecture problem is #24.

A cleaner target strategy would be:

- **Phone: ≤639px** — compact top bar, 4 primary bottom destinations plus More, single-column task-first content.
- **Tablet portrait: 640–899px** — drawer or 72–88px compact rail, selective two-column layouts.
- **Tablet landscape/small laptop: 900–1199px** — compact rail, reduced top-bar controls, container-aware cards.
- **Desktop: ≥1200px** — full sidebar and full toolbar.

Component-specific container queries should control:

- Stat-card column counts.
- Focus toolbar composition.
- Creator/operations sub-navigation.
- Breadcrumb reduction.
- Panel stacking.
- Form action arrangements.

## UX Improvements

These areas fit technically but require intentional mobile redesign:

- Prioritize the active task over metrics in assessments.
- Replace Store/settings card walls with staged or collapsible sections.
- Convert creator education into a searchable, collapsible hierarchy.
- Give operations a mobile section selector rather than a 10-item scroll strip.
- Show route context in the mobile header.
- Move theme selection below primary navigation.
- Use full-width bottom sheets for notes and complex secondary panels.
- Keep commonly used actions within thumb reach without covering page content.

## Visual Polish

- Allow meaningful status labels to wrap instead of clipping.
- Reduce oversized authentication and result-page headings on short screens.
- Normalize Arabic/English typography and date formatting.
- Add edge fades or arrows to genuinely scrollable tabs.
- Reduce tablet card stretching and excess empty space.
- Keep gold radii, borders, shadows and navy/violet surfaces—the brand remains visually coherent.
- Use mobile-specific crops for large decorative scenes.

## Positive findings

- Most tested pages avoided document-level horizontal scrolling.
- Core touch targets were generally at least 44px; only one representative dashboard action measured slightly below at 42px.
- Forms normally collapse to clear single-column layouts.
- Labels, fieldsets, alerts and disabled states are generally semantic.
- Skip-to-content, focus-visible styling and reduced-motion rules exist.
- Confirmation dialogs fit phone viewports and move focus appropriately.
- Empty, loading and error states are consistently designed.
- Route splitting is already present.
- The visual identity remains recognizable across standard and special workspace pages.

## Impeccable health score

| Area | Score | Reason |
|---|---:|---|
| Accessibility | 2/4 | Good form semantics and focus foundations, but heading ownership, modal isolation, hover-only data and the hidden question prompt are serious gaps. |
| Performance | 1/4 | Route splitting is present, but whole-build PWA precaching and large image assets substantially hurt mobile first load. |
| Responsive | 1/4 | Most pages avoid document overflow, but functional clipping and the tablet breakpoint transition are severe. |
| Theming | 3/4 | Strong tokens and identity; special workspaces and localization create some inconsistency. |
| Anti-patterns | 2/4 | Excessive card walls, tab scrollers and dense UUID-heavy management lists need structural redesign. |
| **Total** | **9/20** | An acceptable visual foundation with substantial responsive work required. |

## Final Responsive Score

| Category | Score | Explanation |
|---|---:|---|
| Mobile Responsiveness | **5/10** | Pages usually fit the viewport, but several shared components hide or clip internal content. |
| Mobile UX | **4/10** | Navigation gaps, very long workflows, clipped Focus tools and assessment/profile blockers undermine usability. |
| iPad Responsiveness | **4/10** | Tablet widths frequently receive either an enlarged phone layout or a prematurely compressed desktop layout. |
| iPad UX | **4/10** | Tablet space is underused in portrait and overcrowded after the 901px desktop transition. |
| Visual Consistency | **7/10** | The brand, palette, cards, radii and shadows are coherent despite some special-page and localization inconsistencies. |
| Overall Responsive Quality | **4.5/10** | The site has a credible visual foundation, but critical task blockers and systemic tablet/breakpoint problems prevent production readiness. |

## Final status

The audit phase is complete. No implementation or responsive fixes have been started. Approval is required before any code changes begin.
