/** Pure dependency-graph scheduler for Plan mode task execution. @module @deepseek-ai/dsh-plan-mode/scheduler */

import type {
  PlanExecutionOutcome,
  PlanExecutionResult,
  PlanTask,
  PlanTaskError,
  PlanTaskExecutor,
  PlanTaskId,
  PlanTaskSpec,
  PlanTaskStatus,
} from './types.ts'

/** A malformed task graph cannot be scheduled. */
export class PlanGraphError extends Error {
  override name = 'PlanGraphError'
}

interface TaskState {
  readonly spec: PlanTaskSpec
  status: PlanTaskStatus
  error?: PlanTaskError
}

/**
 * Execute a validated dependency graph in deterministic, bounded batches.
 * @param planId - durable graph identity.
 * @param input - task specifications in their authored order.
 * @param executor - task body invoked for each runnable task.
 * @param maxParallelTasks - soft concurrency width for parallel tasks.
 * @param signal - cancellation signal observed between batches.
 * @param onTransition - optional durable status transition callback.
 * @returns final statuses and dependency outputs.
 */
export async function executePlanTasks(
  planId: PlanExecutionResult['planId'],
  input: readonly PlanTaskSpec[],
  executor: PlanTaskExecutor,
  maxParallelTasks: number,
  signal: AbortSignal,
  onTransition?: (task: PlanTask, status: PlanTaskStatus, error?: PlanTaskError) => Promise<void> | void,
): Promise<PlanExecutionResult> {
  validateMaxParallelTasks(maxParallelTasks)
  const states = stateMap(validatePlanTasks(input))
  const outputs = new Map<PlanTaskId, unknown>()

  while (true) {
    const blocked = markBlocked(states)
    for (const state of blocked) {
      await onTransition?.(snapshotTask(state), state.status, state.error)
    }
    const pending = [...states.values()].filter(state => state.status === 'pending')
    if (pending.length === 0) break
    if (signal.aborted) break

    const ready = pending.filter(state => state.spec.dependencies.every(
      dependency => states.get(dependency)?.status === 'completed',
    ))
    const batch = selectBatch(ready, maxParallelTasks)
    if (batch.length === 0) {
      throw new PlanGraphError('Plan has pending tasks with no runnable dependency-free batch')
    }

    for (const state of batch) {
      state.status = 'running'
      await onTransition?.(snapshotTask(state), state.status)
    }
    const settled = await Promise.allSettled(batch.map(async (state) => {
      const dependencies = new Map<PlanTaskId, unknown>()
      for (const dependency of state.spec.dependencies) dependencies.set(dependency, outputs.get(dependency))
      return executor(state.spec, { signal, dependencies })
    }))

    for (let index = 0; index < batch.length; index += 1) {
      const state = batch[index]
      const result = settled[index]
      if (state === undefined || result === undefined) throw new PlanGraphError('Scheduler batch became inconsistent')
      if (result.status === 'fulfilled') {
        state.status = 'completed'
        outputs.set(state.spec.id, result.value)
      } else {
        state.status = 'failed'
        state.error = errorFacts(result.reason)
      }
      await onTransition?.(snapshotTask(state), state.status, state.error)
    }
  }

  const outcome: PlanExecutionOutcome = signal.aborted
    ? 'cancelled'
    : [...states.values()].every(state => state.status === 'completed')
      ? 'completed'
      : 'failed'
  return {
    planId,
    outcome,
    tasks: [...states.values()].map(state => ({
      ...state.spec,
      status: state.status,
      ...(state.error === undefined ? {} : { error: state.error }),
    })),
    outputs,
  }
}

/**
 * Validate the graph and create the scheduler-owned state in input order.
 * @param input - task specifications to validate.
 * @returns normalized task specifications with explicit defaults.
 */
export function validatePlanTasks(input: readonly PlanTaskSpec[]): PlanTaskSpec[] {
  if (input.length === 0) throw new PlanGraphError('Plan must contain at least one task')
  const states = new Map<PlanTaskId, TaskState>()
  for (const spec of input) {
    if (spec.id === '') throw new PlanGraphError('Plan task ids must be non-empty')
    if (spec.description.trim() === '') throw new PlanGraphError(`Plan task ${String(spec.id)} needs a description`)
    if (states.has(spec.id)) throw new PlanGraphError(`Plan repeats task id ${String(spec.id)}`)
    const concurrency = spec.concurrency ?? 'exclusive'
    const resources = spec.resources ?? []
    if (new Set(resources).size !== resources.length) {
      throw new PlanGraphError(`Plan task ${String(spec.id)} repeats a resource key`)
    }
    states.set(spec.id, {
      spec: {
        ...spec,
        dependencies: [...spec.dependencies],
        concurrency,
        resources: [...resources],
      },
      status: 'pending',
    })
  }
  for (const state of states.values()) {
    const dependencies = new Set<PlanTaskId>()
    for (const dependency of state.spec.dependencies) {
      if (dependency === state.spec.id) throw new PlanGraphError(`Plan task ${String(dependency)} depends on itself`)
      if (!states.has(dependency)) throw new PlanGraphError(`Plan task ${String(state.spec.id)} has unknown dependency ${String(dependency)}`)
      if (dependencies.has(dependency)) throw new PlanGraphError(`Plan task ${String(state.spec.id)} repeats dependency ${String(dependency)}`)
      dependencies.add(dependency)
    }
  }
  assertAcyclic(states)
  return [...states.values()].map(state => state.spec)
}

function stateMap(input: readonly PlanTaskSpec[]): Map<PlanTaskId, TaskState> {
  const states = new Map<PlanTaskId, TaskState>()
  for (const spec of input) states.set(spec.id, { spec, status: 'pending' })
  return states
}

/** Reject a cycle before any task or durable status can be started. */
function assertAcyclic(states: Map<PlanTaskId, TaskState>): void {
  const visiting = new Set<PlanTaskId>()
  const visited = new Set<PlanTaskId>()
  const visit = (id: PlanTaskId): void => {
    if (visiting.has(id)) throw new PlanGraphError(`Plan contains a dependency cycle at ${String(id)}`)
    if (visited.has(id)) return
    visiting.add(id)
    const state = states.get(id)
    if (state === undefined) throw new PlanGraphError(`Plan references unknown task ${String(id)}`)
    for (const dependency of state.spec.dependencies) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of states.keys()) visit(id)
}

/** Mark every pending task whose dependency has failed or been blocked. */
function markBlocked(states: Map<PlanTaskId, TaskState>): TaskState[] {
  const blocked: TaskState[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const state of states.values()) {
      if (state.status !== 'pending') continue
      const failedDependency = state.spec.dependencies.find((dependency) => {
        const dependencyState = states.get(dependency)
        if (dependencyState === undefined) throw new PlanGraphError(`Plan references unknown task ${String(dependency)}`)
        const dependencyStatus = dependencyState.status
        return dependencyStatus === 'failed' || dependencyStatus === 'blocked'
      })
      if (failedDependency === undefined) continue
      state.status = 'blocked'
      state.error = {
        name: 'PlanDependencyError',
        code: 'PLAN_BLOCKED',
        message: `dependency ${String(failedDependency)} did not complete`,
      }
      blocked.push(state)
      changed = true
    }
  }
  return blocked
}

function snapshotTask(state: TaskState): PlanTask {
  return {
    ...state.spec,
    status: state.status,
    ...(state.error === undefined ? {} : { error: state.error }),
  }
}

/** Select a conflict-free ready batch while preserving original task order. */
function selectBatch(ready: readonly TaskState[], limit: number): TaskState[] {
  const selected: TaskState[] = []
  for (const candidate of ready) {
    if (selected.length >= limit) break
    if (canJoinBatch(candidate, selected)) selected.push(candidate)
  }
  return selected
}

function canJoinBatch(candidate: TaskState, selected: readonly TaskState[]): boolean {
  if (candidate.spec.concurrency !== 'parallel') return selected.length === 0
  if (selected.some(task => task.spec.concurrency !== 'parallel')) return false
  const resources = new Set(candidate.spec.resources)
  return !selected.some(task => (task.spec.resources ?? []).some(resource => resources.has(resource)))
}

function validateMaxParallelTasks(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PlanGraphError('maxParallelTasks must be a positive safe integer')
  }
}

function errorFacts(reason: unknown): PlanTaskError {
  if (reason instanceof Error) {
    const code = 'code' in reason && typeof reason.code === 'string' ? reason.code : undefined
    return { name: reason.name, message: reason.message, ...(code === undefined ? {} : { code }) }
  }
  if (typeof reason === 'object' && reason !== null) {
    const value = reason as Record<string, unknown>
    const name = typeof value.name === 'string' ? value.name : 'Error'
    const message = typeof value.message === 'string' ? value.message : JSON.stringify(value)
    const code = typeof value.code === 'string' ? value.code : undefined
    return { name, message, ...(code === undefined ? {} : { code }) }
  }
  return { name: 'Error', message: String(reason) }
}
