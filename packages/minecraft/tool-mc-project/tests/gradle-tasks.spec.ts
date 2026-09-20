import { describe, expect, it } from 'vitest'
import { hasMinecraftReadiness, parseGradleTaskNames, runtimeTaskCandidates } from '../src/gradle-tasks.ts'

describe('Gradle runtime task discovery', () => {
  it('requires world readiness and accepts loader logger prefixes', () => {
    expect(hasMinecraftReadiness('server', '[12:00:00] [Server thread/INFO] [minecraft/DedicatedServer]: Done (4.51s)! For help, type "help"')).toBe(true)
    expect(hasMinecraftReadiness('client', '[Render thread/INFO]: Setting user: Player')).toBe(false)
    expect(hasMinecraftReadiness('client', '[Render thread/INFO]: Loaded 14 advancements')).toBe(false)
    expect(hasMinecraftReadiness('client', '[Server thread/INFO] [minecraft/MinecraftServer]: Dev joined the game')).toBe(true)
    expect(hasMinecraftReadiness('server', '[main/INFO]: Starting minecraft server')).toBe(false)
  })
  it('parses unique plain task rows in lexical order', () => {
    expect(parseGradleTaskNames([
      'Build tasks',
      'runClient - Launches Minecraft',
      ':mod:runClient - Qualified task',
      'runGame',
      'runClient - Duplicate row',
      '',
    ].join('\n'))).toEqual(['mod:runClient', 'runClient', 'runGame'])
  })

  it('selects only conventional unqualified client and server tasks', () => {
    const tasks = ['runClient', 'runGame', ':mod:runClient', 'runServer', 'runDedicatedServer', 'clientRun']
    expect(runtimeTaskCandidates('client', tasks)).toEqual(['runClient', 'runGame'])
    expect(runtimeTaskCandidates('server', tasks)).toEqual(['runDedicatedServer', 'runServer'])
  })
})
