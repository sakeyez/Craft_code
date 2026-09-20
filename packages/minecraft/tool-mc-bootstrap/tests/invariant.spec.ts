import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BootstrapInvariant from '../src/invariant.ts'

describe('Minecraft bootstrap invariant companion', () => {
  it('registers under the host package name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(BootstrapInvariant).await()).resolves.toBeDefined()
  })
})
