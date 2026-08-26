/** Package-owned durable plan-mode invariants. @module @deepseek-ai/dsh-plan-mode/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { validatePlanTasks } from './scheduler.ts'
import type { PlanTaskId, PlanTaskStatus } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-plan-mode'

/** Cordis companion plugin name. */
export const name = 'plan-mode-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one `plan/mode` event before it reaches the durable log.
 * `plan/mode` is a standalone whole-value event: an idle selection commits
 * between turns and a mid-turn selection commits at the step boundary, so
 * no turn-enclosure relation exists — only the payload shape is checkable.
 */
interface PlanState {
  tasks: Map<PlanTaskId, PlanTaskStatus>
  ended: boolean
}

function validateEvent(
  event: SessionEvent,
  fail: InvariantFailure,
  plans: Map<string, PlanState>,
): void {
  if (event.type === 'plan/mode') {
    const active = (event.data as { active?: unknown }).active
    if (typeof active !== 'boolean') {
      fail(`plan/mode carries invalid active state ${JSON.stringify(active)}; expected a boolean`)
    }
    return
  }
  if (event.type === 'plan/tasks') {
    const planKey = String(event.data.planId)
    if (plans.has(planKey)) {
      fail(`plan/tasks repeats plan id ${JSON.stringify(planKey)}`)
      return
    }
    try {
      validatePlanTasks(event.data.tasks)
    } catch (error: unknown) {
      fail(`plan/tasks is invalid: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const statuses = new Map<PlanTaskId, PlanTaskStatus>()
    for (const task of event.data.tasks) {
      if (task.status !== 'pending') fail(`plan/tasks task ${String(task.id)} must start pending`)
      statuses.set(task.id, task.status)
    }
    plans.set(planKey, { tasks: statuses, ended: false })
    return
  }
  if (event.type === 'plan/task-status') {
    const plan = plans.get(String(event.data.planId))
    if (plan === undefined) {
      fail(`plan/task-status references unknown plan ${String(event.data.planId)}`)
      return
    }
    if (plan.ended) {
      fail(`plan/task-status appears after plan/end for ${String(event.data.planId)}`)
      return
    }
    const previous = plan.tasks.get(event.data.taskId)
    if (previous === undefined) {
      fail(`plan/task-status references unknown task ${String(event.data.taskId)}`)
      return
    }
    if (!validTransition(previous, event.data.status)) {
      fail(`plan/task-status changes ${String(event.data.taskId)} from ${previous} to ${event.data.status}`)
      return
    }
    if ((event.data.status === 'failed' || event.data.status === 'blocked') && event.data.error === undefined) {
      fail(`plan/task-status ${event.data.status} needs error facts for ${String(event.data.taskId)}`)
    }
    plan.tasks.set(event.data.taskId, event.data.status)
    return
  }
  if (event.type === 'plan/end') {
    const plan = plans.get(String(event.data.planId))
    if (plan === undefined) {
      fail(`plan/end references unknown plan ${String(event.data.planId)}`)
      return
    }
    if (plan.ended) {
      fail(`plan/end repeats plan id ${String(event.data.planId)}`)
      return
    }
    const statuses = [...plan.tasks.values()]
    if (event.data.outcome === 'completed' && statuses.some(status => status !== 'completed')) {
      fail(`plan/end completed with non-completed tasks for ${String(event.data.planId)}`)
    }
    if (event.data.outcome === 'failed' && statuses.some(status => status === 'pending' || status === 'running')) {
      fail(`plan/end failed with unsettled tasks for ${String(event.data.planId)}`)
    }
    if (event.data.outcome === 'failed' && !statuses.some(status => status === 'failed' || status === 'blocked')) {
      fail(`plan/end failed without a failed or blocked task for ${String(event.data.planId)}`)
    }
    if (event.data.outcome === 'cancelled' && statuses.some(status => status === 'running')) {
      fail(`plan/end cancelled with running tasks for ${String(event.data.planId)}`)
    }
    plan.ended = true
  }
}

function validTransition(previous: PlanTaskStatus, next: PlanTaskStatus): boolean {
  return (previous === 'pending' && (next === 'running' || next === 'blocked'))
    || (previous === 'running' && (next === 'completed' || next === 'failed'))
}

/** Install validation for loaded and newly appended plan-mode state. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seed = (session: Session): void => {
    const plans = new Map<string, PlanState>()
    for (const event of session.events) validateEvent(event, fail, plans)
    states.set(session, plans)
  }
  const states = new WeakMap<Session, Map<string, PlanState>>()
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    let plans = states.get(args[0] as Session)
    if (plans === undefined) {
      plans = new Map<string, PlanState>()
      states.set(args[0] as Session, plans)
    }
    validateEvent(event, fail, plans)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the plan-mode invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
