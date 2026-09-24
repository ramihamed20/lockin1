# Catalog Focus Workspace audit and implementation plan

Status: implementation in progress, 2026-09-23. This document concerns the catalog sheet workspace in `CatalogFocusWorkspace.jsx`, not the independent `/focus/{document_version_id}` shell described in `FOCUS_MODE.md`.

## Existing architecture

| Concern | Owner | Preserve or change |
| --- | --- | --- |
| Reader and PDF rendering | `frontend/src/workspace/catalog/ContinuousA4Pdf.jsx` | Preserve PDF.js loading, page measurement, visible-page rendering, canvas eviction, page restrictions, and reading-position callbacks. |
| Workspace state and tools | `frontend/src/pages/CatalogFocusWorkspace.jsx` | Keep the working pointer/zoom/Active Study integration; extract bounded pieces over time because this component still owns too many unrelated states. |
| Stroke geometry and input | `frontend/src/workspace/ink/*` | Preserve pointer buffering, pressure, live ink layer, palm rejection, gesture state, erasers, and shape recognition. Tune recognized gestures with direct tests. |
| Local recovery | `frontend/src/workspace/storage/annotationStore.js`, `workspaceSnapshot.js`, `catalogWorkspaceState.js` | Preserve immediate local state, debounced IndexedDB writes, localStorage fallback, and visibility/unload flush. |
| Remote persistence | `frontend/src/workspace/catalog/catalogServerSync.js`, `focusAnnotationAdapter.js`, catalog workspace and Focus APIs | Preserve revisioned/idempotent sync and edition/view scope. Extend wire fields additively. |
| Active Study | `frontend/src/pages/CatalogFocusWorkspace.jsx` and Active Study API | Preserve source PDF page numbering, restrictions, checkpoints and student progress. Inserted pages are never source pages. |
| Export | `frontend/src/workspace/catalog/workspaceExport.js` | Export an annotated copy; original download remains unchanged. Rendering is currently raster based. |

The catalog route distinguishes University and Lockin editions and study and summary views in its document scope. The Focus annotation collection uses that scope. A catalog workspace snapshot provides page, zoom, notes, and inserted-page data for study sheets. Summary documents currently lack a corresponding catalog reader-state snapshot; their inserted pages remain in local recovery and JSON backups. Rich objects on source PDF pages that the Focus annotation API cannot represent also remain device local. These are material cross-device gaps.

The original reader already lazy-renders nearby PDF canvases and releases distant ones. Gesture handling already differentiates stylus and touch, supports pinch/pan, and avoids per-move persistence. The toolbar and object tools existed in the working tree before this audit; they were not replaced. Duplicated or fragile areas include separate local/server annotation shapes, several PDF page vs inserted-page branches in the large route component, and viewport-height media rules that can change reader geometry as a virtual keyboard opens.

## External references and licensing

- [Open Note](https://github.com/open-tolls/open-note): layered ink/PDF interaction and tool state; MIT.
- [perfect-freehand](https://github.com/steveruizok/perfect-freehand): pressure, thinning, smoothing, streamline, and outline generation; MIT. Lock-in already has stroke geometry and live rendering; adopt specific behavior only after latency and pressure comparisons show a gain.
- [Excalidraw](https://github.com/excalidraw/excalidraw): selection, object transforms, undo/redo, and keyboard interaction; MIT. Use as an architecture reference, not a replacement reader.
- [Xournal++](https://github.com/xournalpp/xournalpp), [Saber](https://github.com/saber-notes/saber), and [Rnote](https://github.com/flxzt/rnote): PDF annotation and note page UX references. Do not copy GPL source into Lock-in.

## Target architecture

The PDF remains immutable. One workspace document contains ordered page descriptors and objects with stable IDs. A descriptor is either `{ id, type: "pdf", sourcePage }` or `{ id, type: "workspace", insertAfterSourcePage, background }`. Existing negative numeric inserted-page IDs are stable and retained for compatibility; an API migration to string IDs is unnecessary now. The rendered page list composes these descriptors for navigation. Active Study, restrictions, checkpoints, and the original download continue to use `sourcePage` and the original PDF page count.

Each visible page has its own PDF or patterned background layer, SVG/object annotation layer, and pointer interaction layer. The tool palette owns active tool and contextual settings; the route coordinates sheet scope, page navigation, history, local recovery, and server sync. History records user edits such as objects and page insertion/removal, never server reconciliation or Active Study updates. Versioned local snapshots and compatibility parsing keep older marks readable.

## Staged delivery

1. Preserve reader boundaries and establish inserted-page identity and source-page invariants. Completed for existing catalog workspace pages.
2. Organize the toolbar and contextual settings. Implemented in the current working tree; responsive checks continue.
3. Tune ink, highlighter, eraser, and recognition using pointer/geometry tests. Core behavior and an opt-in smoothing toggle for new handwriting are implemented; physical Pencil validation remains.
4. Selection, shapes, text, cards, and images. Object tools exist; this change adds multiline text formatting and an edit path.
5. Insert blank, ruled, grid, and dot pages with isolated marks and undo/redo. Implemented locally and in study sheet snapshot sync.
6. Preserve optimistic save, offline recovery, edition isolation, and legacy annotations. Existing infrastructure retained; summary and rich-object cross-device persistence remain future work.
7. Export annotated copies with inserted pages while preserving the original. Implemented with raster output; selectable PDF text remains a quality limitation.
8. Complete browser, accessibility, long-document, and real iPad validation. Automated Chromium and WebKit coverage is broad; physical iPad validation still needs a device-capable pass.

Changes to backend persistence for summary documents or additional object types should be additive and versioned. Do not turn inserted pages into Focus source pages or alter planner/checkpoint inputs.
