import { mkdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BENCHMARK_PROMPT_SOURCE,
  estimateCost,
  evaluateProject,
  injectRuntimeTest,
  parseBenchmarkPrompts,
  parseTimelineMetrics,
  runtimeSource,
  sessionText,
} from './mcmod-agent-benchmark.ts'

describe('mcmod agent benchmark prompt source', () => {
  it('extracts exactly the runnable task bodies', () => {
    const source = [
      'intro',
      '### 1. 准确度测试：Position Recorder',
      'commentary',
      '你正在一个 accuracy project',
      'A',
      '### 2. 速度测试：8 个 Dense Block',
      'commentary',
      '你正在一个 speed project',
      'B',
      '### 3. 复杂能力测试：Resonance Processor',
      'commentary',
      '你正在一个 complex project',
      'C',
      '这三题的区分度我觉得会相当不错。',
    ].join('\n')
    const prompts = parseBenchmarkPrompts(source)
    expect(prompts.map(prompt => prompt.id)).toEqual(['accuracy', 'speed', 'complex'])
    expect(prompts.map(prompt => prompt.text)).toEqual([
      '你正在一个 accuracy project\nA',
      '你正在一个 speed project\nB',
      '你正在一个 complex project\nC',
    ])
    expect(prompts.map(prompt => prompt.acceptanceTotal)).toEqual([14, 14, 27])
  })

  it('ships the three complete standard prompts', async () => {
    const prompts = parseBenchmarkPrompts(await readFile(DEFAULT_BENCHMARK_PROMPT_SOURCE, 'utf8'))
    expect(prompts.map(prompt => prompt.name)).toEqual([
      '准确度测试：Position Recorder',
      '速度测试：8 个 Dense Block',
      '复杂能力测试：Resonance Processor',
    ])
    expect(prompts.map(prompt => prompt.text.length)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)])
    expect(prompts.every(prompt => prompt.text.includes('Verified') && prompt.text.includes('Unverified'))).toBe(true)
    expect(prompts[0]?.text).toContain('agent_accuracy_test:position_recorder')
    expect(prompts[1]?.text).toContain('agent_speed_test:dense_diamond_block')
    expect(prompts[2]?.text).toContain('agent_complex_test:toggle_processor')
  })
})

describe('mcmod agent benchmark session metrics', () => {
  it('reads sessions from the run-owned DSH_HOME instead of the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcmod-benchmark-session-'))
    try {
      const directory = join(root, 'sessions', 'run')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'session.jsonl'), '{"type":"step/start","data":{}}\n')
      await expect(sessionText(root)).resolves.toEqual({
        raw: '{"type":"step/start","data":{}}\n',
        fileCount: 1,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('measures TTFT, tool duration, failures, build attempts, and first build success', () => {
    const rows = [
      { type: 'user/message', time: 100, data: { source: { kind: 'user' } } },
      { type: 'assistant/chunk', time: 140, data: {} },
      { type: 'step/start', time: 130, data: {} },
      { type: 'tool/call', time: 150, data: { callId: 'build-1', name: 'run_mc_check', arguments: '{"target":"build"}' } },
      { type: 'tool/result', time: 200, data: { message: { source: { callId: 'build-1' }, content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: '{"exitCode":1}' }] }] } } },
      { type: 'step/start', time: 210, data: {} },
      { type: 'tool/call', time: 220, data: { callId: 'build-2', name: 'run_mc_check', arguments: '{"target":"build"}' } },
      { type: 'tool/result', time: 300, data: { message: { source: { callId: 'build-2' }, content: [{ type: 'tool-result', isError: false, content: [{ type: 'text', text: '{"exitCode":0}' }] }] } } },
    ].map(row => JSON.stringify(row)).join('\n')
    expect(parseTimelineMetrics(rows)).toEqual({
      steps: 2,
      toolFailures: 1,
      averageToolDurationMs: 65,
      ttftMs: 40,
      buildAttempts: 2,
      firstBuildSuccessMs: 200,
    })
  })

  it('prices disjoint cache-read and cache-write fields', () => {
    const metrics = {
      input: 1_000,
      output: 2_000,
      cache: 3_000,
      cacheRead: 3_000,
      cacheWrite: 4_000,
      reasoning: 500,
    }
    expect(estimateCost({ tokens: metrics } as never, {
      currency: 'CNY', input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 5,
    })).toBeCloseTo(0.0325)
  })
})

describe('mcmod agent benchmark acceptance', () => {
  it('uses one automatically discovered GameTest registration with an explicit template namespace', () => {
    const source = runtimeSource({ id: 'complex', name: 'complex', text: '', acceptanceTotal: 27 })
    expect(source).toContain('@GameTestHolder("agent_complex_test")')
    expect(source).toContain('@PrefixGameTestTemplate(false)')
    expect(source).toContain('@GameTest(templateNamespace = "agent_complex_test", template = "empty"')
    expect(source).not.toContain('RegisterGameTestsEvent')
    expect(source).not.toContain('registerTests(')
  })

  it('injects the benchmark-owned template and removes stale generated helpers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcmod-benchmark-runtime-'))
    try {
      const stale = join(root, 'src', 'main', 'java', 'old', 'BenchmarkRuntimeGameTests.java')
      await mkdir(join(root, 'src', 'main', 'java', 'old'), { recursive: true })
      await writeFile(stale, 'stale')
      const source = await injectRuntimeTest(root, { id: 'accuracy', name: 'accuracy', text: '', acceptanceTotal: 14 })
      expect(source).toMatch(/com[\\/]example[\\/]agentaccuracy[\\/]BenchmarkRuntimeGameTests\.java$/u)
      await expect(readFile(stale, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(join(root, 'src', 'main', 'resources', 'data', 'agent_accuracy_test', 'structures', 'empty.nbt'))).resolves.toBeTruthy()
      await expect(readFile(join(root, 'gameteststructures', 'empty.snbt'), 'utf8')).resolves.toContain('minecraft:air')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails missing project evidence instead of trusting model output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcmod-benchmark-empty-'))
    try {
      const result = await evaluateProject(root, 'accuracy')
      expect(result.checks).not.toHaveLength(0)
      expect(result.checks.every(check => !check.passed)).toBe(true)
      expect(result.unverified).toContain('Minecraft loads the mod')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
