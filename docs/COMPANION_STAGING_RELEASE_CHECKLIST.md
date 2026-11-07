# Study Companion (Starmo / Starsea) — Staging release checklist

**Scope:** Focus Workspace student companion, profile selection, phone toolbar (+) launcher, persisted phone drag position, curated learning cards and admin JSON import.

**Release policy:** Staging-only changes are not production authorization. Do not publish invented page-specific medical content; reviewed, source-matched PDF cards must exist before claiming the curriculum is covered.

## Implemented in staging

- Existing six kinds support short explanation, side fact, simplification, memory aid, organization and connections.
- The generation prompt now explicitly invites grounded confusing-term comparisons, misconceptions and short educational clinical examples **within these six kinds**, without introducing new database choices.
- Source-specific content requires the physical PDF page index. General advice is visibly distinct and never masquerades as a PDF explanation.
- Page-specific published cards appear before sheet-wide cards. Student cards display kind and PDF page.
- Admin content studio exposes the published card count, unique linked pages and draft count, and warns when no cards are published.
- Existing responsive lesson, settings, saved ideas, motion and toolbar/drag controls are retained.

## Required release gates (not yet verified in a deployed browser)

1. **Frontend validation:** with project-supported Node 24 and dependencies, run `cd frontend && pnpm test && pnpm typecheck && pnpm lint && pnpm build`.
2. **Browser behavior:** run the relevant Playwright suites for `companion-ready.spec.js`, `companion-import.spec.js`, `profile-companion.spec.js` and Focus Workspace smoke suites. Test both RTL Arabic and English, phone portrait/landscape and iPad, including + launcher, drag, saved position, hide/restore, reduced motion and long explanations.
3. **Backend verification:** against an authorized test PostgreSQL database, run the content tests for `test_study_assistance.py` and `test_assistance_import.py`. Verify permissions, CSRF, edition/view/version isolation, publishing and stale-preview conflicts.
4. **Content readiness:** attach the correct PDFs to each selected sheet; generate <=40 source-grounded cards per sheet, review their accuracy, check page numbers and import with preview/confirmation. Publish reviewed cards and use the admin coverage indicator to spot unprepared sheets. No generated content has been uploaded by this code change.
5. **Staging signoff:** verify real devices, account switch, slow/offline network, API failures, accessibility labels, and that the Focus reader's PDF gestures/toolbar still work. Only promote to production after approval and passing release checks.

## Rollback

Revert only the companion-related commits on `staging/lockin-preview` if a regression appears. These changes do not require a database migration.
