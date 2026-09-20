import { afterEach, expect, it, vi } from 'vitest'
import { toggleWorkbenchGame, workbenchRequest } from '../src/workbench-client.ts'

afterEach(() => { vi.unstubAllGlobals() })

it('rejects malformed native process identities before they reach window capture', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, request: { body: string }) => {
    const body = JSON.parse(request.body) as { rpcId: string }
    return Response.json({ rpcId: body.rpcId, result: { ok: true, value: { id: 'wrong-id', pid: -1 } } })
  }))
  await expect(workbenchRequest('http://localhost:1234', 'C:/project', 'native-state')).rejects.toThrow()
})

it('starts a host-owned client when the project has no active operation', async () => {
  const requests: { method: string; payload: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, request: { body: string }) => {
    const body = JSON.parse(request.body) as { rpcId: string; method: string; payload: Record<string, unknown> }
    requests.push(body)
    const id = 'fb920799-f27e-44ae-9455-7a3c6dded035'
    return Response.json({ rpcId: body.rpcId, result: { ok: true, value: body.method === 'runs' ? [] : {
      id, cwd: 'C:/project', action: 'client', phase: 'preparing', message: 'preparing',
      startedAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z', logPath: `.dsh/runs/${id}/output.log`,
    } } })
  }))
  expect((await toggleWorkbenchGame('http://localhost:1234', 'C:/project')).ok).toBe(true)
  expect(requests.map(request => request.method)).toEqual(['runs', 'start'])
  expect(requests[1]?.payload).toEqual({ cwd: 'C:/project', action: 'client' })
})
