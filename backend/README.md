# Lock-in backend

Django/DRF modular-monolith foundation. Domain packages live in `apps/`; cross-cutting,
domain-neutral primitives live in `platform_core/`. Business modules own their events and do not
import another module's models directly without an explicit integration boundary.
