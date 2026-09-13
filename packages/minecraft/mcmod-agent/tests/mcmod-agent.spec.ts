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
    expect(minecraftSections[0]?.text).toContain('Match the work to the current request')
    expect(minecraftSections[1]?.text).toContain('Support Fabric and NeoForge Java projects')
    expect(minecraftSections[2]?.text).toContain('Choose only the steps needed for the current request')
    expect(minecraftSections[4]?.text).toContain('Do not mix Fabric, Forge, NeoForge')
    expect(assembly.tools).toEqual([])
  })

  it.each([
    ['general questions', 'answer directly when the available evidence is sufficient'],
    ['screenshots', 'inspect the attached image and selected region first'],
    ['missing images', 'do not search the disk for an unknown screenshot'],
    ['code explanations', 'locate the relevant code and read its dependencies as needed'],
    ['diagnosis', 'start from the exact error and related code'],
    ['resource changes', 'validate_mc_resources for resource changes'],
    ['full development', 'complete requested work and its acceptance checks'],
    ['follow-up questions', 'a follow-up question does not restart a completed implementation'],
    ['stale facts', 'refresh them after a project switch, relevant configuration changes, or conflicting evidence'],
    ['runtime authorization', 'obtain user approval before launching a game'],
  ])('delivers the %s rule in the assembled prompt', async (_scenario, rule) => {
    const ctx = await harness()
    await ctx.plugin(McmodAgent)
    const assembly = await ctx.systemPrompt.assemble()
    const workflow = assembly.sections.find(section => section.name === 'minecraft:workflow')
    expect(workflow?.text).toBe(McmodAgent.WORKFLOW_PROMPT)
    expect(workflow?.text).toContain(rule)
    expect(assembly.sections.map(section => section.text).join('\n')).not.toContain('before acting')
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
