# Lock-in backend

Django/DRF modular-monolith foundation. Domain packages live in `apps/`; cross-cutting,
domain-neutral primitives live in `platform_core/`. Business modules own their events and do not
import another module's models directly without an explicit integration boundary.

The Accounts domain owns same-origin session/CSRF authentication, single-use verification and
recovery links, roles, browser sessions, security records, and scoped database throttling. Raw
account tokens are never stored.
