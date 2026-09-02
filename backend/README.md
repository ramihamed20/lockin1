# Lock-in backend

Django/DRF modular-monolith foundation. Domain packages live in `apps/`; cross-cutting,
domain-neutral primitives live in `platform_core/`. Business modules own their events and do not
import another module's models directly without an explicit integration boundary.

The Accounts domain owns same-origin session/CSRF authentication, single-use verification and
recovery links, roles, browser sessions, security records, and scoped database throttling. Raw
account tokens are never stored.

## Running the tests

`python -m pytest` against a real PostgreSQL is the authoritative run, and it is
what CI executes.

`LOCKIN_TEST_USE_SQLITE=true` exists for a workstation with no PostgreSQL
service. It is a fast syntax and business-logic check, not an equivalent one.
**SQLite reports `has_select_for_update = False`, so Django discards every
`select_for_update()` instead of emitting it.** A green SQLite run is therefore
no evidence at all about row locking, and it cannot see a query PostgreSQL
rejects outright — `FOR UPDATE` against the nullable side of an outer join being
the case that actually reached this repository.

Concretely, that means:

- Any change touching `select_for_update()`, `select_related()` on a nullable
  foreign key, or transaction boundaries must be validated on PostgreSQL.
- Combining `select_for_update()` with `select_related()` across a nullable
  relation needs `of=("self",)` so the lock names the row being modified rather
  than the whole join. If a related row is also read-modify-written, lock it
  explicitly instead of widening the join.
- `of=("self",)` is safe on SQLite: Django only validates it after the
  `has_select_for_update` check, which SQLite fails first.
