# Lock In Frontend V2 Audit

## Scope and preservation rule

This V2 pass hardens the existing React frontend. It does not replace the framework, component library, routes, API contracts, visual identity, navigation structure, colors, typography, icons, cards, forms, or user flows. Django remains the authority for sessions, permissions, Focus state, assessments, progress, purchases, subscriptions, and operations data.

The audit builds on the existing mobile audit records and re-checks the shared application shell against the running local Django demo. The V2 source change is deliberately confined to the shared mobile bottom navigation and the shell that reserves its space.

## Confirmed findings

| Severity | Confirmed issue | Route and viewport | Root cause | Exact fix | Appearance impact |
| --- | --- | --- | --- | --- | --- |
| Major | The mobile bottom navigation was visibly elevated above the lower edge. | All authenticated Student, Creator, and Admin routes at `<=900px`; reproduced from the shared CSS at 320px through tablet portrait. | `.bottom-nav` used `bottom: calc(10px + var(--safe-bottom))`, placing both an arbitrary gap and the device inset below the nav. | Anchor the nav with `bottom: 0`; move the device inset into its bottom padding. | No redesign: same card, icons, labels, colors, active state, radius, and horizontal margins. Only the unintended lower gap is removed. |
| Major | Short and long pages reserved the nav area twice, causing excessive bottom whitespace. | All mobile routes; live long-dashboard end check at 390x844. | Both `.app-shell` and `.page-shell` added independent navigation/safe-area clearance. | Add one `--mobile-bottom-nav-height` token, use it only for the shell reservation, and restore the page shell’s normal 10px mobile ending padding. | No content hierarchy changes. The last content ends directly above the fixed nav instead of after a second blank reservation. |
| Moderate | The fixed nav had no shared virtual-keyboard behavior. | Any authenticated phone form, sheet, or dialog with an open on-screen keyboard. | The shell did not observe `VisualViewport`, so it could not distinguish a keyboard-sized visible viewport from browser chrome changes. | Detect only a large, unzoomed layout-to-visual viewport delta; while it is present, hide the fixed nav and remove its reservation. Rotation and browser-control changes stay below the threshold. | No normal-state visual change. The nav transitions out only while a real virtual keyboard is open. |

## Live responsive verification

All results below used the real local Django demo and backend data; no browser mock data was introduced.

| Surface | Evidence | Result |
| --- | --- | --- |
| Shared Student dashboard | 320x568, 360x800, 375x667, 390x844, 414x896, 430x932, 768x1024, and 1024x768. | No horizontal overflow at every size. The nav has five unchanged links on mobile and is attached to the visible viewport lower edge. At desktop/tablet landscape it correctly returns to the existing sidebar layout. |
| Student materials | 320x568 authenticated `#/materials`. | No overflow; the nav is fixed to the visual viewport lower edge; labels and active state remain intact. |
| Creator education | 390x844 authenticated `#/creator/education`. | No overflow; nav remains viewport-attached and preserves the Creator surface. |
| Operations Admin overview | 390x844 authenticated `#/operations/admin/overview`. | No overflow; nav remains viewport-attached and preserves the Admin surface. |
| Long Dashboard ending | 390x844 at document end. | The page shell ends at 766.8px and the nav begins at 768px; the nav stays attached and there is no duplicate trailing clearance. |
| Focus Workspace regressions | Existing shared Focus tests re-run with the full frontend suite. | The established phone sheet, toolbar, safe-area, and closed-on-phone regression coverage passes unchanged. |

## Accessibility, stability, and API checks

- The existing `viewport-fit=cover` declaration and user zoom support remain in place.
- The safe-area inset is consumed inside the nav exactly once; the shell uses the nav’s full occupied height only to keep content visible above it.
- The keyboard handler ignores page zoom and uses a 150px threshold so mobile Safari browser-control expansion/collapse does not trigger it.
- Existing dialog focus trapping, drawer scroll locking, reduced-motion behavior, loading/error states, and Focus Workspace mobile tests remain in the shared test suite.
- No frontend authority or mock data was added. No backend source was changed.

## Validation limitation

The Windows workspace cannot run native WebKit/iPhone Safari or invoke a physical on-screen keyboard. Chromium-based live browser checks covered the real authenticated app, while the keyboard branch has source-level regression coverage. A final release gate should still include a physical iPhone Safari pass with the keyboard open and with large text enabled.
