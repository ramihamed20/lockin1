---
name: workflow-forger
description: Detect recurring Lock-in engineering workflows, tests, commands, and review routines, then convert stable repetition into the smallest reusable script, repo rule, helper, or skill.
---

# Workflow Forger

Automate repetition only when it is real and stable.

## Observation thresholds

- 1st occurrence: observe only
- 2nd occurrence: candidate
- 3rd occurrence within 30 days: extract automatically if stable/safe
- 2 occurrences may be enough for a high-cost, highly stable workflow

Do not create from one occurrence unless the user explicitly asks.

## Choose the smallest abstraction

Use this order:

1. script / package command
2. test helper / fixture / task-runner target
3. short `AGENTS.md` invariant
4. Codex Skill for branching/judgment-heavy workflows

Do not create a Skill for a deterministic command sequence.

## Reject bad repetition

Do not automate:
- repeated failed guesses
- flaky-test churn
- temporary incident steps
- one-off migration rescue
- environment-specific accident
- unstable requirements

Fix the cause instead.

## Duplicate prevention

Before creating:
- inspect scripts
- package scripts
- CI
- test helpers
- `.agents/skills`
- relevant `AGENTS.md`

Improve existing automation when possible.

## Scope

Auto-create repo-local assets only.

Do not automatically modify global `$HOME/.agents/skills`.

## Security

Never capture secrets, credentials, private data, or raw sensitive logs in the ledger or generated automation.

Destructive automation must default to dry-run or require an explicit opt-in flag.

## Ledger

Store only normalized metadata in:
`.agents/workflow-forger/ledger.json`

Suggested fields:
- signature
- kind
- summary
- count
- first_seen
- last_seen
- deterministic
- stable
- high_cost
- status
- automation_path

## Output only when useful

AUTOMATION CREATED
TYPE: Script / Skill / AGENTS rule / Test helper
NAME: <name>
TRIGGER: <repetition>
PATH: <path>
REPETITIONS: <count>
VALIDATION: <evidence>
EXPECTED SAVING: <short note>

If nothing qualifies, stay quiet.
