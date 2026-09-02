import { describe, expect, it } from 'vitest'
import { parseGradleTaskNames, runtimeTaskCandidates } from '../src/gradle-tasks.ts'

describe('Gradle runtime task discovery', () => {
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
