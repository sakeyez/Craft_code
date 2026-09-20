import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { fabricEntry, neoForgeEntry } from '@deepseek-ai/dsh-tool-mc-bootstrap/src/catalog.ts'
import type { CatalogSnapshot, OperationSnapshot } from '@deepseek-ai/dsh-tool-mc-bootstrap/src/types'
import { BootstrapWizardModel } from '../src/client/model.ts'

const entry = fabricEntry('1.21.1', '0.16.5', 'intermediary', '1.21.1+build.3', '0.102.0+1.21.1')
const catalog: CatalogSnapshot = {
  entries: [entry], cached: false, stale: false,
  java: { available: true, version: 21, executable: 'java' },
}

function status(
  state: OperationSnapshot['status'],
  projectPath?: string,
): OperationSnapshot {
  return {
    operationId: 'operation-1', status: state,
    stage: state === 'ready' ? 'done' : 'build',
    progress: state === 'ready' ? 100 : 62,
    logTail: '', updatedAt: '2026-09-15T00:00:00.000Z',
    ...(projectPath === undefined ? {} : { projectPath }),
  }
}

function setup() {
  let statusCalls = 0
  const call = vi.fn(async (_channel: string, endpoint: string) => {
    if (endpoint === 'catalog') return { ok: true as const, value: catalog }
    if (endpoint === 'start') return { ok: true as const, value: { operationId: 'operation-1' } }
    if (endpoint === 'status') {
      statusCalls += 1
      return {
        ok: true as const,
        value: status(statusCalls === 1 ? 'running' : 'ready', '/tmp/copper-tools'),
      }
    }
    return { ok: true as const, value: { cancelled: false } }
  })
  const rpc = { call } as unknown as ClientConnectionRpc
  const create = vi.fn(async () => ({
    workspaceId: 'workspace-1' as never,
    path: '/tmp/copper-tools', title: 'Copper Tools',
    sessionIds: [], createdAt: '0', updatedAt: '0',
  }))
  const startSession = vi.fn()
  const workspaces = { create, startSession } as unknown as IWorkspaces
  const model = new BootstrapWizardModel(rpc, workspaces, '/tmp')
  return { model, call, create, startSession }
}

async function openAndFill(model: BootstrapWizardModel): Promise<void> {
  model.open()
  await vi.waitFor(() => {
    expect(model.getSnapshot().catalog?.entries).toHaveLength(1)
  })
  model.setModName('Copper Tools')
  model.setParentDirectory('/tmp')
}

describe('BootstrapWizardModel build/session ordering', () => {
  it('allows cached selection during refresh and preserves a compatible version across loaders', async () => {
    const newer = fabricEntry('1.21.4', '0.16.5', 'intermediary', '1.21.4+build.1', '0.119.0+1.21.4')
    const neo = neoForgeEntry('1.21.1', '21.1.1')
    let finish!: (value: unknown) => void
    const pending = new Promise(resolve => { finish = resolve })
    const rpc = { call: async (_channel: string, endpoint: string) => endpoint === 'catalog-cache'
      ? { ok: true, value: { ...catalog, cached: true, entries: [newer, entry, neo] } }
      : pending } as unknown as ClientConnectionRpc
    const model = new BootstrapWizardModel(rpc, {} as IWorkspaces, '/tmp')
    model.open()
    await vi.waitFor(() => { expect(model.getSnapshot().catalog?.cached).toBe(true) })
    expect(model.getSnapshot().loadingCatalog).toBe(true)
    expect(model.getSnapshot().form.entryId).toBe(newer.entryId)
    model.setEntry(entry.entryId)
    model.setLoader('neoforge')
    expect(model.getSnapshot().form.entryId).toBe(neo.entryId)
    model.setLoader('fabric')
    expect(model.getSnapshot().form.entryId).toBe(entry.entryId)
    finish({ ok: true, value: { ...catalog, entries: [newer, entry, neo] } })
    await vi.waitFor(() => { expect(model.getSnapshot().loadingCatalog).toBe(false) })
    expect(model.getSnapshot().form.entryId).toBe(entry.entryId)
    model.dispose()
  })
  it('does not register a workspace or start a session until the host reports ready', async () => {
    const { model, create, startSession } = setup()
    await openAndFill(model)
    await model.start()
    await vi.waitFor(() => {
      expect(model.getSnapshot().status?.status).toBe('running')
    })
    expect(create).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()

    model.acceptProgress(status('ready', '/tmp/copper-tools'))
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledWith({ path: '/tmp/copper-tools' })
      expect(startSession).toHaveBeenCalledWith('workspace-1')
    })
    model.dispose()
  })

  it('keeps failed builds in the wizard without creating a workspace or session', async () => {
    const { model, create, startSession } = setup()
    await openAndFill(model)
    await model.start()
    model.acceptProgress({ ...status('failed'), failureCode: 'build-failed', message: 'compile failed' })
    await vi.waitFor(() => {
      expect(model.getSnapshot().status?.status).toBe('failed')
    })
    expect(create).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(model.getSnapshot().status?.failureCode).toBe('build-failed')
    model.dispose()
  })

  it('ignores progress for operations that this wizard did not start', async () => {
    const { model, create, startSession } = setup()
    await openAndFill(model)
    model.acceptProgress({ ...status('ready', '/tmp/unrelated'), operationId: 'another-operation' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(create).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(model.getSnapshot().operationId).toBeUndefined()
    model.dispose()
  })

  it('retries only workspace registration after a successful build', async () => {
    const { model, call, create, startSession } = setup()
    create.mockRejectedValueOnce(new Error('registry unavailable'))
    await openAndFill(model)
    await model.start()
    model.acceptProgress(status('ready', '/tmp/copper-tools'))
    await vi.waitFor(() => {
      expect(model.getSnapshot().registrationError).toBe('registry unavailable')
    })
    await model.retry()
    expect(create).toHaveBeenCalledTimes(2)
    expect(startSession).toHaveBeenCalledWith('workspace-1')
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'start')).toHaveLength(1)
    model.dispose()
  })

  it('blocks a reserved Java package name before the host start RPC', async () => {
    const { model, call } = setup()
    await openAndFill(model)
    model.setPackageName('com.example.class')
    await model.start()
    expect(model.getSnapshot().error).toContain('Java 包名')
    expect(call).not.toHaveBeenCalledWith('/mc-bootstrap', 'start', expect.any(Object))
    model.dispose()
  })
})
