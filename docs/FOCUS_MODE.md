# Lock-in Focus Mode

Last updated: 2026-07-15

## Phase 3 Isolation Check

Phase 3 did not turn Focus into an authenticated PDF page. Account routes, design components, and
dashboard selectors do not import Focus renderer, annotation, gesture, toolbar, autosave, or storage
internals. The existing backend Focus domain and frontend subsystem contracts remain independently
testable and are reserved for their approved implementation phase.

The general application shell may later provide an entry into Focus, but the Focus workspace owns
its own immersive shell and previous-workspace restoration. Browser palm rejection remains
capability-dependent and will not be represented as guaranteed.
Status: Phase 2 architecture and core session domain implemented; workspace features deferred

## Product definition

Focus Mode is a flagship study product inside Lock-in. It is not a fullscreen PDF viewer and it is
not a cosmetic option on a content page. The document becomes the primary surface; global
navigation, dashboard, and community UI leave the workspace unless the student deliberately exits.

The product goal is a calm, long-session workspace that feels closer to a professional note-taking
application than a traditional education page, while remaining honest about browser and PWA
capabilities.

## Usability decisions

| Decision | Why it is better |
|---|---|
| Dedicated Focus application shell | Removes unrelated navigation and protects reading space |
| Adaptive toolbar with collapsed groups on phones | Keeps tools reachable without covering the document |
| Document, annotation, gesture, storage, and session subsystems | Prevents one giant component and makes each high-risk area independently testable |
| Finger pans while an active pen writes when supported | Matches tablet expectations and reduces accidental marks |
| Original PDF is immutable | Recovery, versioning, sharing policy, and source integrity remain understandable |
| Browser capability messaging is explicit | Avoids promising perfect palm rejection or stylus behavior a browser cannot guarantee |

## Phase 2 implementation boundary

Implemented now:

- `apps.focus` backend domain;
- UUID Focus session model with independent, study, and quiz context extension points;
- active, paused, completed, and abandoned lifecycle states;
- ordered persisted session timeline;
- start and idempotent completion services with row locking;
- completed-session summary selector;
- typed after-commit started/completed domain events;
- frontend annotation/workspace/pointer/session contracts;
- extensible tool registry covering pen, pencil, highlighter, eraser, line, arrow, rectangle,
  circle, text, and sticky note;
- PWA update guard contract for future active-session protection.

Not implemented in Phase 2:

- PDF rendering or PDF.js dependency;
- Focus route or dedicated shell;
- drawing canvas, annotation API, autosave, undo/redo, or IndexedDB recovery;
- pause/resume/abandon application services;
- quiz, lesson, achievement, anti-cheating, analytics, or AI subscriber;
- collaboration, OCR, voice, synchronization, or shared annotations.

## Backend domain

### Focus session

`FocusSession` stores user, context type/reference, lifecycle state, start/end time, planned duration,
active duration, and audit timestamps. PostgreSQL constraints enforce context/reference consistency,
end-after-start, and lifecycle/end-time consistency. Public identifiers are UUIDs.

The nullable `context_id` is an integration reference, not a Django generic foreign key. Study and
quiz domains do not exist yet. When those authoritative models are implemented, their application
services validate the reference and an approved migration may replace or supplement it with real
foreign keys. Focus does not import future quiz/content internals now.

### Session history and statistics

`FocusSessionActivity` is an ordered timeline owned by a session. The unique session/sequence rule
supports deterministic history. Session row locking serializes completion and future timeline
append operations.

Statistics are derived by selectors from authoritative completed sessions. No premature daily or
weekly aggregate tables exist. Measured query/load evidence will decide whether later snapshots
are required.

### Integration

The Focus service emits `focus.session_started` and `focus.session_completed` after the transaction
commits. Quiz, progress, achievements, analytics, and future intelligence can subscribe without
Focus importing their models. A subscriber is not allowed to rewrite the Focus session record.

## Frontend subsystem boundaries

| Subsystem | Responsibility |
|---|---|
| Workspace shell | Fullscreen state, minimal navigation, restoration on exit |
| PDF viewport renderer | Page lifecycle, zoom, pan, visible-page rendering, memory release |
| Annotation engine | Normalized coordinates, layer composition, selection, undo/redo commands |
| Tool registry | Tool metadata and extension without a central switch statement |
| Pointer/gesture controller | Pen/touch/mouse classification, pressure, tilt, pinch, double tap, pan |
| Annotation repository | Version-aware load/save/delete contract and conflict handling |
| Workspace state repository | Last page, zoom, thumbnails, selected tool, recovery state |
| Autosave coordinator | Debounce, batches, acknowledgments, retry, offline/pending truth |
| Keyboard commands | Accessible shortcuts and focus-safe command routing |
| Focus session gateway | Start/complete/pause integration with backend domain |

## PDF rendering direction

The implementation phase will use an adapter around a proven PDF renderer rather than letting its
types spread throughout the feature. The viewport will render only the current visible page range
plus a small measured buffer. Page canvases, text layers, and thumbnails outside that range are
released. Page state uses stable page numbers and normalized coordinates independent of zoom.

Required behavior before release:

- smooth vertical reading, jump-to-page, thumbnails, zoom, pinch, double-tap, and pan;
- last page and zoom restoration per user/document version;
- lazy page rendering and cancellation of obsolete render tasks;
- memory tests with representative large PDFs;
- no rerender of every annotation when viewport-only state changes;
- text layer/document outline or another accessible reading alternative where source PDFs allow.

## Annotation data contract

The original PDF is never modified. Every future persisted annotation includes:

- annotation UUID and owner UUID;
- document UUID and document-version UUID;
- page number;
- normalized bounds/points;
- tool and tool-specific payload;
- color, thickness, opacity;
- creation/update timestamps and revision.

The database annotation model is intentionally deferred until the Content/File/DocumentVersion
models exist. Creating unvalidated document UUID columns now would falsely imply referential
integrity. The TypeScript contract exists so renderer and tool work can remain independent.

Autosave must distinguish `saving`, `saved`, `offline pending`, `conflict`, and `failed`. A future
client recovery store may use account- and document-version-scoped IndexedDB. It is not a service
worker runtime cache, is validated as untrusted, is cleared on account boundaries, and never
reports a server save before acknowledgment.

## Stylus and gesture honesty

Pointer Events can identify `pointerType`, pressure, tilt, buttons, and contact geometry when a
device/browser supplies them. The implementation will use coalesced events when supported and
fall back safely when values are absent.

Palm rejection cannot be guaranteed by a web application. Device and browser behavior varies.
Lock-in can reduce accidental marks through pen-only writing mode, touch-action management,
contact filtering, and finger-panning rules, but product copy must never claim perfect rejection.

## Accessibility

- Native buttons and named controls for every toolbar action.
- Logical keyboard shortcuts with discoverable help and conflict checks.
- Visible focus and focus restoration when tool panels open/close.
- Screen-reader status for page, zoom, save, offline, and error changes.
- High-contrast state and no reliance on color alone.
- Reduced-motion alternative for toolbar and page transitions.
- Accessible confirmation before clearing annotations.
- Reading alternative/text layer where practical; the canvas itself is not claimed to make
  handwriting fully screen-reader accessible.
- Fullscreen is optional and exit remains obvious by keyboard and touch.

## Future extension points

| Future feature | Extension point |
|---|---|
| Split-screen notes / flashcards | Workspace panel registry and layout state |
| AI explanations / summaries | Permission-filtered intelligence port; no provider in Focus |
| Handwriting recognition / OCR | Versioned annotation/document processing adapter |
| Voice notes | New annotation payload/tool plus file-storage contract |
| Shared annotations / collaboration | Explicit ownership/share domain and conflict protocol; not hidden WebSockets |
| Cross-device cloud synchronization | Revision-aware annotation repository |
| Achievements | Focus completion event subscriber with deduplication |
| Anti-cheating | Separately approved policy subscriber/telemetry with accessibility review |

## Required test strategy

- Unit: tool registry, command history, coordinate transforms, pointer classification, state
  reducers, autosave state machine, version conflicts.
- Component: keyboard operation, toolbar adaptation, focus management, status announcements,
  reduced motion.
- API/PostgreSQL: ownership, session lifecycle, annotation constraints, revisions, idempotency,
  concurrent save/complete behavior.
- E2E: phone, iPad/tablet, stylus-capable browser where available, refresh recovery, offline/reconnect,
  large document, update during an active session.
- Performance: frame time, input latency, page-render cancellation, memory growth over hours, and
  hundreds of annotations.

Focus Mode is not complete until these measured behaviors exist. Phase 2 only makes them possible
without forcing a later architectural rewrite.
