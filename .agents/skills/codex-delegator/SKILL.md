---
name: codex-delegator
description: Select deterministic tools first, then delegate low-risk bounded review to a configured free OpenCode model with sensitive context blocked; use before routine work that does not need Luna or Sol.
---

# Codex Delegator

Use the cheapest safe path without asking the user to choose the dispatch method.

## Priority order

1. Deterministic command or script
2. Read-only free OpenCode worker for bounded, low-risk review
3. GPT-6 Luna
4. GPT-6 Sol

The helper returns suggestions only. Codex reviews and applies any accepted change. Do not use it to make repository edits.

## Current free-model role mapping

The helper queries the installed OpenCode model list and selects exact provider/model IDs. Current candidates include:
- routine: opencode/nemotron-3.5-lightning-free; opencode/mimo-v2.6-flash-free
- coding: openrouter/qwen/qwen3.8-27b:free; opencode/mimo-v2.6-flash-free
- review: openrouter/qwen/qwen3.8-27b:free; opencode/muse-spark-1.3-contributor-free
- visual: openrouter/inclusionai/ling-3.0-flash-vl:free; opencode/ling-3.0-flash-fin-free
- heavy: opencode/nemotron-3-ultra-free; openrouter/qwen/qwen3.8-27b:free

These are preferences, not guarantees of service availability. If an ID is absent, use the next listed ID. ModelOverride accepts an explicit OpenCode provider/model ID.

## Bounded, sanitized context

The helper sends only:
- the supplied task text, up to 8,000 characters
- explicitly supplied ContextFile entries, up to 128 KB each and 32,000 characters total

It never scans the repository or generates a whole-repository diff. Context paths must resolve inside the current project. It rejects environment files, key files, database dumps, private-data/log paths, binary files, and content matching common credential or personal-data patterns. If a check fails, nothing is sent.

Do not supply secrets, API keys, passwords, session/auth tokens, production credentials, database dumps, private customer/student information, or sensitive logs. Automated checks are conservative filters, not a guarantee that arbitrary text contains no personal data; review selected context before delegation.

Example:
- powershell -File .agents/skills/codex-delegator/scripts/delegate.ps1 -Role review -Task "Review this failure" -ContextFile backend/apps/example/tests/test_api.py -DryRun

## Technical boundary

The helper runs OpenCode from a unique temporary directory, with a temporary OpenCode v2 configuration that denies every tool action for the build agent and disables plugins/MCP. The model cannot browse or edit the repository, run shell commands, launch subagents, or access external directories. It receives only the bounded prompt and returns text.

Do not use --auto. The helper never invokes push, merge, deploy, production mutation, or destructive database commands. A free worker must not be the sole implementer and reviewer for a risky change.

## OpenCode v2.0.14

Use opencode models; this installed version does not support opencode models --refresh. Prefer -DryRun first. DryRun performs model selection and context checks but sends no prompt.

When OpenCode is unavailable or model discovery fails, use ModelOverride as a fallback or continue with the normal Luna/Sol route. Do not guess model IDs.

## Escalation

Use Luna when:
- a free worker cannot follow the bounded task reliably
- broader repository reasoning is required
- confidence is low or rework cost exceeds the savings

Use Sol when:
- deeper reasoning across interacting systems is needed
- security, data-integrity, concurrency, or production-critical risk justifies it

Do not delegate high-risk changes to an external worker.