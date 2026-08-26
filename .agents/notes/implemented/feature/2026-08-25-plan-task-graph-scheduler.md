# Agent Note: Plan task graph scheduling

Status: implemented

English | [中文](2026-08-25-plan-task-graph-scheduler.zh.md)

## Problem

Plan mode previously recorded only the collaboration-mode switch. Callers that needed to carry out several independent planning steps had no shared dependency scheduler, durable task status, or consistent failure and cancellation result.

## Decision

`PlanModeController.execute()` accepts a branded plan id, an ordered task graph, and a host executor. The pure scheduler validates the graph before any task starts, admits only completed-dependency tasks, and commits conflict-free batches in input order. Tasks default to `exclusive`; `parallel` tasks with intersecting resource keys never share a batch. `maxParallelTasks` is deployment configuration and defaults to `10`.

Each admitted task receives the shared cancellation signal and a read-only map of completed dependency outputs. Executor failures become task `failed` states; dependents become `blocked`; unrelated tasks continue. Cancellation stops new starts and drains admitted executors. Task outputs remain process-local because arbitrary executor values are not a durable JSON contract.

The session log records the initial graph, every status transition, and one terminal outcome through `plan/tasks`, `plan/task-status`, and `plan/end`. `foldPlanExecution()` reconstructs the ordered durable state. These events are log-only and do not enter model history.

## Verification

Deterministic scheduler tests cover dependencies, bounded batches, failure isolation, blocked propagation, cancellation, duplicate prevention, result ordering, graph validation, and resource conflicts. Plan-mode integration tests cover durable transitions and replay folding. Persistence and Cordis catalogs are generated from the declarations.

## Alternatives considered

**Serial execution only:** rejected because independent tasks would not use the scheduler's bounded parallelism and would make the configured batch limit meaningless.

**Infer conflicts from task descriptions:** rejected because descriptions do not provide a reliable read/write declaration; callers must declare resource keys explicitly.

**Resume incomplete tasks after a process crash:** rejected because arbitrary executor state is not durable, so automatic resumption could repeat side effects without an ownership or idempotency guarantee.

## Consequences

The scheduler cannot infer read/write safety from task descriptions; callers must declare `parallel` and resource keys, and omitted concurrency remains fail-closed. A process crash leaves the last committed task state in the log and does not resume an incomplete graph automatically.
