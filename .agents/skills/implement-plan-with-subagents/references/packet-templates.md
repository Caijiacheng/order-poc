# Packet Templates

Use these templates as scaffolds. Replace every placeholder with repo- and stage-specific facts before sending a packet.

`Truth Sources` should be the smallest verified set that materially constrains the work. Do not pad the list with generic repo files.

## Context Brief

```md
Context Brief

- Goal:
  - [what the current stage must deliver]
- Stage Sequence:
  - [ordered stage or packet list]
- Current Stage:
  - [the stage you are dispatching now]
- Truth Sources:
  - [verified PRD / design doc]
  - [verified target code module]
  - [verified test entry point]
- Fixed Decisions:
  - [already-set design decisions]
- Context Selection:
  - Required:
    - [must-have context for this packet]
  - Optional:
    - [useful but not required on first pass]
  - Withheld:
    - [known background intentionally omitted]
- Scope Boundaries:
  - In:
    - [in-scope work]
  - Out:
    - [out-of-scope work]
- Acceptance Gates:
  - [build / unit / e2e commands]
```

## Implementation Packet

```md
Implementation Packet

Stage Goal:
- [single-stage outcome]

Execution Settings:
- Model: gpt-5.3-codex
- Reasoning Effort: [low/medium/high]

Truth Sources:
- [verified doc or file]
- [verified doc or file]

Fixed Decisions:
- [non-negotiable design rule]
- [non-negotiable design rule]

Context Included:
- [required fact, file, or prior result]
- [required fact, file, or prior result]

Context Intentionally Withheld:
- [out-of-scope background not sent to the worker]

Why This Context Is Sufficient:
- [why the worker can complete this packet safely with only the above context]

Write Scope:
- [owned modules]

No-Touch Scope:
- [forbidden modules]
- [forbidden behavior]

Acceptance Checks:
- [state / UX / API assertion]
- [test command that must pass]

Run Commands:
- [command]
- [command]

Escalate If Missing:
- [how the worker should report a missing file, decision, or fact]

Output Format:
- Ack:
  1. 我理解的目标
  2. 我会改的范围
  3. 我不会改的范围
  4. 当前上下文是否足够，以及原因
  5. 当前阻塞或缺失上下文
- Final:
  1. 改了什么
  2. 关键设计取舍
  3. 自检结果
  4. 剩余风险
  5. 变更文件列表
```

## Test Packet

```md
Test Packet

Stage Goal:
- [what the tests must lock]

Execution Settings:
- Model: gpt-5.3-codex
- Reasoning Effort: [low/medium/high]

Truth Sources:
- [verified doc or file]
- [verified doc or file]

Assertions To Lock:
- [behavior that must stay true]
- [regression that must be prevented]

Context Included:
- [required fact, file, or implementation summary]
- [required fact, file, or implementation summary]

Context Intentionally Withheld:
- [out-of-scope background not sent to the worker]

Why This Context Is Sufficient:
- [why the worker can validate this packet safely with only the above context]

Write Scope:
- [tests and fixtures only]

No-Touch Scope:
- [product code]
- [docs]

Run Commands:
- [targeted test commands]

Execution Rules:
- run commands serially
- never run e2e in parallel
- do not overlap with any other active execution worker

Escalate If Missing:
- [how the worker should report a missing file, decision, or fact]

Output Format:
- Ack:
  1. 我理解的目标
  2. 我会改的范围
  3. 我不会改的范围
  4. 当前上下文是否足够，以及原因
  5. 当前阻塞或缺失上下文
- Final:
  1. 改了什么测试
  2. 覆盖了哪些规则
  3. 运行结果
  4. 仍依赖实现的点
  5. 变更文件列表
```

## Feedback Packet

```md
Feedback Packet

Target Worker:
- [implementation worker or test worker]

Review Findings:
- [P0/P1/P2] [file:line] [impact]

Test Results:
- [failed test or passing summary]
- [root cause or assertion that matters]

Required Fixes:
- [must fix now]
- [must fix now]

Deferred Items:
- [safe to defer]
```

## Final Master Summary

```md
Final Master Summary

Completed Stages:
- [accepted stage]
- [accepted stage]

What Changed:
- [high-signal implementation summary]

What Was Tested:
- [commands run]
- [important coverage or gates]

Remaining Risks:
- [explicit residual risk]

Deferred Follow-ups:
- [explicitly deferred item]
```

## Stage Acceptance Checklist

Use this order every time:

1. master finalizes the current stage packet
2. implementation worker acks, executes, and self-checks
3. master reviews and sends a `Feedback Packet` until implementation converges
4. test worker acks, updates tests if needed, and runs approved commands serially
5. master reviews test results and routes follow-up feedback to the correct worker
6. repeat steps 3-5 until all required fixes are closed
7. master reruns acceptance commands and decides pass/fail
8. after all stages are accepted, master writes the final summary
