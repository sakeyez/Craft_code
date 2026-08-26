import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as PlanModeInvariant from '@deepseek-ai/dsh-plan-mode/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { PlanId, PlanTaskId } from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(PlanModeInvariant)
  return ctx
}

function event(active: unknown): SessionEvent {
  return { type: 'plan/mode', seq: 0, time: 0, data: { active } } as SessionEvent
}

function emitTurnStart(ctx: Context, session: Session): void {
  ctx.emit('session/event', session, {
    type: 'turn/start', seq: 0, time: 0,
    data: { turn: 1 },
  })
}

function appendPlanEvent<T extends SessionEvent['type']>(
  ctx: Context,
  session: Session,
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
): void {
  void ctx
  const append = session.append.bind(session) as unknown as (eventType: T, eventData: typeof data) => SessionEvent
  append(type, data)
}

describe('plan-mode stream invariants', () => {
  it('accepts either boolean state', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('plan-state'))
    emitTurnStart(ctx, session)
    expect(() => { ctx.emit('session/event', session, event(true)) }).not.toThrow()
    expect(() => { ctx.emit('session/event', session, event(false)) }).not.toThrow()
    ctx.emit('session/event', session, {
      type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } },
    })
  })

  it.each([42, 'plan', undefined])('rejects invalid durable plan state %j', async (active) => {
    const ctx = await setup()
    const session = Session.create(SessionId(`invalid-${String(active)}`))
    emitTurnStart(ctx, session)
    expect(() => { ctx.emit('session/event', session, event(active)) })
      .toThrow(/expected a boolean/)
  })

  it('accepts standalone plan state between turns (the idle immediate commit)', async () => {
    const ctx = await setup()
    expect(() => ctx.sessions.create().append('plan/mode', { active: true }))
      .not.toThrow()
  })

  it('ignores unrelated dispatches and session events', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('unrelated'))
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects invalid existing state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('plan/mode', { active: 'plan' as unknown as boolean })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PlanModeInvariant).then(() => undefined)).rejects.toThrow(/expected a boolean/)
  })

  it('replays enclosed existing plan state through its closing boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('plan/mode', { active: true })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PlanModeInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('accepts standalone existing plan state on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('plan/mode', { active: true })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PlanModeInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('accepts a complete task graph lifecycle and rejects invalid transitions', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    const planId = PlanId('invariant-plan')
    const taskId = PlanTaskId('task-a')
    appendPlanEvent(ctx, session, 'plan/tasks', {
      planId,
      tasks: [{
        id: taskId,
        description: 'task a',
        dependencies: [],
        concurrency: 'parallel',
        resources: [],
        status: 'pending',
      }],
    })
    appendPlanEvent(ctx, session, 'plan/task-status', { planId, taskId, status: 'running' })
    appendPlanEvent(ctx, session, 'plan/task-status', { planId, taskId, status: 'completed' })
    appendPlanEvent(ctx, session, 'plan/end', { planId, outcome: 'completed' })
    expect(() => {
      appendPlanEvent(ctx, session, 'plan/task-status', {
        planId, taskId, status: 'failed', error: { name: 'Error', message: 'late' },
      })
    }).toThrow(/after plan\/end/)
  })

  it('rejects a completed plan with a non-completed task', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    const planId = PlanId('invariant-incomplete')
    appendPlanEvent(ctx, session, 'plan/tasks', {
      planId,
      tasks: [{ id: PlanTaskId('task-a'), description: 'task a', dependencies: [], status: 'pending' }],
    })
    expect(() => { appendPlanEvent(ctx, session, 'plan/end', { planId, outcome: 'completed' }) })
      .toThrow(/non-completed tasks/)
  })
})
