---
name: lockin-impact-mapper
description: Map the likely blast radius of a Lock-in code change before deep repository exploration. Use for bugs, features, refactors, API changes, state bugs, regressions, or when deciding which subsystems/files/tests are likely affected.
---

# Lock-in Impact Mapper

Build a compact impact map before deep implementation work.

## Goal

Reduce blind repository exploration. Identify the smallest plausible set of:
- backend domains
- frontend consumers
- persistence/state layers
- API contracts
- tests
- deployment/runtime surfaces

Do not read the whole repository when a narrow map can guide the work.

## Preflight

Read only what is needed to classify the request:

1. root and relevant nested `AGENTS.md`
2. `git status` and `git diff --name-only` when there are current changes
3. relevant package/config files only if the stack is unclear
4. filenames and imports around the reported feature
5. existing tests whose names match the feature

Prefer `rg`, `git grep`, import tracing, route lookup, and test-name discovery over opening large files immediately.

## Lock-in domain map

Treat these as important bounded areas:

Backend:
- `accounts`
- `content`
- `focus`
- `payments`
- `subscriptions`
- `entitlements`
- `questions`
- `assessments`
- `progress`
- `files`
- `education`
- `admin_control`

Frontend:
- `src/pages`
- `src/api`
- `src/components`
- `src/workspace`
- `src/pwa`
- responsive/theme/i18n layers

Cross-cutting:
- Playwright E2E
- PWA/service worker
- PDF.js reader
- object storage
- auth/session/CSRF
- subscription entitlement
- CI/container/runtime checks

## Mapping rules

For each task, identify:

### Primary surface
Where the user-visible or authoritative behavior originates.

### Authoritative state
Where truth lives:
- Django/PostgreSQL
- frontend transient state
- browser storage
- service worker/cache
- object storage
- derived projection

### Upstream dependencies
Inputs that can cause the behavior.

### Downstream consumers
UI, API, tests, jobs, or deployment surfaces that can be broken by the change.

### Risk links
Look specifically for:
- frontend/backend contract coupling
- edition/view scoping
- resumable state
- auth/session boundaries
- subscription/entitlement coupling
- file permission/delivery paths
- PDF/page navigation state
- PWA stale-cache behavior

## Stop condition

Stop mapping when you have a credible minimal boundary.

Do not keep expanding "just in case".

If evidence shows the bug is local, keep it local.
If evidence shows cross-system state, widen the map explicitly.

## Output

Before implementation, produce a compact block:

IMPACT MAP
PRIMARY: <area>
AUTHORITATIVE STATE: <where truth lives>
LIKELY FILES: <small set or patterns>
CROSS-SYSTEM LINKS: <none or list>
TEST FAMILIES: <unit/API/E2E names>
RISK: Low / Medium / High
UNKNOWN: <single most important uncertainty, if any>

Then hand off to the relevant implementation/guardian skill.
