# Lock-in V3 — UX audit, information architecture and redesign plan

Status: phase 1–2 written, first slice of phase 4/5 implemented (2026-10-14, uncommitted on
`codex/lockin0.1.3`). Governed by `docs/PRODUCT.md` and `docs/DESIGN.md`; where this plan and
those documents disagree, they win.

## 1. Audit of the current interface

What already works and is kept:

- **Dashboard** was refined and adopted today: Continue first, a five-number summary strip,
  latest mistakes, other recent sheets, group timetable. It already follows "next action first"
  and loads each section independently. No redesign is proposed beyond the open items below.
- **Shell**: icon rail on every non-Studio route, phone bottom bar (Dashboard, Materials,
  Questions, Review, More) and a modal drawer; one viewport authority (`--app-viewport-height`).
- **Focus Workspace** already has a contextual tool architecture: a primary tool row (pen,
  highlighter, eraser, lasso, shapes on wide screens), one option capsule that follows the active
  tool, an Add menu, a More menu with drill-in Export/History/Settings, a floating selection
  toolbar, quick colours and undo/redo. The 44 px touch / 40 px fine-pointer rule is enforced by
  specs.

Problems found:

| # | Problem | Evidence |
|---|---|---|
| A1 | The rail listed **14 destinations**, 4 of them "coming soon" placeholders (Study Plan, Lock-in Mode, Community, Ranked). Icons alone could not carry 14 meanings, so labels only appeared on screens ≥940 px tall; laptops and iPad landscape got an unlabelled column of look-alike icons. | `lib/constants.js` `navItems`, `styles/rail.css` |
| A2 | Closely related pages were separate top-level destinations: Bookmarks beside Review, Analysis beside Progress, Paper Workspace beside Materials. Each one cost a rail slot and gave the student another decision. | same |
| A3 | Rail and phone disagreed: the phone showed 4 destinations + More, the rail showed 14. | `BottomNav` vs `NavList` |
| A4 | The drawer's "Explore" group interleaved scheduled features with pages a student can open. | `MobileDrawerNavigation` |
| A5 | Focus toolbar carried a **disabled "Search document (coming later)"** button, hidden by CSS at nearly every width, while real search already existed in More and on Ctrl/⌘+F. | `CatalogFocusWorkspace.jsx`, `catalog-focus-workspace.css` |
| A6 | Focus More menu repeated two Export choices ("Download original", "Page snapshot") one level above the Export menu that already holds them. | same |
| A7 | Study tools are split across surfaces: Active Study is a mode dialog, Marks (shared annotations) is in More, Summary / Map / Explain are a side panel behind a build flag. The student has no single "study tools" entry. | `knowledge/KnowledgeWorkspace.jsx`, `AnnotationSharePanel.jsx` |

What the features actually are (checked in code, not assumed):

- **Marks** = *shared annotations*: a student publishes their ink/notes on a catalog sheet;
  others browse (ordered by likes), preview, and copy all or chosen pages; copies open inside the
  catalog reader under `marksSet`. Not bookmarks, highlights or grades. Panel: More → Marks
  (Browse / Share yours / Copies) plus an in-reader chip while viewing someone's marks.
- **My Summary, Map Builder, Explain** exist as the *knowledge workspace*
  (`workspace/knowledge/`: `SummaryEditor`, `MapEditor`, `ExplainEditor`, `DrawingPad`,
  dictation), opened from the reader's "Study tools" button. Compiled only when
  `VITE_KNOWLEDGE_ENABLED=true`, and each tool is further gated by the server's per-source
  `bootstrap.tools` flags. Another session is actively developing it.
- **Study Plan** is registered as coming soon (`lib/featureAvailability.js`); there is no
  implementation.

## 2. Lock-in V3 information architecture

Five primary destinations, identical on every device; secondary pages live *inside* their hub.

| Primary | Sections (hub tabs) | Also reached from |
|---|---|---|
| Dashboard | — | — |
| Materials | Subjects · Paper Workspace | subject → sheet → reader |
| Questions | — | sheet entry |
| Review | Review Center · Bookmarks | Dashboard mistakes |
| Progress | Overview · Analysis · Achievements | Dashboard summary strip |

Everything else (Store, Plans, Notifications, Settings, and the Planned group: Study Plan,
Lock-in Mode, Community, Ranked) is in the drawer, which still lists every page, so nothing
became undiscoverable. Plans also stays in the account menu.

Device mapping:

- **Desktop / iPad landscape / iPad portrait / short landscape ≥640×560**: 88 px rail, label
  under every icon at every height (five items fit), streak reading at the foot, menu button
  opens the full drawer. Staff tools (Content Studio, Moderation, Creator Studio) sit below a
  single divider.
- **Phone / phone landscape**: bottom bar Dashboard · Materials · Questions · Review · More.
  Progress is the first group in More.
- **Hub tabs**: a centred segmented control at the top of the hub's own pages only. Deeper pages
  (a subject's sheets, a review session) keep their back link instead. They are links, not ARIA
  tabs, so back/forward and deep links work.

Frequent study activities are now ≤2 actions away: Continue (1), any subject (2), mistakes (1–2),
bookmarks (2), analysis (2).

Kept / simplified / combined / moved / removed:

- **Kept**: Dashboard layout, route paths (no URL changed), drawer, Studio sidebar, feature
  registry as the single source of "coming soon".
- **Combined**: Bookmarks into Review, Analysis + Achievements into Progress, Paper Workspace
  into Materials.
- **Moved**: Store, Plans, scheduled features out of the rail into the drawer.
- **Removed as redundant**: the dead Focus search button; duplicate download items in More.

## 3. Implemented in this slice

| Change | Files |
|---|---|
| `navItems` gains `primary` / `hub`; `navHubs`, `bottomNavPaths`, `hubForPath`, `hubMemberPaths` | `src/lib/constants.js` |
| Rail shows primary items only; hub sections keep their rail entry current; drawer entries match their own path; drawer grouped Primary → Workspace → Explore → Planned, sign-out last | `src/components/layout/index.jsx` |
| `HubTabs` segmented control rendered by the shell outside Studio | same + `src/styles/rail.css` |
| Rail labels at every rail height; dividers only before staff tools | `src/styles/rail.css` |
| Focus: dead search button removed; Download original / Page snapshot reached through More → Export | `src/pages/CatalogFocusWorkspace.jsx`, `catalog-focus-workspace.css` |
| Strings `hub.*`, `shell.planned` (EN/AR); three unused Focus strings removed | `src/lib/i18n.js` |
| Tests: new `tests/navigation-hubs.test.js`; specs updated for the drawer/rail split and the Export path | `e2e/sidebar-density`, `coming-soon-features`, `lock-in-coming-soon`, `focus-workspace-controls`, `tests/subscription-flow` |

## 4. Redesign plan for the study workspaces (not yet implemented)

### 4.1 Focus Workspace — next steps

The tool architecture is already the one the brief asks for, so the plan is refinement, not a
rewrite of the 6.7k-line reader:

1. **One "Study" launcher** in the toolbar's right group replacing the separate Active Study
   button and Study tools button: a popover listing *Normal / Active Study* (mode), *Summary*,
   *Map*, *Explain* (only those the server flags enable), *Marks*. This answers A7 without
   merging data models. Needs coordination with the knowledge-workspace session.
2. **Phone toolbar**: keep pen/highlighter/eraser/lasso + Add + More; move quick colours into
   the pen capsule below 700 px (they currently compete with tools for width).
3. **More menu order** by frequency: Search, Export…, Share, Marks, Bookmark, Full screen,
   Hide annotations/covers, Version history, Settings.
4. Keep: 44 px touch targets, `useWorkspacePaneActive` gating, keep-alive tabs, export sheets.

Acceptance: no spec in `focus-*.spec.js` regresses; WebKit project compared against a
baseline build.

### 4.2 Marks

Keep it contextual (no new page). Proposed: a single "Marks" entry in the Study launcher with a
count badge of available shares; the in-reader chip already handles "you are viewing Sara's
marks". Unverified today: RTL and phone layouts of `AnnotationSharePanel` (see memory note).

### 4.3 My Summary

Lives in the knowledge panel per source document. Plan: open beside the page on iPad/desktop
(split, not overlay), full-height sheet on phones; autosave status in the header only; formatting
behind one "Aa" control. Depends on `VITE_KNOWLEDGE_ENABLED` and server tool flags.

### 4.4 Map Builder

`MapEditor.jsx` exists (nodes, links, focus-from-concept). Plan for the entry experience:
empty canvas with one "Add idea" button → a second "Add related idea" appears attached to the
selected node → drag to connect → contextual node toolbar (rename, colour, delete). Advanced
shapes stay in a "More" popover. Spec only until the knowledge flag ships.

### 4.5 Explain and Study Plan

- Explain: one question at a time, response area, optional dictation (`useDictation`), feedback
  below. Already structured that way; visual pass only.
- Study Plan: **not implemented** — stays in Planned. When built, present Beginning / Normal /
  Custom as three cards with one sentence each; Custom reveals the schedule editor.

## 5. Validation (2026-10-14)

- `npm run lint`: clean.
- `npm test`: 689 tests, 685 pass. The 4 failures predate this slice: three are the
  public-knowledge gate ("Public knowledge is stale", from `i18n.js` / `CatalogFocusWorkspace.jsx`
  edits made by several sessions today; hashes must not be blindly refreshed) and one is the
  document resolver test expecting `fileId`/`offline` from another session's
  `useCatalogDocument.js` change.
- `npm run typecheck`: one error, `useCatalogDocument.js(52)`, same other-session change.
- Playwright (Chromium, scratch e2e build): shell-navigation, sidebar-density, coming-soon,
  lock-in-coming-soon, viewport-shell, responsive-p0, interaction-states (63 pass, 3 skipped);
  focus-workspace-controls / -responsive / -a11y (45 pass). `ipad-dashboard-scroll` mascot widths
  failed once under 2 workers and passed alone (contention).
- Screenshots reviewed: 1440×900, 1112×834, 834×1194, 1024×600, 390×844, 320×568, Arabic RTL.

Not verified: WebKit project, real iPad/iPhone, light-theme screenshots (the override used in the
capture script did not take effect), production build (`npm run build` is blocked by the
public-knowledge gate).
