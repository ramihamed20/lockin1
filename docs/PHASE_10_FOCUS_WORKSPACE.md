# Phase 10 - Focus Workspace

Last updated: 2026-07-18

## Outcome

Phase 10 turns Focus from foundation contracts into Lock-in's dedicated study workspace. It is a
separate frontend subsystem and backend domain, not a fullscreen wrapper around the learning page.
The original PDF remains immutable; sessions, workspace snapshots, annotations, recovery, and
rendering state are owned independently.

## Product redesign and reasons

| Redesign | Usability reason |
|---|---|
| Embedded browser PDF object to dedicated Focus shell | Removes global navigation and gives the document the majority of the viewport |
| Folder/viewer controls to persistent study tools | Keeps study actions adjacent to the page without turning content into file browsing |
| Render every page to virtual page activation | Keeps large documents responsive and releases canvas/render resources away from the viewport |
| Browser-close assumptions to incremental local/server recovery | Preserves work after refresh, temporary loss of connection, or process interruption |
| Renderer-owned marks to normalized annotation records | Keeps handwriting stable across zoom/device changes and allows future renderers without data migration |
| Generic responsive stacking to tablet workspace adaptation | Makes side panels overlay on phones while preserving document space and touch targets |

## Domain boundaries

The backend `apps.focus` domain owns:

- server-timed session lifecycle and ordered activity evidence;
- per-session workspace snapshots with optimistic revision;
- per-user/document-version annotation collections and collection revision;
- renderer-independent annotation records and soft deletion/restoration;
- idempotent sync receipts and bounded mutation batches;
- Focus-owned events.

Only `integrations.py` resolves an accessible published PDF version and its private primary file.
Focus models and business services do not import assessment, community, AI, motivation,
subscription, payment, or notification domains. The API boundary uses the generic entitlement
service for `focus.workspace`; no plan or subscription check exists in Focus.

The frontend `features/focus` subsystem separates `renderer`, `viewer`, `annotations`, `toolbar`,
`workspace`, `autosave`, `extensions`, and `contracts`. The route is lazy and outside `AppShell`.

## Session and workspace state

Each browser workspace has a stable client instance UUID. Starting with the same identifier is
idempotent, allowing refresh restoration without duplicate active sessions. Session duration comes
only from the server's started/paused/resumed/completed activity timeline; client duration is
rejected.

The workspace snapshot stores document/version/file references, current page, known page count,
zoom, open panel, active tool, bounded layout, future open-tab references, revision, and update time.
Page count becomes immutable after it is known. Updates lock the row and require the expected
revision.

## PDF rendering and performance

`PdfDocumentAdapter` is the only module importing PDF.js. Phase 10 pins `pdfjs-dist` 5.7.284 and
loads its worker as a Vite asset. It accepts only same-origin authorized `/api/v1/files/` view URLs,
keeps range/stream support enabled, caps device-pixel rendering at 2x, cancels obsolete render
tasks, extracts available page text, and destroys the document on exit.

Every PDF page has a lightweight placeholder. Intersection observers activate canvas/text/
annotation rendering only within a measured prefetch margin and separately identify the genuinely
visible current page. Leaving the virtual range cancels rendering and releases page resources.
Zoom re-renders only active pages. The entire document is never placed in the service-worker runtime
cache.

## Annotation model and input

Annotations use normalized page coordinates and a tool-specific payload. Persisted tools are pen,
pencil, highlighter, line, arrow, rectangle, circle, text, and sticky note. Eraser is a workspace
command, not a stored annotation. Each record includes owner collection, document/version, page,
layer, bounds, payload, color, thickness, opacity, revision, and timestamps.

The client command reducer owns create/update/delete, undo, redo, pending upserts, and pending
deletes. Sync acknowledgements clear only the exact mutation version sent, so a newer local edit is
not lost when an older request finishes. Soft-deleted records can be restored with the same UUID by
undo. The backend strictly validates normalized geometry, payload shape, sample bounds, text length,
color, opacity, thickness, page count, batch size, idempotency identity, ownership, and revision.

Pointer Events distinguish pen, mouse, and touch. Browser-reported pressure and tilt are retained;
mouse receives a deterministic fallback pressure. Touch is reserved for pan/pinch/double-tap and is
not converted into ink. Lock-in does not claim perfect browser palm rejection.

## Autosave and recovery

The client writes an account/document-version-scoped IndexedDB recovery record before the debounced
server sync. Recovery records are schema-versioned, size-bounded, and deeply validated as untrusted
input before use. They contain no session cookie, CSRF token, answer key, or original PDF bytes.

Workspace and annotation changes sync incrementally. Visible state distinguishes server saved,
saving, locally safe, offline, conflict, and failed. A PWA update guard and `beforeunload` protection
remain active while changes are pending. Internal exit explicitly persists local recovery and
pauses the session. Completion is disabled until the server acknowledges all changes; successful
completion clears recovery.

## Accessibility, RTL, and responsive behavior

- The workspace has one named main landmark and an explicit document region.
- All tools are native named buttons inside a toolbar with pressed state and 44px targets.
- Page, zoom, panel, undo/redo, clear, save, retry, fullscreen, exit, and finish controls are
  keyboard reachable.
- Arrow/Page keys navigate; plus/minus zoom; B/N toggle panels; Ctrl/Cmd+Z and Shift+Z undo/redo;
  Escape returns to pan.
- Clear annotations requires confirmation. Save and recovery states use live text, not color alone.
- Available PDF text is exposed as a screen-reader alternative; image-only PDFs explicitly state
  that extracted text is unavailable rather than claiming canvas accessibility.
- High-contrast and reduced-motion preferences are respected.
- One English/Arabic RTL tree uses logical properties. Document geometry remains centered while
  controls follow interface direction.
- Desktop keeps an adjacent panel; phone/tablet panels overlay with bounded width so they do not
  consume most of the document.

## API surface

| Method and path | Purpose |
|---|---|
| `GET /api/v1/focus/documents/{version_id}` | Resolve authorized PDF descriptor, latest workspace, annotation revision, summary |
| `GET /api/v1/focus/sessions` | Paginated owner-scoped history |
| `POST /api/v1/focus/sessions` | Idempotently start/restore a workspace session |
| `PATCH /api/v1/focus/sessions/{id}/workspace` | Optimistic workspace snapshot update |
| `POST /api/v1/focus/sessions/{id}/{pause,resume,complete,abandon}` | Server-authoritative lifecycle transition |
| `GET /api/v1/focus/documents/{version_id}/annotations` | Bounded paginated page-range annotation load |
| `POST /api/v1/focus/documents/{version_id}/annotations` | Bounded optimistic idempotent mutation sync |

All endpoints require authentication, current content access, and the stable `focus.workspace`
entitlement. Responses use private/no-store API and file behavior already established by the
platform.

## Events and future extensions

Focus emits started, paused, resumed, completed, and abandoned events after commit. Consumers may
observe bounded session facts; they cannot mutate Focus state. No new event broker or external
infrastructure was added.

The frontend extension registry exposes bounded slots (`toolbar.after`, `sidebar.panel`,
`document.context-menu`, `session.summary`) with duplicate-safe namespaced IDs. These are integration
points only. Phase 10 does not implement AI, flashcards, timer, collaboration, voice, OCR, document
search, or shared annotations.

## Security and correctness

- Server owns access, lifecycle, duration, revisions, annotation ownership, and page bounds.
- Entitlement is checked before document resolution to avoid existence leakage.
- PDF URLs are same-origin private file endpoints; the client cannot select an arbitrary renderer
  URL.
- Original file checksum remains unchanged across annotation sync.
- Unknown fields, invalid payloads, oversized batches, stale revisions, ID collisions, and
  idempotency-key digest reuse fail closed.
- Annotation history is separate from PDF bytes and cannot overwrite the source asset.
- Recovery is treated as untrusted local input and never equated with a server acknowledgement.

## Validation and honest limits

Focused evidence completed during implementation:

- backend Focus Ruff/format/mypy: passed;
- backend Focus tests: 13 passed after restoration coverage;
- frontend Focus TypeScript/ESLint: passed;
- frontend Focus unit/component tests: passed;
- full backend: 165 tests and 85.37% coverage; lint/format/type/check/migration gates passed;
- full frontend: 158 tests with 90.87% statement / 80.39% branch / 87.21% function / 95.18% line
  coverage; ESLint, TypeScript, dependency audit, and PWA build passed;
- complete Playwright: 32 passed and 2 intentional mobile-only desktop skips; Focus passed real-PDF,
  autosave, notes, desktop/mobile Axe, Arabic RTL, and horizontal-overflow checks;
- the production deployment check exited 0 with no Django security or Focus schema warning; 96
  inherited drf-spectacular warnings remain explicitly tracked.

Local SQLite tests do not prove PostgreSQL concurrency. Browser automation cannot prove real Apple
Pencil latency, browser palm rejection, multi-hour memory stability, or representative hundred-page
textbook performance. Those remain explicit device/load evidence gates. No Redis, Celery,
WebSocket, broker, microservice, OCR/AI provider, or speculative worker was added.
