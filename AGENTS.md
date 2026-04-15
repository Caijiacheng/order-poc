# AGENTS.md

## Purpose

This repository is for a POC named `AI 建议单 + 智能凑单 Demo`.

The POC serves two goals:

- Demo an AI-assisted dealer ordering flow for 美味鲜 / 厨邦 products
- Provide an admin console to configure mock data, prompt references, rules, and reports

This is not a production system. The implementation should optimize for:

- fast iteration
- stable demos
- controllable outputs
- clear observability

The main product specification lives in [docs/product-design.md](/Users/caijiacheng/AIProject/order-poc/docs/product-design.md).

## Current State

The repository currently starts from an empty scaffold state.

Before adding business logic, agents should establish:

1. Next.js App Router project skeleton
2. TypeScript and Tailwind setup
3. Vercel AI SDK integration
4. Langfuse + OpenTelemetry integration
5. in-memory store and seed data loading
6. frontstage routes and admin routes

## Required Stack

- `Next.js` App Router
- `TypeScript`
- `Tailwind CSS`
- `Vercel AI SDK`
- `Langfuse`
- in-memory data store only

Avoid adding:

- databases
- auth providers
- queues
- external orchestration frameworks
- complex agent frameworks

## Product Surfaces

The implementation must cover three surfaces:

1. Demo UI
2. Admin console
3. Reports and observability

### Demo UI Routes

- `/`
- `/order`
- `/cart`
- `/confirm`

### Admin Routes

- `/admin/dashboard`
- `/admin/products`
- `/admin/dealers`
- `/admin/suggestion-templates`
- `/admin/campaigns`
- `/admin/rules`
- `/admin/prompts`
- `/admin/reports`
- `/admin/reports/recommendations`

## Core Domain Rules

These rules are mandatory unless the product design doc is updated:

- Data is mock only
- State is in memory only
- Restarting the app resets runtime CRUD changes back to seed defaults
- AI is used for explanation, ranking, and structured recommendation generation
- Deterministic calculations stay outside the model
- Recommendation templates are references for prompt construction, not hardcoded final outputs
- Every recommendation run should be traceable and reportable

## Data Model Expectations

Seed data should exist for:

- products
- dealers
- suggestion templates
- campaigns
- rules
- prompt config
- UI config

Runtime memory should also store:

- metrics
- recommendation run records
- recommendation item records
- audit logs

## AI Implementation Rules

- Use Vercel AI SDK, not direct provider SDK calls in app code
- Structured outputs must be schema-validated
- Model calls must go through a shared service layer
- Prompt assembly must be centralized
- Recommendation generation and cart optimization should use narrowed candidate sets from rule logic
- Do not let the model calculate thresholds, totals, or box-multiple logic

Recommended shared functions:

- `generateRecommendation()`
- `generateCartOptimization()`
- `generateExplanation()`

## Observability Rules

Langfuse must cover more than raw LLM calls.

Every major business action should create a trace with child spans for:

- loading config/data
- rule filtering
- prompt composition
- model invocation
- output validation
- metrics recording
- recommendation application

Every recommendation run should persist enough metadata to query later:

- run id
- trace id
- customer id
- scene
- prompt snapshot or prompt version
- candidate sku ids
- returned sku ids
- model latency
- apply status

## Admin Console Rules

Admin pages are part of the deliverable, not optional tooling.

At minimum they must support:

- Product CRUD
- Dealer CRUD
- Suggestion template CRUD
- Campaign CRUD
- Rule editing
- Prompt editing
- Report querying

For destructive actions, prefer soft-disable or clear confirmation UI over silent hard delete.

## Reporting Rules

Two reporting layers are required:

1. aggregate KPIs
2. recommendation-level records

The recommendation record report must support filtering by:

- time range
- dealer
- scene
- status
- SKU
- adoption

## UI Guidance

This POC should look intentionally designed, not like a default admin starter.

When building UI:

- keep the demo UI and admin UI visually distinct
- prioritize clarity of recommendation cards and optimization panels
- keep report views readable and queryable
- prefer practical, information-dense layouts over decorative complexity

## Implementation Order

Agents should work in this order unless the user requests otherwise:

1. scaffold app shell and dependencies
2. create memory store and seed data files
3. implement admin CRUD routes and pages
4. implement shared domain rule layer
5. implement AI service layer
6. implement frontstage pages
7. implement reports
8. wire Langfuse tracing and recommendation records
9. verify happy-path demo flow

## Verification Expectations

Before claiming work complete, verify as applicable:

- app boots successfully
- demo routes render
- admin CRUD updates runtime memory
- recommendation records are created
- report endpoints return expected shapes
- Langfuse instrumentation does not break requests

If something cannot be verified locally, state that explicitly.

## Change Management

When making significant implementation decisions, keep them aligned with the product design doc.

If code reveals a mismatch with the spec, do one of the following:

- update the spec first, then implement
- or stop and clearly flag the mismatch

Do not silently drift away from the spec.

## Non-Goals

Do not spend time on:

- production-grade security
- production deployment hardening
- persistence and migrations
- multi-user collaboration
- perfect recommendation accuracy

This repository is for a controllable, explainable, demo-first POC.
