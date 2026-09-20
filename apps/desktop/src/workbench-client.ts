/** Electron consumes host-owned runs; process ids never come from renderer requests. */
import { randomUUID } from 'node:crypto'
import { parseWorkbenchResponse } from '@deepseek-ai/dsh-mc-workbench/contracts'
import type { DesktopCommandResult } from './preload.ts'

export interface NativeWorkbenchRun {
  id: string
  pid: number
}
export interface WorkbenchRun {
  id: string
  phase: string
  message: string
}
export async function workbenchRequest<T>(
  base: string,
  cwd: string,
  endpoint: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const rpcId = randomUUID()
  const response = await fetch(new URL(`/mc-workbench/${endpoint}`, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { cwd, ...payload } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`工作台连接失败：HTTP ${response.status}`)
  const data = (await response.json()) as {
    rpcId?: unknown
    result?: { ok?: unknown; value?: unknown; error?: { message?: unknown } }
  }
  if (data.rpcId !== rpcId || typeof data.result?.ok !== 'boolean') throw new Error('工作台响应无效。')
  if (!data.result.ok)
    throw new Error(
      typeof data.result.error?.message === 'string' ? data.result.error.message : '工作台请求失败。',
    )
  return parseWorkbenchResponse(endpoint, data.result.value) as T
}

export async function toggleWorkbenchGame(base: string, cwd: string): Promise<DesktopCommandResult> {
  const runs = await workbenchRequest<WorkbenchRun[]>(base, cwd, 'runs')
  if (!Array.isArray(runs)) throw new Error('运行状态无效。')
  const active = runs.find(run => !['exited', 'failed', 'cancelled', 'interrupted'].includes(run.phase))
  if (active) {
    await workbenchRequest(base, cwd, 'stop', { id: active.id })
    return { ok: true, title: '停止游戏', message: '已停止当前项目运行。完整日志保留在游戏测试页。' }
  }
  await workbenchRequest(base, cwd, 'start', { action: 'client' })
  return { ok: true, title: '启动游戏', message: '正在执行项目运行任务。请在游戏测试页查看实时日志。' }
}

/** Build and export through the same workbench owner used by the test page. */
export async function exportWorkbenchMod(base: string, cwd: string): Promise<DesktopCommandResult> {
  const started = await workbenchRequest<WorkbenchRun>(base, cwd, 'start', { action: 'build', mode: 'artifact' })
  const deadline = Date.now() + 30 * 60 * 1000
  while (Date.now() < deadline) {
    const runs = await workbenchRequest<WorkbenchRun[]>(base, cwd, 'runs')
    const run = runs.find(row => row.id === started.id)
    if (!run) throw new Error('导出构建记录丢失。')
    if (['failed', 'cancelled', 'interrupted'].includes(run.phase)) throw new Error(run.message)
    if (run.phase === 'exited') {
      const exported = await workbenchRequest<{ path: string; artifacts: string[] }>(base, cwd, 'export')
      return { ok: true, title: '导出模组', message: '构建与产物验收通过；运行证据见验收记录。', ...exported }
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  await workbenchRequest(base, cwd, 'stop', { id: started.id })
  throw new Error('导出构建超时；日志保留在游戏测试页。')
}
