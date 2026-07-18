# Lock-in Design System

Last updated: 2026-07-18
Status: Design-system implementation recorded through Phase 7

## Product scene

Lock-in is designed for a student studying late in low ambient light, often on a phone or tablet,
who needs the next useful action without dashboard noise. The interface is therefore dark by
purpose, not trend: low-glare surfaces, restrained gold attention cues, purple structure cues, and
warm white text preserve the existing identity while improving hierarchy and endurance.

## Skills applied

| Skill | Purpose in Phase 3 | Why selected |
|---|---|---|
| `impeccable` | UX hierarchy, responsive behavior, accessibility, copy, state design, RTL, and visual QA | It is the broadest installed product-interface review Skill and directly addresses the approved redesign freedom. |
| `design-system` | Primitive to semantic to component token architecture and component state contracts | It is more specific than the general design Skills for a maintainable token foundation. |
| `security-best-practices` | Secure React/Django account flows, sessions, CSRF, authorization, and PWA boundaries | It provides framework-specific Python and TypeScript guidance for the explicit security scope. |
| `playwright` | Real-browser desktop/mobile/RTL, overflow, interaction, screenshot, and Axe validation | It validates behavior that unit tests and static inspection cannot prove. |

`ui-styling` was not selected because it is centered on Tailwind/shadcn. Lock-in already uses a
dependency-light CSS architecture; adopting a second styling system would add dependencies and
duplicate the selected token model. No newly discovered Django, DRF, PostgreSQL, PWA, or load-test
Skill became available in Phase 3.

## Token architecture

Tokens use three layers in `frontend/src/design-system/tokens`:

1. **Primitive:** OKLCH color ramps, spacing, typography, radius, and motion values.
2. **Semantic:** background, surface, text, border, action, success, and danger roles.
3. **Component:** field, button, panel, rail, and mobile-navigation contracts.

Components consume semantic or component tokens, not raw palette values. This allows future
high-contrast or institution themes without rewriting component CSS.

## Visual language

| Element | Rule |
|---|---|
| Background | Near-black navy, with one clear surface step for rails and forms |
| Primary accent | Gold for the current action, active navigation, focus, and short highlights; kept visually scarce |
| Secondary accent | Purple for section numbering and secondary structure, not competing calls to action |
| Typography | System-first sans stack with Arabic fallback; tight display headings and relaxed body copy |
| Shape | Compact 8–16 px radii; no ornamental glass panels or excessive pills |
| Dividers | Thin structural lines replace dense card grids |
| Motion | Short feedback transitions only; reduced-motion preference collapses them |
| Focus | High-visibility gold outline with offset; never removed |

## Foundational components

- `Brand`: code-native Lock-in study/entry monogram; mascot remains a separate identity asset.
- `Button`: primary, secondary, quiet, danger, full-width, disabled, hover, active, and focus states.
- `FormField` and `SelectField`: explicit label, hint/error relationship, invalid state, and native
  autofill semantics.
- `Alert`: persistent success/error outcome that does not rely on color alone.
- `PageSkeleton`: reserved-space loading state with reduced-motion handling.
- `EmptyState`: honest absence, without fake study data.
- `AppShell`: desktop rail, tablet drawer, and mobile bottom navigation from one route model.

## Responsive structure

- **Phone:** form/content first, fixed structural header, bottom navigation, safe-area padding, no
  decorative study scene, and no horizontal overflow at the tested 390 px width.
- **Tablet:** top bar plus an off-canvas rail hidden from both sighted and accessibility navigation
  until opened; bottom navigation keeps the main three destinations reachable.
- **Desktop:** persistent 272 px rail and reading-width content. Authentication uses a two-part
  study scene and form rather than centering a floating card in empty space.

Breakpoints respond to structural pressure, at 48 rem and 68 rem, rather than named devices.

## RTL and language

English and Arabic use catalogs with identical keys. Locale changes update `html.lang` and
`html.dir`, and only the validated non-sensitive locale preference is stored locally. CSS uses
logical properties for placement and borders. RTL browser validation covers the entire mobile
registration flow, not text direction in isolation.

## Accessibility contract

- WCAG 2.2 AA remains the target.
- Semantic headings, landmarks, lists, labels, descriptions, status/alert regions, and a skip link.
- Unique navigation landmark names and closed mobile drawer removal from the accessibility tree.
- Keyboard-accessible native controls and visible focus.
- `prefers-reduced-motion` and `prefers-contrast` adaptations.
- Axe checks on authenticated desktop/mobile and Arabic mobile flows found no violations.
- Focus Mode must later provide accessible alternatives for canvas/PDF operations; this phase did
  not weaken or merge its independent accessibility contract.

## Material redesign explanations

| Redesign | Usability reason |
|---|---|
| Authentication is split between a study scene and a focused form on desktop | Preserves mascot and premium study identity while keeping the task visually isolated; mobile removes the scene to prioritize input space. |
| Dashboard uses numbered horizontal sections instead of a grid of cards | Creates one clear reading sequence and avoids implying study metrics that do not exist yet. |
| Dashboard’s first action is account/security readiness | It is the only truthful useful action before education content is implemented. |
| Desktop rail becomes structural top/bottom navigation on smaller screens | Keeps primary destinations reachable without allowing a toolbar to cover content. |
| Role dashboards are one shell with additive workspace visibility | Matches backend permission truth and avoids four duplicated dashboard implementations. |
| Security separates password, email, and session controls | Reduces destructive-action ambiguity and makes session revocation understandable. |
| Custom Lock-in monogram replaces the generic lock icon | Distinguishes product identity while retaining entry/focus symbolism and scalable code-native assets. |

## Performance rules

- No component framework, animation library, external font, or icon package was added.
- Private API responses remain outside the service-worker cache.
- Presentation is CSS/SVG; mascot is the only large raster scene asset.
- Loading states reserve layout space; list and page work remains independently testable.
- Phase 3 production bundle is 85.22 KB gzip for the main JavaScript and 4.81 KB gzip for CSS.
- Later heavy domains, especially Focus/PDF, must be route-split before implementation grows the
  main bundle.

## Phase 4 Learning Experience

The dashboard now uses the same restrained visual language for a command-center hierarchy: one
next-study action, a compact progress summary, recent learning, then account readiness. Learn is a
journey surface rather than a file browser: search, academic path, and related learning objects stay
in one reading sequence. Creator/admin pages preserve that structure while exposing workflow and
authority state progressively.

### Phase 4 material redesigns

| Redesign | Usability reason |
|---|---|
| Dashboard account menu → next-study command center | Puts the student's next useful action before secondary account details. |
| Folder/PDF browsing → path plus related learning objects | Preserves educational context and makes progress/bookmarks natural. |
| File-oriented detail → learning-object workspace | Treats media as one part of study, with progress and policy visible. |
| Dense global creator controls → scoped workflow lists | Clarifies who may create/review/publish and reduces accidental authority. |
| Desktop hierarchy table → responsive progressive editor | Keeps administration usable on tablets/phones without hiding lifecycle state. |

Search and management pages use native fields, labeled selects, semantic lists, alert/status
regions, reserved-space skeletons, and honest empty states. Logical CSS properties preserve RTL.
Axe and horizontal-overflow checks pass on the exercised Desktop Chrome and Pixel 7 flows.

Phase 4 student and management pages are route-split. The production main bundle is 91.34 KB gzip
and CSS is 6.31 KB gzip. Focus remains a separate later route/subsystem and cannot inflate the
normal learning bundle until it is actually implemented.

## Phase 5 Assessment Experience

Phase 5 reuses the established primitive, semantic, and component tokens rather than creating a
parallel quiz theme. The assessment home puts due review before quiz discovery, so the first action
answers what the student should do now. An active attempt uses a dedicated distraction-reduced shell
with one question, a question map, authoritative timer, save state, and explicit submission dialog.
Results return the student to review or the next study action instead of ending at a score.

The assessment UI uses logical CSS properties, native radio groups and fieldsets, keyboard-operable
controls, managed dialog focus, live save/timer announcements, reduced-motion fallbacks, and a
semantic heading hierarchy. Desktop Chrome and Pixel 7 Playwright flows passed Axe and horizontal
overflow checks, including Arabic RTL. The production assessment routes remain split; the measured
main bundle is 96.41 KB gzip and CSS is 8.51 KB gzip.

## Phase 6 Contextual Community Experience

The community uses the same learning hierarchy and token system rather than a social-media visual
language. The global feed is for finding active learning conversations; it intentionally omits a
composer. Creation appears only after the student enters a lesson, learning object, question, or
quiz context. This turns “post something” into “ask about what I am studying.”

Discussion detail is a restrained reading surface with author/context provenance, one reply level,
clear revision/tombstone states, and reporting close to the content. Creator spaces display the
learning context and membership boundary before conversation. Moderation separates queue controls
from immutable evidence and audit history so decisions stay reviewable without crowding the student
experience.

### Phase 6 material redesigns

| Redesign | Usability reason |
|---|---|
| Generic community composer -> contextual composer | Reduces irrelevant posts and keeps the student inside the learning journey |
| Deep comment tree -> one reply level | Preserves readable reasoning and touch targets on phones |
| Social popularity cues -> learning-context provenance | Helps students judge relevance without optimizing attention capture |
| Scattered report dialogs -> evidence-based moderation workspace | Gives authorized reviewers consistent context, status, and audit history |
| Global private groups -> context-bound creator spaces | Makes purpose and authority understandable before a student participates |

Community pages use semantic sections/lists, a single main landmark, labeled native controls, live
status/errors, confirmation for destructive actions, logical CSS properties, visible focus, contrast
and reduced-motion support. Desktop Chrome and Pixel 7 flows passed Axe, Arabic RTL, and horizontal
overflow checks. Routes remain split; the production main bundle is 100.36 KB gzip and CSS is 9.96
KB gzip.

## Phase 7 Learning Motivation Experience

Phase 7 deliberately avoids a bright badge wall or competitive activity feed. The progression page
uses a calm hierarchy: personal level and streak, explicit qualifying activities, meaningful
milestones, then a secondary published ranking with freshness, rules, own position, and privacy.
The notification page is a quiet action center rather than an engagement inbox.

### Phase 7 material redesigns

| Redesign | Usability reason |
|---|---|
| Gamification dashboard -> learning momentum | Keeps the student's goal on study and mastery |
| Hidden point rules -> adjacent “what counts” card | Makes progression predictable and discourages grinding |
| Badge grid first -> milestone progress before ranking | Prioritizes intrinsic progress over comparison |
| Live leaderboard -> published snapshot with freshness | Reduces volatility and makes fairness explainable |
| Forced identity -> inclusion and display privacy | Gives students control over public representation |
| Notification stream -> categorized learning actions | Reduces noise and keeps each update useful |

Both routes use the established primitive/semantic/component tokens, logical properties, semantic
headings/lists/tables/forms, native progress/checkbox/select controls, visible focus, reduced-motion
behavior, and shared English/Arabic component trees. The toolbar/navigation adapts without covering
content on phones or tablets. Playwright caught and corrected insufficient muted metadata contrast;
the final desktop/mobile flows pass Axe, RTL, and horizontal-overflow checks. Routes remain split;
the production main bundle is 102.67 KB gzip and CSS is 11.44 KB gzip.

## Phase 8 Plan and Access Experience

Phase 8 uses a quiet account-access hierarchy rather than an aggressive pricing wall. The student
first sees the current plan, lifecycle state, and relevant date; then the exact capabilities the
server grants; then honest available offers and immutable payment/invoice/refund history. Checkout
is not rendered as available while no production provider or paid price exists.

### Phase 8 material redesigns

| Redesign | Usability reason |
|---|---|
| Checkout-first billing -> Plan & access | Answers current access before presenting a purchase decision |
| Plan badge -> explicit capability list | Makes feature availability understandable as products evolve |
| Fabricated price card -> honest unavailable offer | Prevents a misleading dead-end transaction |
| Separate transaction pages -> one chronological history | Makes payment, invoice, and refund reconciliation easier |
| Immediate cancel action -> inline confirmation | Reduces accidental lifecycle changes without modal focus risk |

The route uses established tokens, semantic headings/lists/tables, native buttons, visible focus,
live loading/error/cancellation status, logical properties, reduced motion, and one English/Arabic
component tree. Wide financial history becomes a labeled narrow layout without clipping or covering
the document area. Desktop and mobile Playwright flows pass Axe, RTL, focus/landmarks, and overflow
checks. The route remains lazy and adds no runtime UI, payment, font, icon, or animation dependency.

## Phase 9 Operations Experience

Phase 9 uses a quiet operational hierarchy rather than a card wall or a clone of Django Admin. The
overview answers platform health, content answers publishing/coverage, and support answers account,
moderation, payment, subscription, notification, and community queues. The user workspace uses a
searchable list/detail pattern, keeping role and status actions adjacent to identity evidence.

### Phase 9 material redesigns

| Redesign | Usability reason |
|---|---|
| One administrator dashboard → overview/content/support routes | Reduces cognitive load and lets roles bookmark the workspace they use |
| Dense desktop tables → semantic line lists and user list/detail | Preserves labels, touch targets, and action context at narrow widths |
| Destructive modal-first flow → inline preview/confirm region | Keeps focus/context stable while exposing exact consequences |
| Hidden analytics derivation → visible period and freshness | Prevents operators from mistaking projections for real-time truth |
| Infrastructure detail → normalized system status | Communicates actionability without leaking hosts or provider internals |

The route reuses primitive/semantic/component tokens, shared Button/Feedback controls, semantic
headings/lists/description lists/forms, labeled complementary landmarks, visible focus, reduced
motion, logical properties, and one English/Arabic tree. Operation tabs scroll within their own
narrow container without widening the page. Desktop and Pixel 7 Playwright flows pass Axe, Arabic
RTL, confirmation, and horizontal-overflow checks. Browser review found and corrected a duplicate
heading and unnamed landmarks. Operations routes remain lazy and add no UI/font/icon dependency.
The measured production main bundle is 108.32 KB gzip and CSS is 13.96 KB gzip; operations pages
remain route-split.
