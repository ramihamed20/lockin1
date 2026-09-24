---
name: lockin-large-file-surgeon
description: Safely modify or incrementally refactor very large Lock-in source files without broad rewrites or regression-heavy cleanup. Use when touching large JSX/CSS/Python modules or extracting behavior from monolithic files.
---

# Lock-in Large-File Surgeon

Large files require smaller patches, not bigger rewrites.

## Goal

Change the requested behavior while reducing regression risk and context cost.

## Before editing

1. Identify exact symbol/state/style region.
2. Find tests that characterize current behavior.
3. Map imports/exports and side effects.
4. Read only surrounding sections first.
5. Expand context only if dependencies demand it.

## Characterization first

If behavior is poorly tested and the edit is risky:
- add or strengthen a characterization test before refactoring
- confirm it fails only when the intended behavior changes

## Extraction rules

Extract only when it improves one of:
- state ownership clarity
- testability
- repeated logic
- isolated rendering/utility concern
- context size for future maintenance

Do not extract merely to make files shorter.

## One axis per patch

Prefer:
- bug fix
OR
- structural extraction

Avoid mixing:
- formatting
- rename sweep
- CSS cleanup
- state rewrite
- behavior change

unless tightly necessary.

## Large CSS

For big stylesheets:
- locate selector ownership
- check specificity/order/cascade
- search duplicates
- preserve responsive/RTL layers
- avoid moving blocks across cascade boundaries casually

## Large React files

Watch:
- implicit state machines
- effect ordering
- refs/event listeners
- persisted state
- callbacks captured by closures
- conditional render branches

## Large Django/Python files

Watch:
- transaction boundaries
- permission checks
- service/selectors separation
- import cycles
- hidden cross-domain behavior

## Completion

SURGERY RESULT
TARGET REGION: <symbol/section>
BEHAVIOR CHANGE: <yes/no>
STRUCTURAL CHANGE: <what>
DIFF SIZE: <small/medium/large + why>
CHARACTERIZATION: <tests>
REGRESSION CHECKS: <tests>
