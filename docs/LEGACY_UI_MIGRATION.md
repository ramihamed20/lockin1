# Legacy Visual Migration

## Rule of Record

`Dentify-Before-Edits\client` is a read-only visual reference only. Its mock backend, Supabase
integration, routing, state, and data models are not part of Lock-in.

`Dentify-Rebuild\frontend` remains the technical owner of routing, React/TypeScript, Django API
access, cookie/CSRF authentication, permissions, validation, PWA behavior, and tests.

## Slice 1 — Completed 2026-07-20

- Imported the complete legacy stylesheet unchanged as `src/legacy/legacy.css` and copied its
  required public assets.
- Rebuilt the legacy App Shell: Sidebar, grouped navigation, streak card, search, theme controls,
  notification menu, profile menu, responsive bottom navigation, and keyboard-safe mobile drawer.
- Rebuilt the legacy Login screen against `AuthProvider.login`; it retains current CSRF/session
  handling, errors, submission lock, Enter submission, and redirect behavior.
- Rebuilt the legacy Dashboard card hierarchy using real dashboard, learning, XP, and streak API
  responses. Unavailable data has explicit loading/empty states; no visual fallback data is used.

## Deliberate Boundaries

- The old demo-account button, mock backend, Supabase calls, static notification list, and local
  fake streak/freeze logic were not migrated.
- The old shell is rebuilt as typed components, not copied as legacy JSX.
- Current role checks still determine which management navigation appears.
- Focus, assessment, commerce, community, operations, and creator domains remain technically
  independent. Their pages will receive the legacy visual language one at a time.

## Validation

- TypeScript and ESLint: passed.
- Vitest: 29 files / 158 tests passed.
- Production PWA build and gzip bundle budget: passed; CSS gzip is 46,379 B (limit 81,920 B).
- Browser screenshot QA was not run on this workstation because `npx` (required by the approved
  Playwright CLI workflow) is unavailable. It remains a review/staging check.

## Next Gate

Owner review is required before migrating any additional page. The next candidates are learning,
assessments, progression, community, billing, and operations, one bounded slice at a time.
