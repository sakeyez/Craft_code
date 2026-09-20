import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDispatchExecution } from '@deepseek-ai/dsh-tools'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MinecraftCheckpoints } from '../src/checkpoints.ts'
import { hash } from '../src/files.ts'
import * as consumer from '../src/tools.ts'

let root: string
let ctx: Context
let checkpoints: MinecraftCheckpoints
let agent: Agent
const events = [{ type: 'turn/start', data: { turn: 1 } }]
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-tool-backup-'))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/A.java'), 'before')
  ctx = new Context()
  checkpoints = new MinecraftCheckpoints()
  events[0]!.data.turn = 1
  agent = { session: { id: 'fixture', header: { cwd: root }, events } } as unknown as Agent
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('minecraftWorkbench', { checkpoints })
  await ctx.plugin(consumer)
})
afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

async function execute(name: string, body: () => Promise<void>): Promise<void> {
  const exec = { name, agent, signal: new AbortController().signal } as ToolDispatchExecution
  await ctx.waterfall(scopeTarget(ctx.tools, agent), 'tools/execute', exec, async () => {
    await body()
    return { isError: false as const, value: null, content: [] }
  })
}

it('backs up before concurrent mutations, reuses a turn checkpoint and renews it next turn', async () => {
  const capture = vi.spyOn(checkpoints, 'create')
  await execute('read', async () => {})
  expect(capture).not.toHaveBeenCalled()
  const order: string[] = []
  await Promise.all(['write', 'pwsh'].map(name => execute(name, async () => {
    const rows = await checkpoints.list(root)
    expect(rows[0]?.files['src/A.java']).toBe(hash('before'))
    order.push(name)
    await writeFile(join(root, 'src/A.java'), name)
  })))
  expect(order).toEqual(['write', 'pwsh'])
  expect(capture).toHaveBeenCalledTimes(1)
  events[0]!.data.turn = 2
  await execute('bash', async () => {})
  expect(capture).toHaveBeenCalledTimes(2)
  expect((await checkpoints.list(root))[0]?.files['src/A.java']).toBe(hash('pwsh'))
})

it('blocks dispatch on backup failure and allows a complete backup on retry', async () => {
  vi.spyOn(checkpoints, 'create').mockRejectedValueOnce(new Error('disk full'))
  const body = vi.fn(async () => { await writeFile(join(root, 'src/A.java'), 'after') })
  await expect(execute('edit', body)).rejects.toThrow('disk full')
  expect(body).not.toHaveBeenCalled()
  expect(await readFile(join(root, 'src/A.java'), 'utf8')).toBe('before')
  expect(await checkpoints.list(root)).toHaveLength(0)
  await execute('edit', body)
  expect(body).toHaveBeenCalledTimes(1)
  expect((await checkpoints.list(root))[0]?.files['src/A.java']).toBe(hash('before'))
})
