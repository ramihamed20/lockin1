---
name: lockin-test-selector
description: Select the smallest sufficient Lock-in validation set from the changed files and behavior, escalating from targeted tests to broader suites only when justified. Use after code changes, before declaring completion, or when CI cost/time should be minimized.
---

# Lock-in Test Selector

Choose evidence, not ceremony.

## Goal

Run the cheapest validation set that is likely to catch regressions introduced by the current change.

Do not run the entire test matrix after every small edit.
Do not skip high-value tests merely to save time.

## Inputs

Inspect:
- `git diff --name-only`
- changed code and nearby tests
- impact map if available
- relevant package/pyproject scripts
- CI rules when production behavior changed

## Validation ladder

### Tier 0 — static/local
Use when relevant:
- syntax/import check
- targeted lint
- targeted type check where supported
- Django `check`
- migration drift check for model changes

### Tier 1 — direct tests
Run tests that directly cover changed behavior.

Examples:
- one backend test file or test class
- one frontend node test file
- one Playwright spec
- one focused test pattern

### Tier 2 — adjacent regression family
Add tests for coupled behavior.

Examples:
- API + permission tests
- reader + zoom + persistence tests
- subscription + entitlement tests
- auth + CSRF/session tests
- responsive + RTL tests

### Tier 3 — subsystem suite
Use when:
- shared state/helpers changed
- multiple adjacent files changed
- a core abstraction changed
- targeted tests expose broader coupling

### Tier 4 — full quality suite
Use when:
- preparing release/merge to protected branch
- shared platform/core behavior changed
- dependency/build/runtime contract changed
- migration or production settings changed materially
- user explicitly requests full verification

## Lock-in routing hints

Frontend code:
- start with `pnpm test` only when a narrow node-test selection is not practical
- for browser behavior, use the smallest matching Playwright spec(s)
- build E2E bundle before browser tests when the repo requires it
- include responsive/RTL specs only when layout/direction can be affected
- include PWA specs when service worker/update/cache behavior changes

Backend:
- For targeted debugging evidence, run the specific pytest module/class/test with --no-cov. This repository adds project-wide coverage measurement and an 85% threshold through pyproject defaults; narrow runs should not fail only because they do not exercise the whole application.
- Keep the selected test assertions and relevant setup unchanged; --no-cov disables only coverage measurement for that targeted run.
- Include permission/API tests for privileged endpoints.
- Include PostgreSQL-specific tests for transactions, constraints, locking, and query behavior.
- Run migration drift checks when models/migrations change.
- For a full backend quality run or CI, do not use --no-cov; preserve the configured project-wide coverage report and 85% gate.

PDF/Focus:
- choose reader, zoom, persistence, touch/pinch, range-request, and relevant workspace specs based on actual change
- do not run every Focus spec for a text-only UI change

Subscriptions/payments:
- cover lifecycle + entitlement coupling
- prefer targeted state-transition tests before full backend suite

## Selection discipline

For each selected test, be able to answer:
"What regression would this catch?"

For each skipped expensive suite, be able to answer:
"Why is its covered surface outside the blast radius?"

## Failure handling

If a targeted test fails:
1. determine whether failure is caused by the change
2. fix or explain the failure
3. rerun the narrow test
4. widen only if the failure reveals broader coupling

Do not repeatedly rerun a full suite while debugging one failing test.

## Output

VALIDATION PLAN
DIRECT: <tests/checks>
ADJACENT: <tests/checks or none>
FULL SUITE: Yes/No
WHY: <short reasoning>

After execution:

VALIDATION RESULT
PASS: <checks>
FAIL: <checks>
NOT RUN: <expensive checks intentionally skipped>
CONFIDENCE: High / Medium / Low
