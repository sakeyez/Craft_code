import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ensureJava, javaEnv, requiredJava } from '../src/environment.ts'
import { runProcess } from '../src/process.ts'
import { fetchJson } from '../src/download.ts'

vi.mock('../src/process.ts', () => ({ runProcess: vi.fn() }))
vi.mock('../src/download.ts', () => ({ fetchJson: vi.fn(), cachedDownload: vi.fn(), extractZip: vi.fn() }))
let root: string
let ctx: Context
beforeEach(async () => {
  vi.resetAllMocks()
  root = await mkdtemp(join(tmpdir(), 'craftcode-java-'))
  vi.stubEnv('DSH_HOME', root)
  vi.stubEnv('JAVA_HOME', root)
  ctx = { subprocess: { resolveExecutable: async () => undefined } } as unknown as Context
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

it.each([
  ['1.20.1', 17],
  ['1.21.1', 21],
] as const)('reuses a compatible JDK for %s without changing system Java', async (version, major) => {
  await mkdir(join(root, 'bin'))
  await writeFile(join(root, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), '')
  vi.mocked(runProcess).mockResolvedValue({ text: `openjdk version "${major}.0.1"`, exitCode: 0, truncated: false })
  const environment = await ensureJava(ctx, requiredJava(version), new AbortController().signal, async () => {})
  expect(environment).toMatchObject({ major, managed: false, available: true })
  expect(javaEnv(environment).JAVA_HOME).toBe(root)
  expect(process.env.JAVA_HOME).toBe(root)
  expect(fetchJson).not.toHaveBeenCalled()
})

it('reports a missing-JDK download failure and permits a clean retry', async () => {
  vi.mocked(fetchJson).mockRejectedValueOnce(new Error('download offline')).mockResolvedValueOnce([])
  await expect(ensureJava(ctx, 21, new AbortController().signal, async () => {})).rejects.toThrow('download offline')
  await expect(ensureJava(ctx, 21, new AbortController().signal, async () => {})).rejects.toThrow('Adoptium 未返回')
  expect(fetchJson).toHaveBeenCalledTimes(2)
})

it('propagates cancellation without fetching a JDK', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(ensureJava(ctx, 21, controller.signal, async () => {})).rejects.toThrow('cancelled')
  expect(fetchJson).not.toHaveBeenCalled()
})
