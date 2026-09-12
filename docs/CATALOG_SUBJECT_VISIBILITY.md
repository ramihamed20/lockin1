# Why a student sees a subject

A student's Materials page lists the subjects their **cohort's content root
owns**. Nothing else decides it. In particular:

> **A subject does not need a sheet to be visible.** Subject A with 4 sheets,
> Subject B with 0 and Subject C with 12 are all listed. The sheet count is a
> property of the subject, never a condition of it.

---

## The chain

```
EducationNode (institution → college → department → academic_year → subject)
        │
        │  StudentCohort.content_nodes points at the year/batch node
        ▼
CatalogSubject          ← the projection: one row per (cohort, subject)
        │                 carries material_slug, the public Materials route key
        ▼
CatalogDocument         ← one row per published PDF, at material_slug/sheet_slug
        │
        ▼
LearningObjectVersion → ManagedFile   ← the protected bytes
```

`CatalogSubject` is a **projection** of the hierarchy, not a second source of
truth. It exists as its own table because the public route key has to be stable
and cohort-qualified, which a shared `EducationNode.slug` is not — two colleges
both teach "Physiology".

## What keeps the projection current

`apps/content/catalog_subjects.py` holds the rule, expressed once. It runs:

1. **On a hierarchy change**, via `apps/content/signals.py` — a subject node
   created or renamed, and a cohort's `content_nodes` changing. Both run on
   commit, so a projection can never roll back the edit that prompted it.
2. **At publish time**, via `_catalog_subject_for_node` in
   `apps/content/admin_services.py`, which projects a missing branch rather than
   treating it as absent.
3. **On demand**, via `manage.py sync_catalog_subjects` — for a database that
   predates the signals, and to see what would change first.

```bash
# Report what would change, and roll it back.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py sync_catalog_subjects --dry-run
```

```bash
# Reconcile.
docker compose -f compose.production.yaml run --rm backend \
  python manage.py sync_catalog_subjects
```

### What the projection deliberately will not do

- **It never deactivates a branch.** A subject vanishing from a student's page is
  the failure this module exists to prevent, so it is not something a background
  sync is allowed to cause. Retiring a branch stays an explicit operator action
  (`is_active=False`).
- **It never re-homes a branch to another cohort.** `material_slug` is what a
  student's bookmark and their saved workspace annotations hang off.
- **It never invents a curriculum.** A cohort with no content root has no
  subjects, and that is reported rather than guessed at.

## A cohort whose students see nothing

An active cohort with no `content_nodes` resolves to an empty Materials page.
That is a configuration gap, not a bug, and it is now stated rather than
discovered:

- `sync_catalog_subjects` lists such cohorts at the end of its run.
- `production_preflight` warns on them and reports them in its evidence as
  `cohorts_without_catalog_subjects`.

The fix is to attach a year/batch node to the cohort and re-run the sync. At the
time of writing, `medical-sciences-tripoli/preparatory` is in this state: it was
created by `education.0005` and never given a content root by
`education.0007`.

## Published is not the same as visible

Content Studio lists sheets straight from `LearningObject`, so it shows drafts
and it shows content that sits outside every cohort's Catalog. Two consequences
worth knowing:

- **A draft is visible in Content Studio and to no student.** The Add-sheet form
  defaults to Published for that reason; choosing Draft says so beneath the form.
- **A sheet under no cohort's content root is published and unreachable.** It is
  still publishable — that is a deliberate capability for material outside the
  student Catalog — but `serialize_sheet` reports `student_visible: false`,
  Content Studio badges it *Not visible to students*, and the "New sheet
  available" notification is **not** sent. Announcing a sheet nobody can open is
  worse than not announcing it.

## Admin and student see different queries

`CatalogMaterialListView` skips cohort scoping entirely for a user with
`content.manage` or the administrator role. A founder therefore sees **every**
branch in the deployment, and a student sees only their own cohort's. When "it
works for me but not for the student", this is usually why.

## Slugs must agree on both sides

Materials routes come from the server's `material_slug`; `Questions` still reads
the local catalogue in `frontend/src/lib/materialCatalog.js`. A slug that differs
between them resolves to nothing on one side. `education.0009` corrected
`removeable-prosthodontic` to `removable-prosthodontic` for that reason, and
`frontend/tests/catalog-visibility.test.js` now asserts the two stay in step.
