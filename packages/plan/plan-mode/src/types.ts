import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Pure types of the plan domain: the ONE home of the `plan` projection-key
 * declaration, free of this package's host-side value imports (cordis
 * service, dsh-tools, dsh-agent). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-plan-mode/types
 */

/**
 * The plan projection's wire value. `active` is the logged state in force
 * (the last `plan/mode`, inactive before the first); `pending` is true while
 * a logged `/plan` selection targets a state other than `active`, has not
 * failed through its paired `command/done`, and no later `plan/mode` event has
 * recorded that state. Capability absence (plan-mode not composed) is the
 * key's absence, never a value.
 */
export interface PlanProjection {
  active: boolean
  pending: boolean
}

/** Identifies one persisted task graph. */
export type PlanId = Branded<'PlanId'>

/**
 * Brand a raw plan id for durable task events.
 * @param id - raw durable identifier.
 * @returns the branded plan identifier.
 */
export function PlanId(id: string): PlanId {
  return id as PlanId
}

/** Identifies one task inside a persisted task graph. */
export type PlanTaskId = Branded<'PlanTaskId'>

/**
 * Brand a raw task id for durable task events.
 * @param id - raw durable identifier.
 * @returns the branded task identifier.
 */
export function PlanTaskId(id: string): PlanTaskId {
  return id as PlanTaskId
}

/** Lifecycle states owned by the task graph scheduler. */
export type PlanTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked'

/** Whether a task may share a batch with other parallel tasks. */
export type PlanTaskConcurrency = 'parallel' | 'exclusive'

/** A task graph node before execution begins. */
export interface PlanTaskSpec {
  id: PlanTaskId
  description: string
  dependencies: PlanTaskId[]
  concurrency?: PlanTaskConcurrency
  resources?: string[]
}

/** A task graph node with its current scheduler state. */
export interface PlanTask extends PlanTaskSpec {
  status: PlanTaskStatus
  error?: PlanTaskError
}

/** JSON-safe error facts persisted for a failed or blocked task. */
export interface PlanTaskError {
  name: string
  message: string
  code?: string
}

/** Context supplied to one task executor invocation. */
export interface PlanTaskExecutionContext {
  signal: AbortSignal
  dependencies: ReadonlyMap<PlanTaskId, unknown>
}

/** Executes one task after the scheduler has admitted it. */
export type PlanTaskExecutor = (
  task: PlanTaskSpec,
  context: PlanTaskExecutionContext,
) => Promise<unknown>

/** Optional controls for one task graph execution. */
export interface PlanExecutionOptions {
  signal?: AbortSignal
}

/** Overall outcome of one task graph execution. */
export type PlanExecutionOutcome = 'completed' | 'failed' | 'cancelled'

/** Result returned after every admitted task has settled. */
export interface PlanExecutionResult {
  planId: PlanId
  outcome: PlanExecutionOutcome
  tasks: PlanTask[]
  outputs: ReadonlyMap<PlanTaskId, unknown>
}

/** Replayable task state reconstructed from the session log. */
export interface PlanExecutionSnapshot {
  planId: PlanId
  tasks: PlanTask[]
  outcome?: PlanExecutionOutcome
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whether plan mode is in force from this point on. */
    'plan/mode': { active: boolean }
    /** Full task graph snapshot written before any task starts. */
    'plan/tasks': { planId: PlanId; tasks: PlanTask[] }
    /** One task status transition, in original task order per scheduler commit. */
    'plan/task-status': { planId: PlanId; taskId: PlanTaskId; status: PlanTaskStatus; error?: PlanTaskError }
    /** Terminal outcome for one task graph. */
    'plan/end': { planId: PlanId; outcome: PlanExecutionOutcome }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Plan collaboration state folded from the plan command lifecycle and `plan/mode` events. */
    plan: PlanProjection
  }
}
