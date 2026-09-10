// @vitest-environment jsdom
/** The registered game action converts host refusal into a rejected save. */

import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISession, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, type GameWorkspaceInjected } from '../src/client/index.ts'

const disposers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

async function actionFor(session: Pick<ISession, 'annotate'> | undefined) {
  const ctx = new Context()
  const slotsFiber = ctx.plugin(SlotRegistry)
  await slotsFiber.await()
  disposers.push(async () => { await slotsFiber.dispose() })
  ctx.provide('theme', {
    getTheme: () => ({ active: { colorScheme: 'light', tokens: {} } }),
  } as never)
  const binding = vi.fn(() => session === undefined ? undefined : { session })
  ctx.provide('sessions', { binding } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  disposers.push(async () => { await fiber.dispose() })
  const slots = ctx.get('slots') as SlotRegistry
  const game = slots.entries('game')[0]
  expect(game).toBeDefined()
  const injectGame = game!.inject as unknown as (sessionId: SessionId | undefined) => GameWorkspaceInjected
  const sessionId = 'game-session' as SessionId
  return { injectGame, sessionId, binding }
}

describe('registered game annotation action', () => {
  it('rejects a resolved RPC error and permits a successful retry', async () => {
    const annotate = vi.fn<NonNullable<ISession['annotate']>>()
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'host rejected annotations', details: {} } })
      .mockResolvedValueOnce({ ok: true, value: { accepted: true, seq: 4 } })
    const { injectGame, sessionId, binding } = await actionFor({ annotate })
    const action = injectGame(sessionId).annotate!
    await expect(action([])).rejects.toThrow('host rejected annotations')
    await expect(action([])).resolves.toBeUndefined()
    expect(binding).toHaveBeenCalledWith(sessionId)
    expect(annotate).toHaveBeenCalledTimes(2)
    expect(annotate).toHaveBeenCalledWith([])
  })

  it.each([undefined, {}])('rejects when the bound session cannot save: %s', async (session) => {
    const { injectGame, sessionId } = await actionFor(session)
    await expect(injectGame(sessionId).annotate!([])).rejects.toThrow('当前会话无法保存游戏标注。')
  })

  it('offers no save action without a selected session', async () => {
    const { injectGame } = await actionFor(undefined)
    expect(injectGame(undefined).annotate).toBeUndefined()
  })
})
