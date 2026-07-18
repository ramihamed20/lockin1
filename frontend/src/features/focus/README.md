# Focus workspace domain

Focus is a standalone product module. Its only platform integration is the authenticated Focus API; assessment, community, AI, motivation, billing, and notification modules are not imported here.

- `renderer/` owns the PDF.js adapter and page resource cleanup.
- `viewer/` owns virtual page activation and viewport navigation.
- `annotations/` owns normalized, renderer-independent annotations and command history.
- `toolbar/` and `workspace/` own controls, notes, and page navigation.
- `autosave/` owns incremental server sync and account-scoped IndexedDB recovery.
- `extensions/` exposes bounded presentation slots. It contains no feature implementations.
- `contracts/` is the stable boundary shared by all of the above.

The original PDF is never modified. A finger pans the viewport while pen/mouse input can annotate. Pressure and tilt are retained only when browser pointer events report them; browser-level palm rejection is not claimed.
