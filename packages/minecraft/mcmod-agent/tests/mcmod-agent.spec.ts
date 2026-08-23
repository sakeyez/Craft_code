import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'
import * as McmodAgent from '@deepseek-ai/dsh-mcmod-agent'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '' })
  return ctx
}

describe('the Minecraft modding prompt row', () => {
  it('registers only the Minecraft modding prompt sections', async () => {
    const ctx = await harness()
    await ctx.plugin(McmodAgent)

    const assembly = await ctx.systemPrompt.assemble()
    const minecraftSections = assembly.sections.filter(section => section.name.startsWith('minecraft:'))

    expect(minecraftSections.map(section => section.name)).toEqual([
      'minecraft:identity',
      'minecraft:scope',
      'minecraft:workflow',
      'minecraft:resources',
      'minecraft:version-discipline',
    ])
    expect(minecraftSections[0]?.text).toContain('identify the loader, Minecraft version, mappings')
    expect(minecraftSections[1]?.text).toContain('Support Fabric and NeoForge Java projects')
    expect(minecraftSections[2]?.text).toContain('settings.gradle(.kts), build.gradle(.kts), gradle.properties')
    expect(minecraftSections[4]?.text).toContain('Do not mix Fabric, Forge, NeoForge')
    expect(assembly.tools).toEqual([])
  })

  it('can be scoped to one preset-composed agent', async () => {
    const ctx = await harness()
    const scoped: ScopeKey = { agent: 'minecraft-agent' }
    const other: ScopeKey = { agent: 'standard-agent' }

    await createScope(ctx, scoped).ctx.plugin(McmodAgent)

    expect((await ctx.systemPrompt.assemble({ scope: scoped })).sections.map(section => section.name))
      .toEqual(expect.arrayContaining(['minecraft:identity', 'minecraft:version-discipline']))
    expect((await ctx.systemPrompt.assemble({ scope: other })).sections.map(section => section.name))
      .not.toEqual(expect.arrayContaining(['minecraft:identity']))
  })

  it('removes its sections when the owning fiber unloads', async () => {
    const ctx = await harness()
    const fiber = await ctx.plugin(McmodAgent)
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name)).toContain('minecraft:identity')

    await fiber.dispose()

    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name)).not.toContain('minecraft:identity')
  })
})
