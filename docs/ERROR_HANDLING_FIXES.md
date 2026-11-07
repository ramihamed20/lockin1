# Error handling fixes — 28 October 2026

The shared request path now reports failures in the selected language and keeps
their identity through page loading. A stalled CSRF bootstrap or response body
cannot leave a request waiting outside its deadline. Broken success JSON is an
explicit `invalid_response`, while HTTP 204 remains a valid empty response.

## Behavior

- The deadline covers CSRF preparation, transport, retries and response parsing.
  Cancelling one caller does not cancel another caller's shared CSRF bootstrap.
  Unsafe writes retain their existing retry policy; no new automatic write retry
  was introduced. A lost write confirmation asks the student to check state.
- HTTP error status remains authoritative even with a malformed error body:
  session expiry, Retry-After and safe X-Request-ID headers still work.
- ApiError preserves fields, additive `field_codes`, status, request reference,
  Retry-After and write context. `useAsyncData.error` remains a string for
  compatibility; `errorDetails` retains the structured error for ErrorPanel.
- Shared error panels show translated field details and support references, and
  disable read retries during the server's Retry-After window. Permission errors
  are not interpreted as subscription expiry or masked by an offline hint.
- Recovery and connection messages are localized. The offline banner no longer
  promises that every action will synchronize. Recovery copy does not assert
  that the user's latest work is safe without evidence.
- Study Plan displays the actual rejection, not one generic daily-limit or
  offline diagnosis. Timezone, duplicate days/subjects, week start, future
  completion and daily limits carry specific field rule codes. Drafts remain in
  their existing editors; revision conflicts retain the refresh action.
- Offline rejections keep structured field details rather than Python
  ErrorDetail representations. The durable queue preserves these details and
  access-lease reason codes. Existing receipt/idempotency/account isolation
  behavior is retained.
- Local save failures distinguish QuotaExceededError, SecurityError and unknown
  storage failures. The warning asks the student to keep the page open and back
  up their work. Annotation storage keys, editions/views and merge ownership
  are unchanged.

The message catalog in `userErrors.js` maps known codes and common field rules.
Authentication's existing specialized verification/recovery copy remains in
place. An unknown cause gets a truthful fallback; this change does not claim to
implement every speculative case in the earlier 239-case design catalog.

## Validation

- Complete frontend Node suite on codex/lockin0.1.5: 846 passed. ESLint, both TypeScript projects, normal
  production build, public-knowledge freshness and bundle budgets.
- Targeted backend tests for the exception envelope, account error contracts,
  offline replay and planner behavior: 105 passed and two PostgreSQL-specific
  cases skipped in the primary SQLite run. The SMTP transaction-boundary test
  hit a SQLite serialized-rollback setup error in that mixed run, then passed
  independently (one passed). All 106 selected cases passed when evaluated,
  but a clean combined PostgreSQL run is still required for release evidence.
- New regressions cover stalled response bodies, stalled/shared CSRF bootstrap,
  cancellation, malformed success/error JSON, uncertain writes, Retry-After,
  request references, field codes, CSRF vs permission denial, storage causes and
  legacy technical offline reasons.
- The planner timezone fixture also failed on the unchanged base commit because
  it created time-bounded access before moving the clock backwards. It now
  freezes time before creating that access. The 0.1.5 branch already contained
  this fixture fix; the port retains it without replacing it.
- Browser execution was blocked because the Chromium download was corrupt.
  The existing planner browser test was updated for precise field-error copy,
  but is not reported as passing locally. No actual iPad/touch or PostgreSQL
  concurrency evidence is claimed.

Public help claims were reviewed before updating only the affected source
digests; the verifier itself and published copy were not relaxed or changed.
No schema migration, payment-policy change, production data mutation or server
deployment is included.


## Port to codex/lockin0.1.5

Merged onto d51905a477a4665c638e090633cb88ed1d11e1c2. Conflicts were resolved
against the newer branch's code, retaining partial page loading, planner calendar
scrolling, StudyDock, sheet translation, new settings/experience messages and
updated layouts. Only error reporting changes were reapplied to those regions.
Frontend lint, types, build, public evidence and bundle budgets passed again.
