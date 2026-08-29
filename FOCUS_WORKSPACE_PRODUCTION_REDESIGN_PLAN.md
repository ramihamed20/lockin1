# Focus Workspace production redesign plan

Date: 2026-08-21
Status: implementation in progress

## Current architecture

The repository currently exposes two Focus surfaces:

- `/focus/:documentVersionId` uses `FocusWorkspace.jsx` and the older `FocusPdfWorkspace` / `PdfCanvasViewer` implementation embedded in `SheetStudy.jsx`. It owns Django session, workspace, and annotation synchronization.
- `/materials/catalog/:materialSlug/sheets/:sheetSlug/workspace` uses `CatalogFocusWorkspace.jsx`, the newer shared gesture utilities, `ContinuousA4Pdf`, a prioritized PDF render queue, an imperative live-ink canvas, and device-local annotation persistence.

The newer surface has the stronger pinch, elastic pan, momentum, spatial indexing, and render-cancellation architecture. The server-backed surface still contains a second large viewer and gesture system. Existing architecture documentation describes a modular `features/focus` graph that is not present in the current source tree, so the code rather than that document is the source of truth for this pass.

## Benchmark principles

The implementation follows these verified principles:

- PDF.js page viewports are the source of truth for page dimensions and rotation; A4 is only the default placeholder and optimization target.
- Pointer Events distinguish pen, touch, and mouse and expose coalesced pen samples, pressure, and tilt where the browser supplies them.
- Touch navigation remains available while pen input is active, with conservative browser-level palm filtering rather than a claim of native Pencil rejection.
- The document stays visually stable during pinch; high-quality PDF rendering resumes after geometry settles.
- iPad toolbars keep primary actions visible and move secondary settings into contextual UI. Phone UI does not expose the entire desktop toolbar permanently.
- Controls used with touch retain at least 44×44 CSS-pixel targets, safe-area insets, dynamic viewport sizing, and reduced-motion behavior.

## Prioritized implementation backlog

### P0 — release blockers

#### P0.1 Server-backed workspace remounts after workspace revision changes

- Problem: `FocusWorkspace` keys the viewer with the mutable workspace revision.
- Root cause: a server acknowledgement changes the React key and remounts the complete PDF/gesture/canvas subtree.
- User impact: visible resets, lost in-flight interaction state, avoidable PDF reloads, and memory churn after autosave.
- Solution: keep the viewer identity stable for the document version and let the existing prop/effect synchronization update restored values.
- Files: `frontend/src/pages/FocusWorkspace.jsx`.
- Implementation risk: low.
- Regression risk: restored state effects may apply an acknowledged workspace update without a remount; covered by focused tests and browser navigation.
- Validation: source regression test, Focus unit tests, production build, real browser save cycle.

#### P0.2 Offline drawings exist only in the active tab

- Problem: the UI calls the state “recovery,” but unsynced annotations are lost if the process or tab closes.
- Root cause: no IndexedDB recovery repository exists in the current frontend source.
- User impact: data loss after offline editing, iOS/PWA suspension, refresh, or a browser crash.
- Solution: add a schema-versioned, size-bounded, deeply validated IndexedDB record keyed to the document/client scope; write it before the server debounce, restore it explicitly, and clear it only after acknowledgement.
- Files: new `frontend/src/workspace/recovery/focusRecovery.js`, `frontend/src/pages/FocusWorkspace.jsx`, focused tests.
- Implementation risk: medium.
- Regression risk: stale records or unavailable IndexedDB; repository fails closed and never replaces a newer acknowledged record silently.
- Validation: repository unit tests with an injected storage boundary, reload/recovery browser flow, offline/online retry.

#### P0.3 PDF layout assumes every page is portrait A4

- Problem: every shell uses `297 / 210` even when the PDF page box or rotation differs.
- Root cause: layout geometry is generated before reading `PDFPageProxy.getViewport()`.
- User impact: stretched landscape/rotated pages, unstable annotation mapping, and incorrect scroll positions.
- Solution: use the first page viewport as the document default, record page-specific aspect ratios as pages activate, and keep A4 only as the initial fallback.
- Files: `frontend/src/workspace/catalog/ContinuousA4Pdf.jsx`, engine tests.
- Implementation risk: medium.
- Regression risk: page-shell height changes for mixed-size documents; anchored scroll and normalized annotation space are retained.
- Validation: portrait A4, landscape, rotated, and mixed-ratio fixture/unit coverage; phone/iPad screenshots.

#### P0.4 Fast scrolling can expose unrendered blank pages

- Problem: PDF rendering is fully suspended during scroll and custom momentum.
- Root cause: scroll/activity are treated the same as pinch geometry changes, even though page geometry is stable while scrolling.
- User impact: blank pages during a fast flick and delayed content after landing.
- Solution: keep old high-resolution canvases, permit prioritized low-resolution renders for newly encountered pages while moving, then promote visible pages to final quality after scroll settles. Pinch still suspends PDF.js work.
- Files: `frontend/src/workspace/catalog/ContinuousA4Pdf.jsx`, render queue tests.
- Implementation risk: medium.
- Regression risk: excess render churn on long flicks; single concurrency, cancellation, and priority remain enforced.
- Validation: render-queue assertions, long multi-page Playwright scroll, render-count/performance inspection.

### P1 — major UX, performance, and architecture

#### P1.1 Tablet and phone chrome competes with the document

- Problem: iPad portrait can reserve a 330px side panel, and phone exposes tools, colors, size, opacity, and input mode in one long permanent toolbar.
- Root cause: desktop groups are only made horizontally scrollable instead of structurally adapting.
- User impact: narrow PDF, hidden controls, accidental horizontal tool scrolling, and reduced one-handed usability.
- Solution: panels overlay below desktop width; phone retains a compact primary tool strip and opens color/size/opacity/input controls in a contextual bottom inspector. Preserve every tool and expose clear active state.
- Files: `CatalogFocusWorkspace.jsx`, `catalog-focus-workspace.css`.
- Implementation risk: medium.
- Regression risk: keyboard focus restoration and RTL drawer direction.
- Validation: 320/360/375/390/430 widths, iPad portrait/landscape/split widths, keyboard and Axe checks.

#### P1.2 Erasing and selection transformation enter React on pointer frames

- Problem: erasing mutates annotation state on repeated animation frames; object transforms can update the full annotation list for every pointer event.
- Root cause: committed document state also acts as live interaction state.
- User impact: progressive slowdown with many marks and avoidable reconciliation during Pencil movement.
- Solution: hide eraser hits imperatively and commit one reversible command on release; throttle selection previews to one animation frame and commit once.
- Files: `CatalogFocusWorkspace.jsx`, engine tests.
- Implementation risk: medium.
- Regression risk: cancelled gestures must restore temporarily hidden marks.
- Validation: cancellation tests, many-stroke browser stress pass, undo/redo after erase/transform.

#### P1.3 Dynamic viewport and PWA resume are not owned by the immersive surface

- Problem: CSS uses `dvh`, but the fixed workspace does not respond directly to `visualViewport` changes or resume anomalies.
- Root cause: viewport handling lives in the normal application shell, which is intentionally absent in Focus.
- User impact: keyboard/browser chrome can cover toolbars or sheets on iOS/iPadOS.
- Solution: publish the visual viewport height and offsets as workspace CSS variables, update on resize/scroll/orientation/visibility, and retain safe-area padding.
- Files: `CatalogFocusWorkspace.jsx`, `catalog-focus-workspace.css`.
- Implementation risk: low.
- Regression risk: transient resize loops; updates are animation-frame coalesced.
- Validation: phone keyboard, portrait/landscape, PWA-like viewport resize browser tests.

#### P1.4 Gesture and viewer duplication remains a maintenance risk

- Problem: the server-backed and catalogue routes own different high-risk viewers.
- Root cause: the newer engine was added alongside the Phase 10 viewer rather than replacing shared interaction/render layers.
- User impact: fixes can land in one route and regress in the other.
- Solution: treat `workspace/document`, `workspace/input`, `workspace/ink`, and the render queue as the shared source of truth; remove remount/recovery defects now and document the remaining server-adapter migration boundary rather than silently claiming the viewers are unified.
- Files: shared workspace modules, both route orchestrators, final report.
- Implementation risk: high for a full same-pass renderer replacement.
- Regression risk: backend mutation and local catalogue models are not identical. A forced rewrite could lose server tools or conflict behavior.
- Validation: both route test suites and explicit remaining-limit documentation.

### P2 — important polish

- Replace decorative modal blur/heavy radius with restrained product surfaces; add deterministic initial focus, focus containment, Escape behavior where dismissal is valid, and focus restoration.
- Add `-webkit-touch-callout` and selection containment to the document stage without blocking real text inputs.
- Make save, offline, Pencil, and render states concise and non-color-only.
- Ensure toolbar/page/panel semantics and Arabic/RTL placement remain correct.
- Remove dead or unreachable search state unless real PDF text extraction is connected.

### P3 — optional follow-up evidence

- Real Apple Pencil latency and palm-contact testing on supported iPads.
- Multi-hour foreground/background PWA memory soak.
- Representative 300+ page mixed-content textbook load with canvas/GPU memory telemetry.
- PostgreSQL concurrent workspace/annotation revision tests.
- Full migration of the server-backed viewer onto the newer catalogue interaction/render shell after an explicit annotation-adapter contract is approved.

## Validation matrix

- Static: ESLint, TypeScript, focused Node tests, full frontend test suite, production build, bundle budget.
- Browser: Playwright on 390×844, 430×932, 768×1024, 820×1180, 834×1194, 1024×1366, tablet landscape, and desktop.
- Interaction: page jump, slow/fast scroll, repeated pinch model tests, zoom anchor, panel/tool inspector, erase/undo/redo, offline recovery, orientation/viewport resize.
- Visual: normal, loading, error, annotation, panel open, compact toolbar, and Active Study modal states.
- Second audit: event/timer cleanup, stale render tasks, overflow, focus order, reduced motion, safe areas, and source/documentation divergence.
