# Background and split-screen recovery — 2026-10-29

Target: `codex/lockin0.1.5`, based on `9622841c51dd1c7218538bdc082f384798ad85e3`.

## Confirmed defects and changes

- **Editing during a server refresh:** refresh reconciled the local snapshot captured before its network reads. A delayed-download regression reproduced loss of a new stroke and restoration of an erased stroke. Refresh can now read the current annotation, note and virtual-page refs after downloading, for both workspace and annotations-only documents. Responses for a replaced sync instance are ignored. The browser regression also verifies that concurrent local and remote ink reaches the server.
- **Unexpected IndexedDB closure:** the annotation store retained a resolved connection promise after an unexpected close. It now invalidates that promise on `close`, allowing the next operation to reopen the database. Connection identity guards prevent a late close/version-change notification from invalidating its replacement. Normal reader teardown still waits for pending writes.
- **Keyboard and split-screen video bounds:** the floating player used the layout viewport and window resize alone. It now observes visual-viewport resize/scroll, constrains its dimensions to the available visual viewport, and includes viewport offsets in drag/resize bounds.
- **Interrupted video gestures:** capture loss, blur, page hiding, fullscreen changes and resizing now release gesture state and pointer capture. Cancellation does not toggle playback. The iframe remains mounted across these transitions.
- **Duplicate access reads:** focus, visibility and polling could start overlapping subscription snapshots. An in-flight read is now shared. A blocking expiry check can promote that read to blocking, and completion/failure releases it for the next check. Backend access rules, expiry validation, polling frequency and account scoping are unchanged.

## Validation

- 133 targeted Node tests passed: annotation-store lifecycle, workspace storage, catalog/Focus sync, video bounds, subscription session/flow, workspace engine, PDF detail area and Pomodoro.
- 7 WebKit browser tests passed: server sync across devices, reconnect/idempotency, writing during delayed refresh, interrupted video gestures, phone/iPad visual-viewport bounds and duplicate subscription refresh/retry.
- 20 adjacent WebKit browser tests passed: PDF background recovery, pointer interruption, hidden-tab flushing, immediate navigation after writing, database cleanup, page persistence, account isolation and backup restore.
- Targeted ESLint, TypeScript checks, E2E build and `git diff --check` passed.
- Public-help claims referencing `CatalogFocusWorkspace.jsx` were reviewed against the surgical sync-only change; their wording and availability are unchanged. Its evidence digest was updated, and the build's evidence gate passed.

WebKit ran with touch enabled for the new video tests and the existing PDF-recovery tests. Missing browser runtime libraries were supplied from a scratch directory; this does not change application dependencies.

## Limits

These are automated browser and unit checks. They do not reproduce Spotify, native Picture-in-Picture, iOS process termination or a physical iPad keyboard. Visual-viewport keyboard geometry and lifecycle transitions are simulated. Existing visibility/pagehide flushing and navigation recovery are covered; an operating system force-killing the process before an asynchronous write commits cannot be guaranteed to preserve the final unsaved input.
