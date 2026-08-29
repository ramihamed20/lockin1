# Responsive UI — P0 & P1 handoff

> **بالعربية:** هذا الملف يحمل كل ما تحتاجه جلسة جديدة لمتابعة عمل الاستجابة (mobile / iPad / RTL).
> المرحلة 1 (تدقيق) والمرحلة 2 (P0) والمرحلة 3 (P1) **مكتملة ومختبَرة**، وكذلك الجزء الأكبر من P2 (القسم 2ب).
> الباقي مذكور في القسم 8. ابدأ بالقسم 3 (تشغيل بيئة الاختبار) — إعادة اكتشافها يكلّف وقتًا طويلًا.

**Branch:** `codex/phase-11-production-readiness`
**Full report (living document):** https://claude.ai/code/artifact/39c6a93f-b045-4428-bcf4-f5ac5b675fbd
**Last verified:** 29 Aug 2026 — Playwright 115 passed / 4 skipped (serial), unit 177/177, lint clean,
typecheck clean, bundle check clean. The 4 skips are `e2e/subscription-live.spec.js`, which needs a live
backend and is not part of this work.

---

## 1. What this work was

A responsive UI/UX audit of the Lock-in frontend across 7 phone widths and 8 tablet viewports in both
orientations, followed by two implementation passes. Findings were measured in a live browser against a
seeded backend, not inferred from CSS.

| Phase | Scope | Status |
|---|---|---|
| 1 | Audit only, no code changed | Done |
| 2 | All P0 (5 blocking findings) | Done + regression-tested |
| 3 | All P1, in the report's recommended order (5 stages) | Done + regression-tested |
| 4 | P2: quick wins, RTL correctness, translation coverage | Done + regression-tested — see §2b |
| 5 | Remaining P2 and below | **Not started** — see §8 |

---

## 2. What is fixed (do not regress these)

### P0

1. **Rotating a phone removed navigation.** The shell was chosen on width alone, so a landscape phone got
   the tablet sidebar with no bottom bar and no drawer button. Every shell breakpoint now carries a matching
   height condition; the compact shell claims `(max-width: 639px), (max-height: 559px)`.
   560px sits above every landscape phone (≤450px) and below every landscape tablet (≥744px).
2. **Arabic reader opened on blank canvas.** The initial horizontal scroll offset is now clamped to the range
   the current direction actually has (RTL scrolls 0 → negative).
3. **Remembered zoom was an absolute page width.** Now stored with the fit-to-width basis it was measured
   against and restored as a *magnification*. Views saved before the basis existed reopen fitted.
4. **iPad-landscape sidebar hid 295–361px of nav** behind an invisible scroll. The streak card collapses to
   one row under 1100px viewport height, rows tighten, and any remaining overflow is faded at the edge.
5. **7 of 12 workspace tools were off screen** (undo/redo among them). Below 560px the toolbar wraps instead
   of scrolling; all 15 controls are on screen at 44×44.

### P1 (five stages)

| Stage | Fixed |
|---|---|
| 1 — Layout tokens | `--mobile-header-height` was referenced 3× and **never defined** → replaced with measured `--app-header-height`. Sticky slit 11–17px → **0** on phone and tablet. Four competing `top` rules unified. JS media queries aligned with the new CSS condition. |
| 2 — Shared components | Sub-44px touch targets **15 → 0** on phone *and* tablet. Admin table → stacked records (740px in a 316px window → no sideways scroll at any size). Three simultaneous search fields → one. Quiz result ~700px → 112px; Study Plan ~700px → 157px. |
| 3 — Phone screens | Settings tab strip wraps below 360px instead of colliding. Quiz is immersive (top bar, bottom bar and sidebar stand down; each attempt screen has its own exit). 8px profile text → 11px floor. |
| 4 — iPad layout | Creator Studio dropped a whole nav layer: chrome 37% → **27%**, nested scrollers **4 → 0**. Dashboard landscape: working column 269px → **405px**, mascot 448px → 312px. |
| 5 — Copy & i18n | **99 → 0** user-facing "Django" strings, rewritten in product voice. Greeting punctuation moved into the locale (was a hardcoded Arabic comma in the English UI). Language control added to Settings → Account. |

---

## 2b. What the P2 pass fixed (do not regress these either)

### Quick wins

1. **The desktop sidebar hid navigation.** The height rule that rescued the iPad was capped at 1199px wide,
   so a 1440×900 laptop hid **193px** of destinations from an operations account behind an invisible scroll.
   Density is now *measured* (`useSidebarDensity`) rather than declared at a breakpoint, because how much
   room the list needs depends on the account — ten destinations for a student, thirteen for operations —
   which no media query knows. Measured after: 1440×900 **193 → 0**, 1512×982 **111 → 0**, 1920×1080
   **13 → 0**, 1366×768 **142 → 80** (announced by the edge fade, and every destination reachable).
   A roomy sidebar now keeps its streak card whole instead of collapsing on every laptop.
2. **`/dashboard` had no active nav item** and no `aria-current`; the shell matched "/" on equality alone.
   Both the sidebar and the bottom bar now use one shared `isNavigationItemActive`.
3. **"Personal" was printed twice** in the sidebar — Store and Progress sat either side of the Social pair,
   and the shell labels a group whenever it changes between consecutive items. Progress moved up next to Store.
4. **Search did not autofocus** when opened from the topbar icon. It does now, unless the visit already
   carries a query — then the results deserve attention more than the box does.
5. **Store badge contrast.** NEW measured 3.25:1 and LIMITED 2.97:1 on **Night only**; the three light themes
   already passed. The badges hardcoded white ink on an accent that is light in Night. They now use
   `var(--button-text)`, the ink each theme already publishes for a filled brand surface. All 20
   badge/theme combinations measured ≥ 4.5:1.

### RTL correctness

6. **Directional icons are mirrored.** `Icon` marks `chevron-left`, `chevron-right`, `arrow-left`,
   `arrow-up-right` and `logout` with `data-mirror-rtl`; one stylesheet rule flips them under
   `:root[dir="rtl"]`. Icons that mean a thing rather than a direction are left alone. Two ad-hoc
   `rotate(180deg)` hacks were removed, and the small "forward" nudges now use `--direction-sign`.
7. **Bidi isolation.** `dir="auto"` on the shared primitives (page headings, list rows, empty states,
   catalogue tiles and sheet cards, stat tiles, pagination) and on the counted runs across the student
   pages. Verified by measurement, not inspection: without the isolate the same node paints "3 sheets"
   with the digit at x=1057 and the final glyph at x=1047 — reversed.

### Translation coverage

8. **9 → 34 files call `t()`.** Every student-facing page is translated: Dashboard, Materials, Questions
   (incl. the demo quiz), Review (centre, bank, subject session, Weekly Recall), the quiz attempt flow
   (QuizDetail, Attempt, AssessmentResult, AttemptQuestionCard), Progress, Study Plan, Bookmarks,
   Achievements, Notifications, Search, Store, Profile, Lock In coming-soon — plus the shared components
   they lean on. The catalogue grew from ~200 to **1014 English keys** with matching Arabic.
9. **Counted phrases are pluralised.** `translate()` selects a variant from the `count` variable, so a key
   may be written as `.one`/`.other` in English and `.zero`/`.one`/`.two`/`.few`/`.many`/`.other` in
   Arabic. `{count}` also renders in the locale's own digits: "3 sheets" reads "٣ ملازم", correct *few* form.
10. **Dates follow the interface language.** Study Plan used `Intl.DateTimeFormat(undefined, …)` (the
    browser's locale); Progress hardcoded `["Mon", "Tue", …]`. Both now go through the i18n helpers.

---

## 3. Reproducing the test environment ⚠️ read this first

The app needs a backend. Do **not** use ports 5050/8000 — the developer's own stack may already be there,
and two Django processes on 8000 silently serve different databases (this cost real debugging time).

### 3.1 Scratch settings module

Create `<scratch>/audit_settings.py` outside the repo:

```python
from config.settings.local import *  # noqa: F401,F403

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": r"<scratch>\audit.sqlite3",
    }
}
ALLOWED_HOSTS = ["127.0.0.1", "localhost", "0.0.0.0", "testserver"]
```

`config/settings/local.py` uses Postgres and has `DEBUG = True` (needed — `seed_demo` refuses to run with
`DEBUG=False`).

### 3.2 Backend

```bash
cd backend
export PYTHONPATH="<scratch>"
export DJANGO_SETTINGS_MODULE=audit_settings
./.venv/Scripts/python.exe manage.py migrate --noinput
./.venv/Scripts/python.exe manage.py seed_demo
./.venv/Scripts/python.exe manage.py runserver 127.0.0.1:8010 --noreload
```

> **Re-run `migrate` if the API starts returning 500.** New migrations land on this branch while you work.
> One such failure (`no such column: accounts_user.username`) came from an unapplied
> `accounts.0007_username_and_welcome_state`.

### 3.3 Frontend

`pnpm` is not on PATH; call the local binaries directly.

```bash
cd frontend
VITE_DJANGO_PROXY_TARGET=http://127.0.0.1:8010 ./node_modules/.bin/vite --host 127.0.0.1 --port 5062
```

### 3.4 Demo credentials

| Account | Email | Password |
|---|---|---|
| Super admin (has student + admin + creator nav) | `admin@lockin.local` | `Admin123!` |
| Creator | `creator@lockin.local` | `Creator123!` |
| Student | `student@lockin.local` | `Student123!` |

The app uses a **hash router** — URLs are `http://127.0.0.1:5062/#/materials`, not `/materials`.
A PWA install interstitial blocks the login form on first load; click "Continue in browser".

To test RTL, change the account language in the DB (the app forces locale from `user.preferredLanguage`,
overriding `localStorage`):

```bash
./.venv/Scripts/python.exe -c "
import django; django.setup()
from django.contrib.auth import get_user_model
U=get_user_model(); u=U.objects.get(email='admin@lockin.local')
u.preferred_language='ar'; u.save(update_fields=['preferred_language'])"
```

…or now simply use **Settings → Account → Language** in the UI (added in stage 5).

---

## 4. Test gates

```bash
cd frontend
node node_modules/eslint/bin/eslint.js --max-warnings 0
node node_modules/typescript/bin/tsc --project tsconfig.phase0.json --pretty false
node node_modules/typescript/bin/tsc --project tsconfig.worker.json --pretty false
node --test tests/*.test.js
node node_modules/vite/bin/vite.js build
node node_modules/@playwright/test/cli.js test --reporter=line --workers=1
node scripts/check-bundle.mjs
```

**Always run Playwright with `--workers=1`.** At the default 4 workers this machine flakes on the heavy
PDF/IndexedDB specs — the failing set varies between runs and includes specs untouched by this work
(`public-information`, `auth`, `focus-workspace-a11y`). Every such failure passes in isolation. Serial runs
have been 95/95 consistently.

`tsc | tail` hides the exit code — check `$?` on `tsc` itself, not on the pipe. (This produced one wrong
"typecheck passes" claim mid-session.)

---

## 5. Files changed by this work

**New**

- `frontend/src/hooks/useScrollOverflow.js` — marks a scroll container with `data-overflow` (`none`/`start`/`end`/`both`) so CSS can fade the edge that still has content. iOS/iPadOS overlay scrollbars hide at rest, so a scrollbar cannot carry that information.
- `frontend/e2e/responsive-p0-regressions.spec.js` — 12 tests, one per blocking condition.
- `frontend/e2e/touch-targets.spec.js` — 3 tests; sweeps 16 routes under real touch emulation on a phone and an iPad.

**Modified — shell & layout**
`src/responsive.css`, `src/styles.css`, `src/components/layout/index.jsx`, `src/lib/constants.js`, `src/App.jsx`

**Modified — workspace (P0 zoom/RTL/toolbar)**
`src/pages/CatalogFocusWorkspace.jsx`, `src/pages/catalog-focus-workspace.css`,
`src/workspace/storage/workspaceSnapshot.js`, `src/workspace/storage/annotationStore.js`,
`src/workspace/catalog/catalogWorkspaceState.js`

**Modified — pages**
`src/pages/OperationsAdmin.jsx`, `src/pages/Settings.jsx`, `src/pages/Store.jsx`,
`src/pages/creator-studio.css`, `src/pages/study-plan.css`, `src/api/accounts.js`, `src/lib/i18n.js`

**Modified — copy pass (Django → product voice), 22 files**
`src/api/management.js`, `src/components/assessment/AttemptQuestionCard.jsx`,
`src/components/community/index.jsx`, `src/components/creator/index.jsx`, and pages:
`Achievements`, `AdminContentManagement`, `AssessmentResult`, `Attempt`, `Community`, `CommunityReport`,
`CommunitySpace`, `CreatorAssessments`, `CreatorContent`, `CreatorEducation`, `Discussion`, `LockInMode`,
`Moderation`, `Notifications`, `OperationsAdmin`, `Ranked`, `Search`, `Settings`

**Modified — tests updated to the new contracts (not worked around)**
`e2e/focus-workspace.spec.js` (seeds `zoomFitBasis`), `tests/workspace-storage.test.js` (backup shape),
`tests/materials-catalog.test.js` (measured toolbar height instead of a hardcoded row)

> ⚠️ **`frontend/src/workspace/**` is untracked in git.** Changes there will not appear in a commit unless
> the directory is `git add`-ed. Verify before committing.
>
> ⚠️ **`frontend/e2e/` is untracked too — the whole directory.** `git ls-files frontend/e2e` returns nothing,
> so *every* Playwright spec is uncommitted, including the P0 regression guards this document lists as new
> work (`responsive-p0-regressions.spec.js`, `touch-targets.spec.js`) and everything the P2 pass added.
> The suite runs locally and would find no tests in a fresh clone. `git add frontend/e2e` before committing.

### Added by the P2 pass

**New**

- `frontend/src/hooks/useSidebarDensity.js` — measures whether the sidebar's destinations fit and publishes
  `data-density` on the aside. It restores the comfortable layout before every measurement and reads the
  result synchronously, so the decision is always taken from the full-size baseline and cannot oscillate.
- `frontend/e2e/sidebar-density.spec.js` — 6 tests; the operations account across four desktop sizes, plus
  the two halves of the contract (a laptop hides nothing; a roomy sidebar keeps its streak card whole).
- `frontend/e2e/store-badge-contrast.spec.js` — measures every badge in every theme by painting the colour
  and reading the pixel back, because the badges resolve through `color-mix()` and `oklch()`.
- `frontend/e2e/shell-navigation.spec.js` — 6 tests: dashboard `aria-current` on both of its routes, one
  heading per nav group, and search focus behaviour with and without a query.
- `frontend/e2e/rtl-direction.spec.js` — 5 tests; glyph-order measurement for a Latin run inside an Arabic
  page, and the computed transform on directional versus non-directional icons.
- `frontend/e2e/translation-coverage.spec.js` — opens 14 student routes in both languages and fails on any
  visible text still shaped like a message key. This is the one mistake the catalogue makes silently.
- `frontend/tests/i18n-catalogue.test.js` — every English key has an Arabic entry, every counted phrase
  carries the categories its language needs, and no translation invents a `{placeholder}`.

**Modified — shell, icons, catalogue**
`src/lib/i18n.js` (plural selection + localised `{count}`), `src/lib/icons.jsx`, `src/lib/constants.js`,
`src/lib/notificationPresentation.js`, `src/lib/routeMetadata.js` (unchanged, but it is why page `<h1>`s
were already translated), `src/styles.css`, `src/responsive.css`, `src/components/layout/index.jsx`

**Modified — every student-facing page and the components they share** (see §2b item 8)

**Modified — tests updated to the new contract (not worked around)**
`tests/materials-catalog.test.js`, `tests/questions-workflow.test.js`, `tests/lock-in-mode.test.js`,
`tests/mobile-ui.test.js`, `tests/review-bank.test.js` — each now asserts both halves: the page asks for
the right key, and the English catalogue still says what the test was written to protect.

---

## 6. Decisions worth keeping

- **560px is the shell height boundary.** Above every landscape phone, below every landscape tablet. Changing
  it re-opens P0-1.
- **Measure, don't guess, chrome heights.** `--app-header-height` and `--workspace-toolbar-height` are
  published from `ResizeObserver` + `window.resize` + `orientationchange`. The bug class they replaced was a
  token referenced three times and defined nowhere.
- **A sticky child inside `.page-shell` must cancel the shell's top padding** (`top: calc(-1 * var(--page-shell-inset-top, 0px))`).
  Sticky is constrained by the scrollport's *content* box, so `top: 0` leaves the padding showing.
- **Touch floors are gated on `pointer: coarse`** and live in the stylesheet that owns each control, not in a
  central override, so they cannot be lost to a page-level rule loaded later.
- **Zoom is persisted as a magnification relative to fit-to-width**, never as an absolute page width.
- **Quiz attempts are immersive** (`.app-shell.is-answering`). Both attempt screens carry their own exit.
- **Sidebar density is measured, not declared.** The number of destinations depends on the account, so no
  breakpoint can decide this. Restore the comfortable layout, read the overflow, then set the result — that
  ordering is what stops it oscillating.
- **An identifier is never a label.** Where a value drives a CSS class, a filter or a comparison as well as
  the copy — store badges, cart item kinds, result-question status, dashboard stat cards — the id stays in
  English and only the label goes through `t()`. Renaming one without the other is the failure mode: it
  cost a silent break in the topbar notification list during this pass.
- **A counted phrase is not a string with a number in it.** Use the `count` variable and let the catalogue
  carry the categories; Arabic needs six where English needs two.
- **Never hardcode a date or a weekday name.** `formatDate` and friends already follow the interface
  language; `Intl.DateTimeFormat(undefined, …)` follows the browser's, which is a different thing.

---

## 7. Traps found the hard way

- **The in-app browser pane runs with `document.hidden === true`.** `requestAnimationFrame` never fires,
  `ResizeObserver` callbacks never fire, and `window.resize` never fires on viewport emulation. Anything
  rAF- or resize-driven **must** be verified in Playwright, not the pane.
- **The pane reports stale `getComputedStyle` / `getBoundingClientRect` right after a resize**, most visibly
  for transformed elements (the drawer read as closed while painting open). Reload after resizing, or assert
  on `offsetTop`/`offsetHeight`, which ignore transforms.
- **The pane only emulates touch below 768px width**, so `pointer: coarse` rules cannot be checked on an
  emulated iPad there — use Playwright device descriptors (strip `defaultBrowserType` before `test.use`).
- **Two Django processes can bind 127.0.0.1:8000 on Windows** and serve different databases. Use a private port.
- Screenshots taken mid-animation look like layout bugs. Wait out the 260ms drawer transition.

---

## 8. What remains

Nothing here blocks launch. Items 1, 2, 3, 4, 7, 11, 12 and 13 of the original list are **done** — see §2b.
What is left, roughly in value order:

1. **Translation coverage outside the student surface.** Every student-facing page is translated. Still in
   English only: the social pages (`Community`, `CommunitySpace`, `CommunityReport`, `Discussion`,
   `Ranked`), the workspace (`CatalogFocusWorkspace`, `LockInMode`, `LearningObjectStudy`), and
   Creator/Admin/Moderation (`CreatorEducation`, `CreatorContent`, `CreatorAssessments`,
   `AdminContentManagement`, `OperationsAdmin`, `Moderation`). `e2e/translation-coverage.spec.js` will
   catch a missing key once those routes are added to its list.
2. **Bidi isolation beyond the student pages.** The shared primitives carry `dir="auto"`, so anything built
   on them is covered; the pages above still interpolate counts into bare text.
3. **Catalogue data is still English.** Subject names ("Microbiology", "Oral histology") come from
   `lib/materialCatalog.js` and stay Latin in an Arabic interface. They are isolated correctly, so they read
   properly — but translating them is a content decision nobody has made yet.
4. **No back affordance on detail routes.** The manifest requests `display: standalone`, so installed users
   have no browser back either. Only the sheet detail page has one, placed below the content.
5. **Materials and Questions render identical screens three levels deep** — same card, same icon, same
   "16 pages" subtitle. No way to tell the study branch from the quiz branch.
6. **Quiz result arithmetic**: "Correct 2 / Incorrect 0 / Total 3" at 67% — unanswered questions are not
   represented. The demo quiz result in `pages/Questions.jsx` counts `correct`, `incorrect` and `total`
   but never shows the gap between them.
7. **`Section 1`–`Section 5` eyebrows in Settings** are meaningless once mobile shows one section at a time.
   Part of a wider eyebrow problem: 70 instances across 26 files.
8. **Type floor.** Ten distinct sizes below 11px remain outside the surfaces already fixed.
9. **A super-admin still scrolls the sidebar at 1366×768** (80px hidden) and **1024×768** (70px). Both are
   announced by the edge fade and every destination is reachable, which is the same contract the iPad fix
   settled on. Cutting it further means cutting rows, not spacing.
10. **26 distinct `max-width` breakpoints** across the two stylesheets with no scale. Partly tidied; a full
    pass would collapse them onto a documented set.
11. **Leftover infrastructure voice in copy.** The §5 pass removed "Django"; "server" survived in places
    ("Server award history", "server-indexed catalogue"). The strings that were translated in this pass were
    rewritten in product voice on the way through — the untranslated pages still carry it.

### Correction to the original audit

The report's "two-column tablet content" finding was **over-generalised**. Materials, Questions, Progress and
Achievements were already multi-column at 820px. The genuinely single-column pages are stacks of sections
with a reading order, where a second column is not obviously better — so it was deliberately not forced.

---

## 9. Suggested next session opener

> Continue the responsive UI work on `codex/phase-11-production-readiness`.
> Read `RESPONSIVE_UI_P0_P1_HANDOFF.md` first — §3 has the environment, §7 the tooling traps, §8 the backlog.
> P0, P1 and the P2 pass in §2b are done and green (115 passed / 4 skipped serial e2e, 177/177 unit).
> Start with §8 item 1 — translation coverage for the social, workspace and Creator/Admin pages; the pattern
> to follow is any student page, and `e2e/translation-coverage.spec.js` guards it. Do not regress §6.
