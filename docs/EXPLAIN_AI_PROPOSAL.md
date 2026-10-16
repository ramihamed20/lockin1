# Explain AI evaluation — disabled implementation proposal

Status: proposal only, 14 October 2026. No adapter, paid request, automatic score or AI feedback has been activated. Current Explain remains prepared reference content and explicitly labelled self-review.

## Contract and attribution

Keep the immutable ExplainAttempt and its frozen question/source/rubric. Add an evaluation record referencing the attempt, rubric revision, exact document version/file hash, approved source excerpt IDs, adapter/model version, prompt version, request fingerprint and timestamps. Do not retrospectively attribute existing answers to a newly edited question or PDF.

The result should contain criterion IDs, supported correct concepts, missing or contradicted concepts, concise feedback, at most two contextual follow-up prompts and source page citations. A criterion can be supported, missing, contradicted or uncertain. Uncertainty and provider failure are separate from an incorrect answer. Avoid a numerical mastery score in the first evaluation release.

A provider response is untrusted. Validate it against a strict schema and the finite set of approved rubric/concept/source IDs. Reject invented citations, unknown concepts, unsafe rendered content and overlong outputs. Safe UI rendering uses text, as the current prepared-feedback flow does.

## Grounding and equivalent explanations

An administrator approves the question, reference answer, essential criteria, accepted alternatives, common misconceptions and the smallest relevant PDF excerpts before publication. PDF extraction must respect file ownership, version and edition. Use teacher-reviewed text for scanned or extraction-poor pages. Do not send an entire PDF, notebook, map, unrelated answer history or account identifiers to a provider.

A successful explanation need not repeat the reference wording. Evaluate scientific meaning, causal relationships and contradictions against the rubric. Preserve negation and qualifiers. Curated alternatives can recognize equivalent descriptions and medical terminology. A correct fact outside the supplied source is not automatically an error; mark unresolved equivalence as uncertain for review.

Support Arabic, English and mixed responses. Preserve the submitted text verbatim. Normalization is for retrieval only and must not remove meaningful medical symbols or negation. Explain the result in the student's chosen language. Test transliteration, abbreviations, Arabic numerals and code-switching independently.

Treat the student answer and PDF text as data, never instructions. Do not execute tools or follow requests embedded in either. Follow-up prompts should target an unresolved criterion, stay within the approved sources and never imply a diagnosis or criterion failure that the evaluator did not establish.

## Provider boundary and execution

Use an adapter interface such as evaluate(snapshot, response_language, limits) returning a validated evaluation plus actual usage. The domain service owns permissions, limits and attribution; adapters own provider-specific wire formats and error translation. Credentials remain server-side. No provider names, tokens or raw prompts enter browser configuration or ordinary logs.

Require an explicit owner-approved provider, retention policy and spending cap, and both global/per-sheet evaluation flags. An API key alone must not enable evaluation. Ordinary summaries, manual maps and prepared Explain continue to work with AI off.

Reserve request/token/spend capacity in a short transaction. Make the evaluation fingerprint unique. Perform network calls outside DB locks, then persist the result using a bounded processing lease and revision check. A retry of an existing attempt returns its existing evaluation. Lost acknowledgements must not create another evaluation or another charge. For providers without idempotency guarantees, uncertain charge outcomes remain reserved and visible until reconciliation; do not repeatedly release and retry them.

The initial implementation can use a bounded synchronous request through the existing monolith. No queue broker or new infrastructure is justified yet. Use explicit connection/read deadlines, maximum input/output tokens and a bounded retry policy. Persist timeout/unavailable/rejected states and keep the answer intact. Offline answers remain pending and never receive fabricated correctness.

## Quotas and cost

Start with administrator-configurable per-account and per-sheet monthly limits, a global currency cap and per-minute throttling. Limit each evaluation to reviewed excerpts and a bounded output. Allow at most two follow-ups, counted as requests. Disallow implicit evaluation of every note edit or tool switch.

For planning, 20 evaluations/month with up to two follow-ups each means a worst-case 60 requests. At 1,800 input and 300 output tokens per request, this is 108,000 input and 18,000 output tokens. With approved per-million-token prices Pi and Po, the upper usage estimate is 0.108 Pi + 0.018 Po per student/month. This is a formula, not a current provider quote. Include reserved/actual usage, failed-but-billed requests and provider billing reconciliation in the cap.

Report operational counters and timings without raw answers. Restrict detailed educational evaluation data to the student and an explicitly approved review workflow. Document deletion, retention and provider handling before any pilot.

## Accuracy and rollout gates

Build a teacher-labelled dataset by sheet version and criterion, before choosing a model. Include fully correct paraphrases, partially correct answers, confident misconceptions, missing causal links, contradictory negation, irrelevant facts and prompt-injection attempts. Include separate Arabic, English and mixed cohorts; examples must not contain real student identities.

Measure criterion precision/recall, false acceptance of misconceptions, false rejection of valid paraphrases, citation validity, abstention and agreement with two human reviewers. Evaluate language groups separately. Split by concept/sheet, not only by answer text, to avoid leakage. Define the minimum accepted metrics with content owners; do not invent a scientifically certified threshold.

Add deterministic tests for schema validation, source revision mismatch, permission and CSRF denial, duplicate requests, quotas, accounting reservations, deletion, adapter timeouts and uncertain charge recovery. Use recorded/synthetic adapter fixtures for routine CI. Live paid evaluation tests require explicit approval and a separate spending cap.

Rollout order: offline accuracy study with approved examples, human-reviewed pilot, limited opt-in evaluation, then expansion only after accuracy and usage evidence. Keep Strong evidence and Review schedules unchanged until the new evaluation has an approved calibration policy. A student's self-rating and AI feedback must remain clearly distinguished from server-scored MCQ evidence.

## Current readiness

The existing source identity, frozen rubric, immutable attempts, ownership checks and pending submissions provide a useful base. Stable PostgreSQL verification and a clean final real-browser pass remain release prerequisites despite passing complete SQLite/frontend suites. Provider approval and the labelled accuracy dataset are also required. This proposal adds no paid dependency or product claim.
