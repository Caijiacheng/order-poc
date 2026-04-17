# AGENTS.md

## Purpose

This repository is for a POC named `AI 建议单 + 智能凑单 Demo`.

The POC serves two goals:

- Demo an AI-assisted dealer ordering flow for 美味鲜 / 厨邦 products
- Provide an admin console to configure mock data, expression templates, global rules, and reports

This is not a production system. The implementation should optimize for:

- fast iteration
- stable demos
- controllable outputs
- clear observability

The main product specification lives in [docs/product-design.md](/Users/caijiacheng/AIProject/order-poc/docs/product-design.md).

## Current State

The repository is no longer in an empty scaffold state.

The current baseline already includes:

1. Next.js App Router + TypeScript + Tailwind project setup
2. Frontstage canonical routes and admin canonical IA shell routes
3. in-memory store, seed loading, and initial CRUD/report APIs
4. Vercel AI SDK service integration seam
5. Langfuse + OpenTelemetry instrumentation baseline
6. test scaffolding for routes/domain flows

Current work should focus on PRD-driven refactoring and contract alignment, not re-scaffolding.

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

- `/` -> `/purchase`
- `/purchase`
- `/order-submit`

### Demo UI Contract (`/purchase`)

- Keep exactly 4 core blocks:
  - three bundle template cards (`热销补货` / `缺货补货` / `活动备货`)
  - activity zone
  - product catalog zone
  - right procurement summary
- Remove all legacy frontstage modules and legacy per-item primary actions
- `快速下单` must mean:
  - add selected template/activity items to cart
  - then navigate to `/order-submit`
  - never silently submit order
- `/api/frontstage/published-suggestions` frontstage contract must be:
  - `bundleTemplates[]`
  - `activityHighlights[]`
  - `cartSummary`
  - no `dailyRecommendations` / `weeklyFocusRecommendations` payload for frontstage consumption

### Admin Routes

- `/admin` -> `/admin/workbench/overview`
- `/admin/workbench/overview`
- `/admin/master-data/products`
- `/admin/master-data/dealers`
- `/admin/master-data/segments`
- `/admin/master-data/product-pools`
- `/admin/strategy/campaigns`
- `/admin/strategy/recommendation-strategies`
- `/admin/strategy/expression-templates`
- `/admin/strategy/global-rules`
- `/admin/operations/generation-jobs`
- `/admin/operations/recommendation-batches`
- `/admin/analytics/overview`
- `/admin/analytics/recommendation-records`
- `/admin/observability/traces`
- `/admin/observability/audit-logs`
- `/admin/observability/recovery`

## Core Domain Rules

These rules are mandatory unless the product design doc is updated:

- Data is mock only
- State is in memory only
- Restarting the app resets runtime CRUD changes back to seed defaults
- AI is used for explanation, ranking, and structured recommendation generation
- Deterministic calculations stay outside the model
- Recommendation strategies and expression templates are references for prompt construction, not hardcoded final outputs
- Every recommendation run should be traceable and reportable

## Data Model Expectations

Seed data should exist for:

- products
- dealers
- recommendation strategies
- expression templates
- campaigns
- global rules
- expression config
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
- Recommendation strategy CRUD
- Campaign CRUD
- Global rule editing
- Expression template editing
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
- prioritize clarity of bundle templates, activity zone, and optimization panels
- keep report views readable and queryable
- prefer practical, information-dense layouts over decorative complexity

## Implementation Order

Agents should work in this order unless the user requests otherwise:

1. align canonical IA and route contracts with the PRD
2. refactor runtime in-memory model and shared domain rules
3. implement frontstage purchase/order-submit behavior on canonical routes
4. implement operations/admin workflows (config, generation, publish, review)
5. complete observability, audit, and recovery flow integration
6. update tests and run verification (lint, typecheck, unit/e2e smoke)

## Verification Expectations

Before claiming work complete, verify as applicable:

- app boots successfully
- demo routes render
- admin CRUD updates runtime memory
- recommendation records are created
- report endpoints return expected shapes
- Langfuse instrumentation does not break requests

If something cannot be verified locally, state that explicitly.

## Local Run And Verify Commands

Install and run:

- `pnpm install`
- `pnpm dev` (default: [http://localhost:3000](http://localhost:3000))

Primary checks for this scaffold stage:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Manual route smoke check targets:

- `/`, `/purchase`, `/order-submit`
- `/admin/workbench/overview`
- `/admin/master-data/products`
- `/admin/master-data/dealers`
- `/admin/master-data/segments`
- `/admin/master-data/product-pools`
- `/admin/strategy/campaigns`
- `/admin/strategy/recommendation-strategies`
- `/admin/strategy/expression-templates`
- `/admin/strategy/global-rules`
- `/admin/operations/generation-jobs`
- `/admin/operations/recommendation-batches`
- `/admin/analytics/overview`
- `/admin/analytics/recommendation-records`
- `/admin/observability/traces`
- `/admin/observability/audit-logs`
- `/admin/observability/recovery`

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
