---
name: cost-aware-codex
description: Route Codex engineering tasks between GPT-6 Luna and GPT-6 Sol with the lowest sufficient reasoning effort. Use before substantial coding/debugging work when token/cost efficiency matters.
---

# Cost-Aware Codex Router

Optimize for useful engineering quality per dollar, not maximum theoretical quality.

Available paid models:
- GPT-6 Luna
- GPT-6 Sol

Default mode: `Economy`
Optional mode: `Critical`

## Routing dimensions

Judge:
- reasoning complexity
- search scope
- failure risk
- rework cost

Do not route by task size alone.

## Economy routing

### Luna Low
Use for:
- text/label changes
- obvious CSS tweaks
- repetitive edits
- grep/search
- running known checks
- tiny local fixes

### Luna Medium
Default for normal development:
- small/medium feature
- a few related files
- normal React/Django work
- straightforward debugging
- tests around existing behavior

### Decision Gate
If Luna Medium seems insufficient, decide why.

If the task mostly needs more repository context:
→ Luna High can be appropriate.

If the task needs deeper reasoning across interacting systems:
→ Sol Medium is often better than burning Luna High blindly.

### Sol Medium
Use for:
- cross frontend/backend state
- unclear multi-system regression
- auth/session coupling
- subscription/entitlement/payment lifecycle
- complex persistence/race behavior
- architectural change

### Sol High
Use only when:
- production-critical correctness
- data loss/corruption risk
- security-sensitive change
- difficult migration/concurrency issue
- prior lower-cost attempt failed for reasoning limits

## Critical mode

When user marks a task `critical`, weight failure risk and rework cost more heavily.

Do not automatically choose Sol High.
Still use the lowest model/effort that is defensible.

## Preflight before routing

Allow a tiny preflight:
- read relevant `AGENTS.md`
- inspect `git status`
- inspect likely files/test names
- use `lockin-impact-mapper` if installed

Do not spend a large amount of context merely deciding which model to use.

## Cost guard

Escalation signals:
- same files reread repeatedly
- multiple speculative patches
- root cause still unclear after two evidence-based hypotheses
- unexpected cross-system state
- repeated test failures reveal broader architecture

De-escalation signal:
If Sol discovers the hard part and remaining work is mechanical, recommend returning to Luna for execution.

## Internal dispatch with free delegation

Do not ask the user whether routine work should be delegated. Decide internally in this order:

1. If a deterministic command/script can prove or perform the task, use it without AI.
2. If it is a low-risk, bounded task with sanitized context, use codex-delegator.
3. Otherwise, route to Luna or Sol using the complexity and risk guidance above.

Do not send secrets, credentials, private data, or unreviewed repository context to an external worker. The delegator helper is read-only and returns suggestions for Codex to review.

Pause for the user only when changing the active main model is necessary or an action requires user approval. Do not pause merely to ask about delegation.

## Routing Card

Before substantial work on any non-trivial engineering task, show a concise card with exactly these fields:

MODEL: GPT-6 Luna or GPT-6 Sol
EFFORT: Low / Medium / High
WHY: one short sentence
ESCALATE IF: one concrete condition

Skip an expanded card for trivial or deterministic work. If the current model and effort are suitable, proceed without asking the user. If the task requires a different model or effort than the active one, stop before expensive work and tell the user exactly which model and effort to select. Do not ask for a switch when the current setup is sufficient.