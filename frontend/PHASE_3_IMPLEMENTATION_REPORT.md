# Phase 3 implementation report

## Outcome

Phase 3 is complete. The replacement frontend now exposes Django-backed quiz discovery, quiz details, attempt start/resume, revision-safe answer saving, server-deadline timing, submission, released results, question-issue reporting, and the server-provided assessment-review queue. The browser never decides correctness, scores, pass/fail, completion, XP, streaks, ranking, or entitlement.

No CSS, asset, font, design token, theme, breakpoint, shell, or UI library was changed. The work reuses the replacement frontend's existing page, panel, card, form, button, dialog, loading, empty, error, and responsive patterns.

## Files changed

| File | Reason |
| --- | --- |
| `src/api/assessments.js` | Exact, same-origin Django adapters for quiz, attempt, answer, activity, result, report, and review endpoints. |
| `src/components/assessment/QuizCard.jsx` | Public quiz metadata card using the existing question-card styling. |
| `src/components/assessment/AttemptQuestionCard.jsx` | Active-attempt option selector and server-save/conflict/error state; it deliberately has no correctness or explanation UI. |
| `src/components/assessment/AttemptTimer.jsx` | Countdown derived from Django `deadline_at` and `server_time`, never from a client-owned duration. |
| `src/pages/Questions.jsx` | Real P25 quiz listing and supported mode filter. |
| `src/pages/QuizDetail.jsx` | Real quiz detail and start/resume workflow, including practice-only request-size choices. |
| `src/pages/Attempt.jsx` | Real answer PUT, server-revision reconciliation, activity events, submit confirmation, timeout/closed handling, and protected active-attempt UI. |
| `src/pages/AssessmentResult.jsx` | Real result display with an unreleased safe state and result-level issue reporting after release only. |
| `src/pages/Review.jsx` | Real assessment-review queue; no fabricated “complete” action. |
| `src/App.jsx` | Lazy, protected quiz-detail, attempt, and result routes. |
| `src/lib/authz.js` | Authenticated allowlist entries for the Phase 3 detail routes. |
| `eslint.config.js`, `tsconfig.phase0.json`, `tests/phase3.test.js` | Inclusion and exact request/route/integrity checks. |
| `src/hooks/useQuestionData.js`, `src/components/shared/QuestionCard.jsx` | Removed disconnected runtime mock-question helpers with no remaining callers. |

## Django contracts verified

| Workflow | Existing endpoint and behavior |
| --- | --- |
| Quiz discovery | `GET /quizzes?node=&mode=&page=&page_size=` returns public published quiz/version data. |
| Quiz detail | `GET /quizzes/{quiz_id}` returns the public version, mode, availability, limits, and release policy. |
| Start/resume | `POST /quizzes/{quiz_id}/attempts` accepts `idempotency_key`, optional practice-only `question_count`/`difficulties`, and `review_only`; it returns `{ resumed, attempt }`. |
| Active attempt | `GET /attempts/{attempt_id}` returns question snapshots and saved selections, but no correct answers or explanations. |
| Save answer | `PUT /attempts/{attempt_id}/questions/{attempt_question_id}/answer` accepts `selected_option_ids` and `client_revision`; `409 answer_revision_conflict` exposes `fields.current_answer`. |
| Submit | `POST /attempts/{attempt_id}/submit` accepts an idempotency UUID and returns the server-owned result. |
| Integrity activity | `POST /attempts/{attempt_id}/activities` receives only documented event values, a UUID, optional occurrence time, and empty metadata. |
| Result/report | `GET /assessment-results/{result_id}` keeps scoring and question feedback null until released; `POST /assessment-results/{result_id}/reports` takes `attempt_question_id`, category, and details. |
| Review queue | `GET /assessment-review` returns due/scheduled server facts; it does not expose a route that maps a queue item to a startable review attempt. |

## Security and compatibility decisions

- Answer cards use only `option_snapshot` and saved `selected_option_ids`. Correct choices and explanations are rendered only from a released result response.
- The active attempt recalculates neither scores nor remaining server authority. The timer is informational and based on the server deadline; Django closes/grades the attempt.
- Start and submit use locally generated UUID idempotency keys only for the calls documented to accept them. The submit key remains stable for a retry during the current in-memory submission flow.
- Answer saves advance from the response's server revision. A `409` restores Django's `current_answer`; an `attempt_closed` response refetches the attempt.
- Visibility and workspace events use only the documented activity vocabulary. They do not grant progress or alter assessment state.
- The existing Phase 0 same-origin cookie/CSRF client and static-only service worker are retained. This phase adds no bearer/JWT flow and no API or authenticated-data caching.
- The old mock question helpers were removed rather than returning fabricated success data. Unsupported one-click review remains a clear, non-disruptive unavailable state.

## Visual impact

No stylesheet changed. New screens reuse the current `Page`, panel, question-card, choices, form controls, buttons, confirmation dialog, `LoadingPanel`, `ErrorPanel`, `EmptyState`, icons, shell, theme behavior, and mobile layout. No visual pattern was copied from the old frontend.

## Verification

| Check | Result |
| --- | --- |
| `pnpm run lint` | Pass, no warnings. |
| `pnpm run typecheck` | Pass. |
| `pnpm test` | Pass: 19 tests, 0 failures. Phase 3 tests cover exact paths/methods/bodies, CSRF, route guards, no answer leakage, response release gating, and static-only PWA behavior. |
| `node .\\node_modules\\vite\\bin\\vite.js build` | Pass: Vite 6.4.3 production build. |
| Signed-in live quiz flow | Pass: real quiz listing/detail, attempt creation, answer save, submission, immediate released result, and server review queue were exercised against Django. The result showed score and correctness only after submission/release. |
| Error runtime flow | Pass: an unknown attempt ID rendered Django's attempt-not-found error with retry rather than a permanent loading state. |
| Django read-only check | Pass: `PYTHONDONTWRITEBYTECODE=1`, `DJANGO_SETTINGS_MODULE=config.settings.demo`, `.venv\\Scripts\\python.exe manage.py check`. |
| Git boundary checks | Pass: `git diff --check` and `git diff --cached --check`. |

The supplied runtime is Node 24.14.0 while `package.json` declares Node 24.16.0. Every check passed with only the non-blocking engine warning. The canonical direct Vite command above is the recorded production-build result.

## Remaining limitations

- The assessment-review endpoint exposes queue facts only; Django provides no endpoint that maps a review item to a specific `review_only` quiz start. The UI therefore does not pretend it can launch one.
- Focus-required handling remains server-enforced. The frontend does not fabricate focus privileges or access.
- A report form was opened in the live UI but deliberately not submitted, so no false moderation record was created. Its exact request contract is covered by automated tests.

## Backend boundary confirmation

All Phase 3 writes are under `frontend/`. No Django source file was edited. Final backend-scoped Git checks show no unstaged backend paths. The only backend status paths are the pre-existing staged `backend/.lockin-demo.sqlite3` and `backend/config/settings/demo.py`; this phase did not touch either file.
