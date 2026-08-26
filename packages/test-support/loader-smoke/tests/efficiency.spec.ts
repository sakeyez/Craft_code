import { describe, expect, it } from 'vitest'
import { parseEfficiencyMetrics } from '@deepseek-ai/dsh-loader-smoke'

describe('parseEfficiencyMetrics', () => {
  it('folds existing session JSONL into efficiency evidence', () => {
    const lines = [
      { type: 'user/message', data: { source: { kind: 'skill-catalog' } } },
      { type: 'tool/call', data: { name: 'read_file', arguments: JSON.stringify({ path: 'src/index.ts' }) } },
      { type: 'tool/call', data: { name: 'read_file', arguments: JSON.stringify({ path: 'src/index.ts' }) } },
      { type: 'tool/call', data: { name: 'run_test', arguments: JSON.stringify({ command: 'pnpm test' }) } },
      { type: 'tool/call', data: { name: 'run_test', arguments: JSON.stringify({ command: 'pnpm test' }) } },
      { type: 'llm/retry', data: {} },
      { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'typescript' } } },
      { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, reasoningTokens: 1 } } },
    ].map(line => JSON.stringify(line)).join('\n')
    const metrics = parseEfficiencyMetrics(lines, { requiredValidationTypes: ['tool/call', 'assistant/message', 'step/end'] })
    expect(metrics.toolCalls).toBe(4)
    expect(metrics.duplicateReadsByCategory.read).toBe(1)
    expect(metrics.repeatedValidationCalls).toBe(1)
    expect(metrics.skillCatalogInjections).toBe(1)
    expect(metrics.skillLoads).toBe(1)
    expect(metrics.retries).toBe(1)
    expect(metrics.tokens).toEqual({
      input: 10, output: 4, cache: 2, cacheRead: 2, cacheWrite: undefined, reasoning: 1,
    })
    expect(metrics.requiredValidationEvents).toEqual(['tool/call', 'assistant/message'])
    expect(metrics.transcriptDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps unavailable token fields explicitly unavailable', () => {
    const metrics = parseEfficiencyMetrics(JSON.stringify({ type: 'assistant/message', data: { usage: {} } }))
    expect(metrics.tokens).toEqual({
      input: undefined, output: undefined, cache: undefined, cacheRead: undefined,
      cacheWrite: undefined, reasoning: undefined,
    })
  })
})
