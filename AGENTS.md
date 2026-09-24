# Lock-in Codex Guidance

Keep this file short. Detailed workflows live in .agents/skills.

## Start

- For every non-trivial engineering task, show a concise Routing Card before substantial work: `MODEL / EFFORT / WHY / ESCALATE IF`. Trivial or deterministic tasks do not need an expanded card.
- If the current model and effort fit, continue without asking. If a different model or effort is needed, stop before expensive work and state exactly what the user should switch to.
- Deterministic work: use a command or script without AI.
- Low-risk, bounded external review: use codex-delegator with only selected, sanitized context.
- Otherwise: use cost-aware-codex to route Luna/Sol. Ask only when changing the main model is necessary or an action needs approval.
- Use lockin-impact-mapper when the blast radius is unclear.

## Route by surface

- general frontend → lockin-frontend-guardian
- backend/Django/PostgreSQL → lockin-backend-guardian
- frontend/backend API contract → lockin-api-contract-guardian
- Focus/PDF/Active Study reader → lockin-focus-pdf-guardian
- auth/session/OAuth/roles → lockin-auth-security-guardian
- payments/subscriptions/entitlements → lockin-subscription-payment-guardian
- responsive/iPad/RTL/a11y → lockin-responsive-a11y
- very large source file → lockin-large-file-surgeon
- CI failure → lockin-ci-triage

## Finish

- lockin-test-selector → choose the smallest sufficient validation
- review git diff
- do not claim completion without relevant passing evidence
- workflow-forger may record stable repetition after the task

## Precedence

- Root and area AGENTS.md plus Lock-in PRODUCT.md/DESIGN.md govern this repository and take precedence over general design Skills.
- Do not run global and project-local design Skills with overlapping scope for the same task unless each has a distinct purpose.

## Debugging discipline

- establish expected vs actual behavior
- collect evidence before patching
- prefer root cause over symptom masking
- after two failed evidence-based hypotheses, reassess scope/model rather than guessing repeatedly

## Architecture guardrails

- Preserve the modular monolith and explicit domain ownership.
- Do not introduce Redis, Celery, WebSockets, microservices, or equivalent infrastructure without demonstrated need and owner approval.
- PostgreSQL is production truth; SQLite is only an explicit fast-test exception where the repo allows it.
- Production hosts pull prebuilt images; do not build production artifacts on the VPS unless the deployment contract explicitly changes.
- Never commit secrets or production credentials.
- Do not deploy, push, merge, or mutate production unless explicitly requested.
- Prefer the smallest safe patch; avoid unrelated cleanup.