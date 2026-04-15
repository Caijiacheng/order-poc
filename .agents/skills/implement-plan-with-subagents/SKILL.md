---
name: implement-plan-with-subagents
description: "Coordinate approved implementation plans through a master-controlled, sub-agent execution workflow. Use when the user wants the main agent to act as project manager: define stages, dispatch sequential execution packets to sub-agents, review each deliverable, send improvement feedback, assign testing to a separate sub-agent, keep test execution serial especially for e2e, and produce the final summary only after all stages converge. Best for multi-file feature work, refactors, migrations, or staged deliveries; do not use for small one-shot fixes or open-ended exploration."
---

# Implement Plan With Subagents

Treat the main agent as `master-agent`: project manager, controller, reviewer, and final acceptor. Treat sub-agents as executors. The master owns planning, packet quality, sequencing, review loops, acceptance, and the final summary. Sub-agents own scoped implementation or scoped testing only. The master should not become the primary coder unless the user explicitly abandons this skill or the task turns out too small to justify delegation.

## Operating Model

- `master-agent` responsibilities:
  - define the ordered stage plan
  - verify truth sources and acceptance gates
  - curate the minimum sufficient context for each sub-agent
  - dispatch one execution sub-agent at a time
  - review every sub-agent deliverable
  - send concrete improvement feedback until convergence
  - assign testing to a separate test sub-agent
  - rerun acceptance commands and decide pass/fail
  - write the final summary after all stages close
- implementation sub-agent responsibilities:
  - execute only the assigned product-code scope
  - self-check before handing work back
  - do not redefine behavior, scope, or acceptance
  - work only from the packet and explicitly provided context
  - do not spawn additional agents
- test sub-agent responsibilities:
  - execute only the assigned test scope and approved test commands
  - keep all test execution serial
  - never run e2e in parallel with any other test run or active execution worker
  - work only from the packet and explicitly provided context
  - report results and gaps back to the master

## Model Policy

- Keep the `master-agent` on the current main thread model unless the user explicitly asks otherwise.
- Use `gpt-5.3-codex` for all execution sub-agents by default.
- Apply the same default to:
  - implementation sub-agents
  - test sub-agents
  - review-fix convergence passes sent back to the same worker
- Do not switch sub-agents to `gpt-5.4` or `gpt-5.4-mini` by default.
- Override the sub-agent model only when:
  - the user explicitly requests a different model
  - a task has a hard requirement that `gpt-5.3-codex` cannot meet
- If the master overrides the default model, state the reason explicitly in the current stage brief or packet notes.

## Workflow

### 1. Confirm the skill applies

Use this skill only after the task has a concrete implementation target.

- Require at least one of these signals:
  - the user explicitly asks for sub-agent delegation
  - the user provides an approved plan or PRD and wants it implemented
  - the task is large enough that staged execution, review, and test ownership should be separated
- Do not trigger this skill for:
  - brainstorming
  - architecture exploration without settled decisions
  - small fixes where delegation adds more overhead than value

If scope, truth sources, or acceptance are still fuzzy, finish that planning work first and only then start delegation.

### 2. Build the context brief

Convert background into fixed execution constraints before any sub-agent starts work.

- Collect the smallest set of truth sources:
  - user plan
  - repo PRD or design docs
  - target modules
  - affected tests
  - acceptance commands
- Verify every cited truth source exists locally before naming it in a packet.
- Keep `Truth Sources` minimal and relevant. List only files that directly constrain implementation, test design, or acceptance.
- Do not add generic repo files such as `package.json`, broad test READMEs, or unrelated tests unless the packet truly depends on them.
- If a likely design doc or test file does not exist, say that explicitly and cite the nearest real source instead.
- Turn ambiguous intent into fixed decisions:
  - what must change
  - what must not change
  - which stages are in scope
  - which tests are gatekeepers
  - what order each stage must run in
- Prefer repo-local protocol docs when they exist. In this repository, read [docs/prd/agent-stage-packet-protocol.md](/Users/caijiacheng/AIProject/orchestraX2/docs/prd/agent-stage-packet-protocol.md) before drafting packets.

### 3. Select the context for each sub-agent

Do not pass full background by default. The master must decide what each worker actually needs for the current packet.

- Default to the smallest sufficient context set.
- Filter context through these lenses:
  - `stage filter`: include only the current stage, not later stages
  - `role filter`: implementation workers get implementation facts; test workers get behavior rules, change summary, and test gates
  - `file filter`: include only files the worker must read, edit, or reason about
  - `decision filter`: include settled decisions only; unresolved design stays with the master
  - `gate filter`: include only the acceptance checks relevant to this packet
- Split packet context into three buckets:
  - required context: the worker cannot proceed safely without it
  - optional context: useful but not mandatory on the first pass
  - withheld context: known background intentionally omitted because it is out of scope
- Default to `fork_context=false`.
- Use `fork_context=true` only when the live thread context is itself required truth and cannot be compressed safely into the packet.
- Never use `fork_context=true` just because it is convenient.
- Require the worker `Ack` to say whether the provided context is sufficient. If not, the worker must name the missing fact or file precisely; the master then decides whether to patch the packet.

### 4. Define stage order and ownership

Set the execution order before sending any packet.

- Build an explicit ordered stage list. Each stage should have:
  - one outcome
  - one active executor
  - one acceptance gate
- Default ownership:
  - implementation worker: product code and narrowly related helpers
  - test worker: `tests/**` plus test fixtures/helpers only
  - master: planning, review, feedback, acceptance, and final summary
- Resolve shared-file ownership before delegation. If both execution and test work touch the same file, pick a single owner and constrain the other packet.
- Keep each stage bounded. Do not mix implementation, test strategy, and unrelated cleanup in one worker packet.
- Run only one execution sub-agent at a time. Do not overlap implementation workers.
- Start the test worker only after the relevant implementation work has converged enough to validate.

### 5. Draft stage packets

Send only the next packet you are ready to execute; do not prelaunch later workers.

- Implementation packet must include:
  - `Stage Goal`
  - `Execution Settings`
  - `Truth Sources`
  - `Fixed Decisions`
  - `Context Included`
  - `Context Intentionally Withheld`
  - `Why This Context Is Sufficient`
  - `Write Scope`
  - `No-Touch Scope`
  - `Acceptance Checks`
  - `Run Commands`
  - `Escalate If Missing`
  - `Output Format`
- Test packet must include:
  - `Stage Goal`
  - `Execution Settings`
  - `Truth Sources`
  - `Assertions To Lock`
  - `Context Included`
  - `Context Intentionally Withheld`
  - `Why This Context Is Sufficient`
  - `Write Scope`
  - `No-Touch Scope`
  - `Run Commands`
  - `Execution Rules`
  - `Escalate If Missing`
  - `Output Format`
- Require an `Ack` before coding or testing starts. If the worker reports a real context gap, stop and patch the packet; do not let the worker invent design.

Open [references/packet-templates.md](references/packet-templates.md) when drafting packets.

### 6. Run the implementation loop

Drive implementation through a master-led review cycle.

- Start one implementation worker once the packet is stable.
- Wait for the worker `Ack`. Fix packet gaps if they are real.
- Let the worker execute and self-check.
- Review the result yourself with a code-review mindset:
  - correctness
  - truth ownership
  - boundary violations
  - behavioral regressions
  - missing or weakened tests
- Merge your findings into a `Feedback Packet`.
- Send that packet back to the same implementation worker for convergence.
- Repeat until there are no must-fix implementation issues left for the current stage.
- Do not move to tests or the next stage while implementation gaps remain open.

### 7. Run the test loop

Testing is also delegated, but it is still controlled by the master and always runs serially.

- After implementation converges, start one dedicated test worker.
- The test worker may add or update tests and run only the approved commands in its packet.
- Test execution must be serial. Never run:
  - e2e in parallel with any other e2e run
  - e2e in parallel with implementation work
  - multiple test workers at the same time
- Review the test artifacts and results yourself.
- If tests expose product bugs or missing implementation behavior:
  - send a `Feedback Packet` to the implementation worker
  - wait for implementation convergence
  - rerun the test worker afterward
- If tests expose only test-scope issues:
  - send feedback to the test worker
  - keep the loop serial until the test packet converges

### 8. Accept the stage

Accept only against the packet, not against vibes.

- Require:
  - behavior matches `Fixed Decisions`
  - the master review is clean or all required fixes are closed
  - implementation and test feedback loops are closed
  - stated acceptance commands pass
  - stage-bounded e2e gates pass when required
  - residual risks are called out
- After acceptance:
  - summarize what changed
  - note what was intentionally left out of scope
  - only then move to the next stage

### 9. Write the final master summary

After every sub-agent has finished in sequence and all required follow-up loops have converged, the master writes the final summary.

- Summarize:
  - what changed
  - what was tested
  - which risks remain
  - what was deferred on purpose
- The master owns the final go or no-go decision.

## Hard Rules

- Do not let sub-agents redefine product behavior that should have been fixed in the packet.
- Do not let sub-agents approve their own work; final acceptance belongs to the master.
- Do not use `gpt-5.4` or `gpt-5.4-mini` for sub-agents unless the user explicitly asks or the master documents a hard exception.
- Do not run multiple execution sub-agents in parallel.
- Do not run the test sub-agent in parallel with the implementation sub-agent.
- Do not run e2e in parallel with any other test run.
- Do not dump full thread history or broad repo context into a worker packet by default.
- Do not use `fork_context=true` unless the master can justify why packetized context is insufficient.
- Do not allow implementation and test workers to edit the same files unless the packet names a single owner.
- Do not bypass the workflow by writing business code as the master agent.
- Do not cite guessed docs, guessed test files, or guessed modules in `Truth Sources`; only list paths you have verified.
- Do not pad `Truth Sources` with generic or weakly related files just to make the packet look complete.
- Do not accept “looks good” without rerunning the stated acceptance commands.
- Do not widen e2e scope after the user explicitly bounds it to one stage.
- Do not continue coding through a real design contradiction. Update the packet or the source design first.

## Review Checklist

Use this list during master review:

- Is the master still acting as controller and reviewer rather than primary implementer?
- Did the master give only the minimum sufficient context for this worker?
- Did the worker change anything outside the declared scope?
- Did the implementation silently weaken existing gates or validations?
- Do the tests lock the new rules instead of snapshotting noise?
- Did any test or e2e command run in parallel when it should have been serial?
- Is any stage boundary leaking into later workflow stages?
- Does the final behavior still match the packet rather than the worker's interpretation?

## References

- Open [references/packet-templates.md](references/packet-templates.md) when writing `Context Brief`, `Implementation Packet`, `Test Packet`, `Ack`, `Feedback Packet`, or the final master summary.
- If the repository already includes a stage-specific protocol document, treat that local document as the first truth source and use the reference templates only as a formatting scaffold.
