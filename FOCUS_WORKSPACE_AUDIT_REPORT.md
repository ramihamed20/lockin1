# Focus Workspace — Final Launch Hardening Audit

Date: 2026-08-29 · Branch: `codex/phase-11-production-readiness`

---

## 1. Executive summary

This pass targeted the launch risks that survived the previous audit: annotation
durability, session recovery, the three red authentication tests, and stylus /
lifecycle robustness. Six real defects were found and fixed, the largest being
that **annotation storage would have started failing silently at roughly 500
strokes on a sheet** — measured, not estimated.

Annotation persistence moved from a single synchronous localStorage blob to a
per-page IndexedDB store with per-account isolation, an idempotent migration, and
a verified backup/restore path. Session bootstrap now retries transient failures
behind a bounded backoff, recovers when connectivity returns, and no longer
renders server-authored technical detail. The three failing auth tests were
stale expectations from a deliberate product change and now cover the current
program → class cascade properly.

All gates are green: **170 unit, 80 Chromium E2E, 62 WebKit E2E, lint clean,
typecheck clean, production build clean.**

Real-device validation has still not happened. That is the single largest
remaining unknown and it caps the readiness score.

---

## 2. Previous risks and where they stand

| Risk carried in | Status |
|---|---|
| No real-device validation | **Still open.** `FOCUS_WORKSPACE_REAL_DEVICE_CHECKLIST.md` written for the owner to run. |
| Annotation persistence is localStorage-based | **Resolved.** Per-page IndexedDB store with migration and fallback. |
| No server/cloud sync | **Still open by design.** Local backup/restore added as the interim protection. |
| Failed session bootstrap has no retry/recovery UX | **Resolved.** Bounded automatic retry, offline awareness, working manual retry. |
| Three red auth E2E tests | **Resolved.** Root cause was stale expectations; coverage was widened, not weakened. |
| WebKit scenarios excluded for harness reasons | **Resolved.** All Focus Workspace specs now run on WebKit (62 tests). |
| Apple Pencil pressure / tilt / palm / multi-touch unverified on hardware | **Still open.** Code paths audited and unit-tested; hardware behaviour cannot be simulated. |

---

## 3. What was actually verified

Read and traced end to end before editing: `liveStrokeGeometry.js`,
`LiveAnnotationCanvas.jsx`, `strokeModel.js`, `elasticGesture.js`,
`CatalogFocusWorkspace.jsx`, `catalog-focus-workspace.css`,
`ContinuousA4Pdf.jsx`, `pdfRenderQueue.js`, `inkInputController.js`,
`eraserSession.js`, `gestureStateMachine.js`, `catalogWorkspaceState.js`,
`App.jsx` bootstrap, `api/client.js`, `api/accounts.js`, `AuthPage.jsx`,
`service-worker.js`, and the existing test suites.

The previous pass's claims were checked against the code rather than trusted. Two
turned out to need correction:

- The report implied the incremental live-stroke renderer was fully safe on any
  page. It is — but the *handover* to React was not: the canvas was cleared
  synchronously while the SVG appeared only after the next render. On a
  1,200-annotation sheet that gap measured **798 ms**, long enough to see the
  stroke blink out. Fixed (§5).
- "WebKit gate 42/42 passing" was true only because the specs that reload or
  intercept assets had not yet been written. Adding them exposed a genuine
  Playwright/WebKit limitation, now isolated and documented (§10).

---

## 4. Bugs found in this pass

| # | Severity | Defect | Evidence |
|---|---|---|---|
| 1 | **Critical** | Annotation saves serialized the entire sheet synchronously into localStorage. At 500 strokes the payload was **4.7 MB** and took **75 ms of main-thread time per save**; at 1,000 strokes **9.4 MB**. The ~5 MB localStorage quota means saves begin failing around 500 strokes, and the only signal was a visually-hidden status line. | Benchmark, §9 |
| 2 | **Critical** | Annotations were keyed by sheet only. Two accounts on one device shared, and could overwrite, each other's marks. | `focus-workspace-persistence.spec.js` |
| 3 | **High** | Leaving the workspace within the 750 ms autosave debounce discarded the last edits: the effect cleanup cleared the timer without flushing. | `focus-workspace-lifecycle.spec.js` |
| 4 | **High** | A second pointer (second stylus, or a mouse on a convertible) landing mid-stroke called `beginAnnotation` again, replacing `drawingPointerId` and silently discarding the stroke in progress. | `focus-workspace-lifecycle.spec.js` |
| 5 | **High** | The error sanitizer let runtime error names and stack frames through to the UI: `TypeError: Failed to fetch at http://host/api` rendered verbatim, exposing internal hosts. | `session-bootstrap.test.js` |
| 6 | **Medium** | A PDF page whose render threw was left blank with no message and no way to retry; a document that never finished downloading showed "Loading PDF…" forever. | `focus-pdf-recovery.spec.js` |
| 7 | **Medium** | Committed ink flickered on heavy pages (798 ms measured) because the live canvas was cleared before React painted the SVG. | §9 |
| 8 | **Low** | Notes/Highlights tab panels carried both `aria-label` and `aria-labelledby`; the redundant label competed with the tab name. | `focus-workspace-a11y.spec.js` |

Not defects, but worth recording: the three auth failures were **stale test
expectations** after the auth page moved to a Program → Class cascade, and the
WebKit reload failures were a **Playwright limitation**, not product behaviour
(§10).

---

## 5. Fixes implemented

### Data safety
- **`src/workspace/storage/annotationStore.js`** (new) — IndexedDB store, one
  `documents` record per sheet plus one `pages` record per page. Transactional
  writes, quota errors surfaced as a typed `WorkspaceStorageError`, unreadable
  page records dropped rather than failing the sheet, and a `versionchange`
  handler so another tab can upgrade the schema.
- **`src/workspace/storage/workspaceSnapshot.js`** (new) — the pure half:
  owner/document/page keys, change detection, sanitisation, export building and
  import validation. Fully unit-testable without a browser.
- **Change detection without serialization.** Every edit path produces new
  annotation objects, so a `WeakMap` of object identities gives an exact
  per-page signature. Only pages whose signature changed are written; cleared
  pages are deleted. An erase or transform that keeps an annotation's id is
  still detected, which an id-based diff would miss.
- **Per-account isolation.** Records are keyed `user:<id>` (or `device` when
  signed out). The workspace receives the user through the route.
- **Migration.** A legacy localStorage snapshot is moved into IndexedDB, read
  back and verified, and only then is the old key removed — so an interrupted
  migration retries instead of losing work, and a second run finds the migrated
  record and does nothing.
- **Fallback.** If IndexedDB is unavailable (some private-browsing modes) the
  workspace stays on the previous localStorage path rather than losing
  persistence altogether.
- **No save before hydration.** Loading is now asynchronous, so persistence is
  gated on hydration; an empty pre-load state can never overwrite a real sheet.
- **Flush on the way out.** Saves are flushed on unmount, on switching sheet or
  account, on `pagehide`, and on `visibilitychange → hidden` (which is far more
  reliable than `pagehide` on mobile).

### Backup / recovery
- Settings → **Backup**: *Export marks and notes* writes a versioned
  `lock-in-<material>-<sheet>-<date>.json`; *Restore from a backup* validates the
  file before anything reaches the workspace.
- Restore is **additive** — it never replaces an existing id — and is applied as
  an ordinary command, so it can be undone.
- A backup belonging to a different sheet requires an explicit confirmation.
- Import rejects: non-JSON, wrong kind, wrong schema version, arrays, `null`,
  oversized payloads (>8 MB), `__proto__`/`constructor`/`prototype` keys, and
  slugs that are not simple identifiers. Every annotation is re-sanitised, so a
  `javascript:` image source or an unknown annotation type is dropped. Text is
  stored as data and escaped by React at render time.
- Backups carry only document slugs, view state, annotations and notes — asserted
  by test to contain no token/cookie/session/password field.

### Session recovery
- **`src/lib/sessionBootstrap.js`** (new) — decides what is transient (network,
  408, 429, 5xx), the backoff (600/1500/3200 ms, hard cap of 3 attempts), and
  what the reader is told.
- Transient failures retry automatically with a "Reconnecting…" state and no
  action required; after the budget the reader gets a working **Try again**.
- Offline is detected: the workspace explains that work is saved on the device,
  does not burn the retry budget, and retries immediately when the connection
  returns.
- 5xx bodies are never shown verbatim; `normalizeUserError` now also filters
  runtime error names and stack frames (defect 5).
- Concurrent bootstraps are prevented while one is in flight.

### Auth
- The three failing tests were rewritten against the current cascade and now
  additionally assert that the class list is filtered by program, that changing
  program clears a class that no longer belongs to it, that classes from other
  programs never leak, and that a failed cohort request recovers on retry.
- Three new tests cover the bootstrap recovery paths above.

### Input / gestures
- One drawing pointer at a time: a second pointer arriving mid-stroke is ignored
  instead of taking over.
- Hold-to-pan (Space) releases itself on window blur, so leaving the window can
  no longer strand the Pan tool.
- The elastic spring integrates real elapsed time in fixed sub-steps and has a
  900 ms deadline, so a throttled or loaded device can no longer leave the
  document parked outside its committed geometry. (This also fixed five WebKit
  failures.)

### PDF
- A page whose render throws now shows "Page N could not be drawn" with a
  **Retry page N** button that re-enqueues only that page — the queue is keyed by
  page, so the retry replaces rather than stacks.
- A document that has not arrived after 15 s shows "This PDF is taking longer
  than usual." with a **Retry PDF** button, without aborting a slow download.

### Performance
- The finished stroke stays on the live canvas until React has painted the same
  stroke as SVG (defect 7).

### Accessibility
- Tab panels are named by their tabs only (defect 8).

---

## 6. Persistence architecture

```
IndexedDB "lock-in-workspace" (v1)
├── documents   key: "<owner>::<material>::<sheet>"
│                 { owner, materialSlug, sheetSlug, version, savedAt, view, notes }
└── pages       key: "<documentId>::<page>"   index: documentId
                  { documentId, page, annotations[] }
```

- **Isolation:** owner → material → sheet → page.
- **Versioning:** `WORKSPACE_DB_VERSION` for the schema, `WORKSPACE_RECORD_VERSION`
  for record and backup payloads.
- **Writes:** one `readwrite` transaction covering the document record, every
  changed page, and every removed page. Failure leaves the saved signatures
  untouched, so the next save retries exactly the pages that failed.
- **Reads:** one `readonly` transaction; a page record that fails sanitisation is
  skipped, not fatal.
- **Debounce:** 750 ms idle + `requestIdleCallback`, plus a 500 ms view-position
  save. Nothing is written per pointer sample.
- **Fallback:** localStorage, unchanged from before, when IndexedDB is refused.

Deliberately **not** done: a Web Worker for writes. Structured clone already
keeps serialization off the JSON path, and the measured save cost is now ~1 ms.

---

## 7. Test results

| Gate | Result |
|---|---|
| Unit (`npm test`, 26 files) | **170 passed**, 0 failed, 0 skipped |
| Chromium E2E (13 specs) | **80 passed**, 0 failed |
| WebKit E2E (11 Focus specs) | **62 passed**, 0 failed |
| Lint (`--max-warnings 0`) | clean |
| Typecheck (2 projects) | clean |
| Production build | clean |

New this pass — unit: `workspace-storage.test.js` (8), `session-bootstrap.test.js` (5).
New this pass — E2E: `focus-workspace-persistence.spec.js` (5),
`focus-workspace-lifecycle.spec.js` (6), `focus-workspace-a11y.spec.js` (5),
`focus-pdf-recovery.spec.js` (2), `focus-workspace-stress.spec.js` (2), plus 3
bootstrap tests in `auth.spec.js`.

Every defect in §4 has a regression test. Chromium and WebKit gates were each run
green twice consecutively.

---

## 8. Performance

Save cost, measured on the actual modules (5 runs each, one new stroke added):

| Strokes on a sheet | Before: serialize whole sheet | After: diff + write one page |
|---|---|---|
| 100 | 19.6 ms · 942 KB | 0.36 ms · 17 KB |
| 500 | 75.3 ms · 4,708 KB | 0.46 ms · 68 KB |
| 1,000 | 144.2 ms · 9,416 KB | 0.74 ms · 132 KB |
| 2,000 | 279.0 ms · 18,834 KB | 1.46 ms · 261 KB |

At 500 strokes the old payload was already at the practical localStorage ceiling.

Interaction, measured in-browser on a seeded 1,200-stroke / 12-page sheet
(~48,000 points):

- Sheet opens and renders all 100 strokes on page 1.
- Stroke commit (pointer-up → SVG present): **798 ms cold, 85 ms warm.**
- Ink is continuously visible across the handover (live canvas released only
  after React owns the stroke).
- Eraser dragged across a dense page stays responsive; one undo restores the page
  exactly.
- Only the edited page is rewritten; the other 11 page records are untouched.

Drawing-engine performance from the previous pass (incremental geometry, ~38 of
40 frames appended rather than repainted) was re-verified by unit test and is
unchanged.

---

## 9. Responsive and accessibility

**Responsive** — 16 combinations, on both engines: 320×568, 360×800, 390×844,
412×915, 768×1024, 820×1180, 834×1194, 1024×1366, each in portrait and landscape.
For each: no control escapes the viewport, no document-level horizontal overflow,
the workspace exactly fills the viewport, the page dock and the pen palette stay
on screen with the palette open, and all nine tools remain reachable through the
scrollable rail. Additionally verified: resizing to landscape phone geometry
while zoomed *and* with the palette open keeps both usable.

**Accessibility** — every visible, non-inert control in the workspace, the pen
palette and the settings panel has an accessible name; keyboard focus is visible
(`:focus-visible` outline confirmed on the actually-focused element); tabs expose
`role="tab"`/`tabpanel`, `aria-controls`, `aria-selected` and a roving tabindex;
popovers report `aria-expanded`; the study dialog is `aria-modal`, makes the rest
of the workspace inert, and traps Tab. Global shortcuts are suppressed while a
field or control has focus — verified for the page-number input (arrows, digits)
and the note textarea (Backspace, arrows, letter shortcuts) — and single-letter
shortcuts no longer fire with Ctrl/Cmd/Alt held.

Not verified: colour-contrast ratios and screen-reader announcement quality with
a real reader (VoiceOver/TalkBack).

---

## 10. Known limitations

1. **No real-device validation.** Nothing below the browser engine has been
   exercised on hardware.
2. **Pressure, tilt, palm rejection, true multi-touch** cannot be simulated. The
   code paths were audited (pressure is smoothed and falls back to a neutral
   width when unavailable; tilt defaults to no effect; palm heuristics respect
   pointer type and recency) and are unit-tested, but the *feel* is unverified.
3. **No cloud sync.** Work lives on the device. Clearing site data still loses
   it; export is the only protection. This is the largest remaining product gap.
4. **Playwright cannot intercept a service worker's own fetches** — in WebKit at
   all, and in every engine for cached `/assets/**`. Specs that re-navigate with
   a mocked API, or that need an asset request to fail, run with
   `withoutServiceWorker()` (the app's supported "no service worker" path). The
   real worker is still exercised by `focus-workspace.spec.js` on Chromium.
   This is a harness limitation: it was confirmed by observing that a reloaded
   WebKit page issued `/auth/session` (3 ms in `performance.getEntriesByType`)
   while Playwright's route handler saw no request at all.
5. **Frame-level ink continuity across the canvas→SVG handover is
   architectural, not asserted.** The `useEffect` releasing the canvas runs after
   paint; the test asserts the post-condition (canvas released once React owns
   the stroke), because observing the transient state is inherently racy.
6. **Concurrent edits to this repository were observed during the pass** —
   `OperationsAdmin.jsx` was rewritten and `creator-studio.css` appeared while
   tests were running, which broke one build mid-run. Results here reflect the
   tree as of the final gate run.

---

## 11. Launch blockers

**None in the Focus Workspace itself.** Every gate is green and every defect
found has a regression test.

One release-process condition remains: **section E of the real-device checklist
(data safety) must be run and pass on at least one physical device.** It covers
the paths where a hardware-specific failure would cost a student their work.

---

## 12. Launch readiness

### 8.5 / 10

Up from 8. What earns it: the largest data-loss mechanism is gone and measured
gone; per-account isolation closes a privacy and overwrite hole; leaving the
workspace, backgrounding it, or losing the window no longer drops edits; session
bootstrap recovers on its own; the auth suite is green for the right reasons; and
Safari's engine now runs the full Focus Workspace suite, which caught a real
spring-back defect that Chromium never showed.

What holds it back, and why it is not 9 or 10:

- **No hardware pass.** Handwriting quality, pressure, tilt and palm rejection
  are the core of this feature and are entirely unverified on a real iPad. A
  green browser suite cannot substitute for that.
- **No cloud sync.** Site-data loss is still unrecoverable without a manual
  export, and most students will never take one.

Neither is a defect; both are unknowns. They are worth roughly 1.5 points.

### Recommendation: **Limited launch**

Ship to a controlled group — a class or a beta cohort — after section E of the
device checklist passes on one iPad and one phone. Watch for lost-work reports
specifically. Move to a general launch once the full checklist has been run on
iPad + Pencil, iPhone, and one Android device, and once annotation sync (or at
least an automatic server-side backup) exists.
