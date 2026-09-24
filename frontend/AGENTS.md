# Frontend Guidance

Use `lockin-focus-pdf-guardian` for reader/Focus/PDF/Active Study work and `lockin-api-contract-guardian` for API-facing changes.

- Preserve mobile/tablet/desktop behavior, Arabic RTL, and accessibility.
- Do not store session identifiers or secrets in browser storage.
- PWA/service-worker changes must not cache private API responses or weaken update safety.
- For PDF/Focus changes, trace state ownership before editing large workspace files.
- Prefer surgical changes over broad rewrites of large JSX/CSS files.
- Run targeted node/Playwright tests selected by `lockin-test-selector`.
- Touch/WebKit behavior should be considered for tablet/iPad interaction changes.
