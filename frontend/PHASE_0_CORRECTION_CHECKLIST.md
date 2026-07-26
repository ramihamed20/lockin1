# Phase 0 correction checklist

## Audit outcome

- The rejected Phase 0 source files are no longer present. The current implementation still uses
  one generic API adapter in src/lib/api.js.
- Django uses same-origin, HttpOnly session cookies and X-CSRFToken; it has no JWT or refresh-token
  contract.
- GET /api/v1/auth/session returns a user object. GET /api/v1/operations/session is separate and,
  for a user with overview.view, returns roles, capabilities, dashboards, and timezone.
- The current PWA caches /api/ responses and must be replaced with a static-only service worker that
  removes the obsolete private-response cache during activation.

## Corrections to complete

1. Add one relative-path-only API client with CSRF, JSON/FormData/204/binary support, normalized
   Django errors, and a non-secret session marker.
2. Add exact session and operations-session normalizers, P25/cursor helpers, product-role and
   capability helpers, and a routed authenticated guard.
3. Wire 401 events to React authentication state; show retryable boot failures and safe failed
   logout feedback without attempting to access HttpOnly cookies from JavaScript.
4. Remove fabricated API success responses. Keep phase-later screens visually intact through their
   existing unavailable/error treatment rather than pretending the backend supplied data.
5. Replace PWA API runtime caching with static-asset precaching only and delete the old cache name.
6. Add focused lint, JSDoc type checking, and fetch-mocked Phase 0 tests.
7. Verify real session/CSRF flows, origin rejection, route guard behavior, service-worker output,
   responsive visual preservation, build output, and the backend boundary.
