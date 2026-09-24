---
name: lockin-ci-triage
description: Diagnose Lock-in GitHub Actions failures by isolating the failing job/step, classifying code vs infrastructure vs flaky/provider failures, and proposing the smallest evidence-based fix. Use when CI fails or a production-quality gate is red.
---

# Lock-in CI Triage

Do not read every CI log first.

## Triage order

1. Identify failing job.
2. Identify first meaningful failing step.
3. Read only that step/log plus necessary context.
4. Classify the failure:
   - code regression
   - test expectation
   - dependency/tooling
   - network/provider outage
   - flaky/browser timing
   - PostgreSQL behavior
   - Docker/runtime contract
   - deployment/config contract
5. Reproduce locally only when the environment supports the same evidence.

## Lock-in CI families

Expect gates around:
- backend audit/lint/format/type/migration checks
- PostgreSQL tests
- production release/preflight
- frontend dependency audit/lint/type/unit/build/bundle
- Playwright browser regression
- Docker image builds
- Nginx/Compose validation
- container runtime smoke
- edge runtime smoke
- image layer stability

## Rules

- The first red job is not always the root cause; inspect dependency ordering.
- Do not rewrite tests just to make CI green.
- Distinguish external advisory/network failure from a real dependency finding.
- Do not disable fail-closed production checks to pass CI.
- Do not weaken Playwright coverage because a test is slow; identify flake vs product bug.
- For Docker/runtime failures, reproduce with the exact image/runtime contract when possible.

## GitHub connector use

If available:
- fetch workflow run jobs
- fetch failing job steps
- fetch failing job logs
- inspect commit diff
- avoid downloading unrelated logs

## Output

CI TRIAGE
JOB: <job>
STEP: <step>
CLASS: Code / Test / Infra / Flake / Dependency / Config
ROOT CAUSE: <evidence>
LOCAL REPRO: <command or unavailable>
FIX SCOPE: <small set>
RE-RUN: <targeted job/tests>
ESCALATE: <condition if unresolved>
