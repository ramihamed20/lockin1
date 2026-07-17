# Lock-in Design System

Last updated: 2026-07-15
Status: Phase 3 implemented baseline

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
