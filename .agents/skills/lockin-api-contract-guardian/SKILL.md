---
name: lockin-api-contract-guardian
description: Protect the Lock-in frontend/backend REST contract when endpoints, serializers, error shapes, permissions, pagination, fields, or frontend API consumers change. Use for any cross-stack API modification or mysterious frontend/backend mismatch.
---

# Lock-in API Contract Guardian

Treat the API as a versioned contract, not an implementation detail.

## Scope

Check the full path:

Django model/service
→ serializer/schema/view
→ `/api/v1/` endpoint
→ auth/permission/error envelope
→ frontend API client
→ consumer state/rendering
→ tests

## Before changing a contract

Identify:
- endpoint and HTTP method
- request shape
- response shape
- error codes
- auth/session requirement
- permission/entitlement behavior
- pagination/filter/sort behavior
- frontend consumers
- current tests
- OpenAPI exposure if applicable

## Compatibility rules

Prefer additive compatible changes.

Do not casually:
- rename/remove response fields
- change nullability
- change enum/state strings
- change date/time format
- change error codes
- change list/object shape
- move fields between nesting levels
- alter pagination semantics
- turn a previously idempotent request into a non-idempotent one

If an incompatible change is necessary, update all consumers and tests in one coherent change and document the compatibility decision.

## Error contract

Preserve:
- machine-readable error identity
- safe user-facing message mapping
- no stack traces/internal details
- no unauthorized existence leakage
- no answer keys or restricted content in student responses

## Authentication contract

Lock-in uses same-origin session auth.

When touching auth-sensitive APIs:
- preserve credentials behavior
- preserve CSRF requirements
- do not move session identifiers into browser storage
- verify anonymous/unauthorized/forbidden behavior separately

## Frontend consumer audit

Search:
- API client wrapper
- hooks/loaders
- pages/components consuming the response
- optimistic/pending state
- stale-cache/retry behavior
- tests and fixtures mocking the endpoint

Do not stop after backend tests pass if a frontend consumer is affected.

## Schema drift

When endpoint behavior changes:
- update schema annotations/serializers
- regenerate or inspect OpenAPI if the repo workflow requires it
- verify frontend assumptions against the implementation

## Validation

Minimum evidence for cross-stack changes:
- backend API test
- frontend unit/behavior test for changed interpretation
- E2E only when browser workflow/permissions/state transition needs it

Use `lockin-test-selector` when available.

## Output

API CONTRACT
ENDPOINT: <method path>
REQUEST: unchanged / changed
RESPONSE: unchanged / changed
ERRORS: unchanged / changed
AUTH/PERMISSION: unchanged / changed
CONSUMERS: <files/features>
COMPATIBILITY: compatible / intentionally breaking
VALIDATION: <tests>
