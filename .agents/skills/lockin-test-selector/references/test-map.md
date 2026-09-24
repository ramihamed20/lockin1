# Lock-in test map hints

Always inspect the live repository; filenames can evolve.

Known frontend families include:
- Active Study
- auth flow/validation
- catalog/materials
- Focus workspace
- PDF/range/zoom
- responsive/mobile/iPad
- RTL
- subscription
- questions/review
- PWA lifecycle/update

Known backend coverage spans domain apps under `backend/apps/**/tests`.

The root CI quality gate includes:
- backend audit/lint/format/type/migration checks
- PostgreSQL suite
- frontend audit/lint/type/unit/build/bundle checks
- Playwright browser suite
- container/image/runtime checks

Do not reproduce the whole CI gate locally unless the change warrants it.
