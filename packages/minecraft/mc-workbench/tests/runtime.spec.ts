import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MinecraftRuns } from '../src/runtime.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-runtime-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
describe('retained run logs', () => {
  it('reassembles UTF-8 output at chunk boundaries and marks previous live runs interrupted', async () => {
    const id = randomUUID()
    const directory = join(root, '.dsh/runs', id)
    await mkdir(directory, { recursive: true })
    const content = 'a'.repeat(65534) + '中文日志\n'.repeat(100)
    await writeFile(join(directory, 'output.log'), content)
    await writeFile(
      join(directory, 'state.json'),
      JSON.stringify({
        id,
        cwd: root,
        action: 'client',
        phase: 'running',
        startedAt: '2026-09-16T00:00:00Z',
        updatedAt: '2026-09-16T00:00:00Z',
        message: '',
        logPath: `.dsh/runs/${id}/output.log`,
        format: 3,
        evidence: { gameplay: 'unverified', worldReadyAt: '2026-09-16T00:00:01Z' },
      }),
    )
    const service = new MinecraftRuns({} as Context)
    const first = await service.logs(root, id, 0)
    const second = await service.logs(root, id, first.cursor)
    expect(first.text + second.text).toBe(content)
    expect(first.text).not.toContain('�')
    expect(second.complete).toBe(true)
    expect((await service.history(root))[0]?.phase).toBe('interrupted')
    expect((await service.history(root))[0]?.evidence?.worldReadyAt).toBeUndefined()
  })
  it('rejects another project run id and invalid cursors', async () => {
    const service = new MinecraftRuns({} as Context)
    await expect(service.logs(root, '../outside', 0)).rejects.toThrow('无效')
    await expect(service.logs(root, randomUUID(), -1)).rejects.toThrow('无效')
    await expect(service.stop(root, randomUUID())).rejects.toThrow('不属于')
  })
})
