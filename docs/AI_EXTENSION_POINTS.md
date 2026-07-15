# Lock-in AI Extension Points

Last updated: 2026-07-15

## Current policy

Phase 2 is AI-free. There is no model provider, prompt framework, vector database, embedding job,
AI SDK, AI-generated product decision, or hidden external data transfer.

Lock-in is AI-ready through ordinary clean architecture, not through speculative infrastructure.

## Extension boundary

A future `intelligence` domain may be approved as a consumer of explicit, permission-filtered read
services and domain events. It returns recommendations or derived explanations through typed
ports. Provider-specific adapters remain outside education, quiz, progress, content, and Focus
domain rules.

The intelligence domain must never directly write authoritative:

- quiz answers, grades, deadlines, or final results;
- lesson-completion or subscription state;
- moderation findings or role assignments;
- Focus session duration/history;
- achievement awards without the owning domain validating the criteria.

## Planned use-case inputs

| Future capability | Approved input boundary | Authoritative owner remains |
|---|---|---|
| Personalized study plan | Published content catalog, permitted progress summary, student preferences | Progress and Content |
| Weakness detection | Released quiz-result aggregates and completed-study evidence | Quizzes and Progress |
| Quiz recommendation | Eligible quiz catalog plus permission/subscription policy result | Quizzes |
| Lesson recommendation | Published lesson catalog plus progress/read service | Education and Content |
| AI explanation | Versioned question/content excerpt the user may view | Questions and Content |
| AI summary | A permitted versioned source document | Content/Files |
| Smart search | Permission-filtered index/read service | Content and Education |
| Learning analytics | De-identified or minimum-required event/read projections | Analytics |

## Required future controls

Before the first AI feature is implemented, its phase must document:

1. exact user benefit and non-AI fallback;
2. data fields sent to a provider and lawful/owner-approved basis;
3. consent, opt-out, retention, deletion, and provider-training policy;
4. permission filtering before retrieval or prompt construction;
5. prompt-injection and untrusted-document treatment;
6. latency, cost, quota, availability, and failure behavior;
7. explainability and clear AI labeling;
8. human review for high-impact output;
9. evaluation data, quality threshold, and regression monitoring;
10. provider abstraction and exit plan.

## Current extension points

- Stable UUID public/domain identifiers.
- Versioned content and question direction in the architecture.
- Focus session events and summary selector.
- Internal after-commit event bus.
- Same-origin versioned API and OpenAPI schema.
- Domain-owned services/selectors instead of cross-module model access.

No extra service is added merely because a future AI feature might use one.
