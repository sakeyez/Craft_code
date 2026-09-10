import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { GameAnnotationController, type AnnotationTarget } from '../src/game-annotation.ts'
import { isAnnotationDrafts, isAnnotationRequest } from '../src/game-annotation-contract.ts'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown
interface MockWebContents extends EventEmitter {
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => void
}
interface MockWindow extends EventEmitter {
  destroyed: boolean
  readonly options: unknown
  readonly webContents: MockWebContents
  loadFile: () => Promise<void>
  show: () => void
  focus: () => void
  isDestroyed: () => boolean
  destroy: () => void
}

const fixture = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), windows: [] as MockWindow[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    ipcMain: {
      handle: (name: string, callback: Handler) => fixture.handlers.set(name, callback),
      removeHandler: (name: string) => fixture.handlers.delete(name),
    },
    BrowserWindow: class extends EventEmitter {
      destroyed = false
      webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() }) as MockWebContents
      constructor(readonly options: unknown) { super(); fixture.windows.push(this) }
      loadFile = vi.fn(async (): Promise<void> => {})
      show = vi.fn((): void => {})
      focus = vi.fn((): void => {})
      isDestroyed(): boolean { return this.destroyed }
      destroy(): void { this.destroyed = true; this.emit('closed') }
    },
  }
})

const request = { operationId: '11111111-1111-4111-8111-111111111111', cwd: 'C:\\game', sessionId: 'session', labels: [] }
const draft = { id: '22222222-2222-4222-8222-222222222222', label: 'A', createdAt: 1, description: 'Change this block', shape: { type: 'point' as const, geometry: { x: .5, y: .6 } } }
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('annotation transaction', () => {
  let owner: EventEmitter & { send: (channel: string, payload: unknown) => void }
  let controller: GameAnnotationController
  let target: AnnotationTarget
  const invoke = (channel: string, sender: unknown, ...args: unknown[]) => {
    const handler = fixture.handlers.get(channel)
    if (handler === undefined) throw new Error(`missing handler: ${channel}`)
    return handler({ sender }, ...args)
  }
  beforeEach(() => {
    vi.useFakeTimers(); fixture.windows.length = 0
    owner = Object.assign(new EventEmitter(), { send: vi.fn() })
    controller = new GameAnnotationController(owner as unknown as WebContents)
    target = { bounds: { x: -800, y: 30, width: 800, height: 600 }, valid: vi.fn(() => true), focus: vi.fn(), capture: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,AA==', width: 800, height: 600 })) }
  })
  afterEach(() => { controller.dispose(); vi.useRealTimers() })

  it('shows only after image readiness, retries failed saves, and restores focus after acknowledgement', async () => {
    const done = controller.begin(request, async () => target)
    await tick()
    const window = fixture.windows[0]!
    expect(window.options).toMatchObject({
      ...target.bounds,
      show: false,
      frame: false,
      webPreferences: { sandbox: true, nodeIntegration: false },
    })
    expect(window.show).not.toHaveBeenCalled()
    invoke('annotation:ready', window.webContents)
    expect(window.show).toHaveBeenCalledOnce()
    const first = invoke('annotation:submit', window.webContents, [draft])
    expect(owner.send).toHaveBeenLastCalledWith('desktop:game-annotation-commit', {
      ...request, attempt: 1, drafts: [draft], snapshot: { dataUrl: 'data:image/jpeg;base64,AA==', width: 800, height: 600 },
    })
    await expect(invoke('annotation:submit', window.webContents, [draft])).rejects.toThrow('正在保存')
    invoke('desktop:game-annotation-result', owner, request.operationId, 99, undefined)
    expect(window.destroyed).toBe(false)
    invoke('desktop:game-annotation-result', owner, request.operationId, 1, 'save refused')
    expect(await first).toEqual({ error: 'save refused' })
    expect(window.destroyed).toBe(false)
    const retry = invoke('annotation:submit', window.webContents, [draft])
    invoke('desktop:game-annotation-result', owner, request.operationId, 2, undefined)
    await retry; await done
    expect(window.destroyed).toBe(true)
    expect(target.focus).toHaveBeenCalledOnce()
  })

  it('cancels a delayed capture without showing its preloaded window or closing a newer operation', async () => {
    let resolveCapture: (value: Awaited<ReturnType<AnnotationTarget['capture']>>) => void = () => {
      throw new Error('capture resolver not initialized')
    }
    target.capture = () => new Promise((resolve) => { resolveCapture = resolve })
    const done = controller.begin(request, async () => target)
    await tick()
    await expect(controller.begin(request, async () => target)).rejects.toThrow('已有标注')
    controller.cancel(request.operationId)
    await done
    resolveCapture({ dataUrl: 'data:image/jpeg;base64,AA==', width: 800, height: 600 })
    await tick()
    expect(fixture.windows).toHaveLength(1)
    expect(fixture.windows[0]?.destroyed).toBe(true)
    expect(fixture.windows[0]?.show).not.toHaveBeenCalled()
    expect(target.focus).not.toHaveBeenCalled()
  })

  it.each(['navigation', 'crash', 'geometry', 'timeout'])('cleans up on %s without stealing focus', async (cause) => {
    const done = controller.begin(request, async () => target).catch((error: unknown) => error)
    await tick()
    const window = fixture.windows[0]!
    if (cause === 'navigation') owner.emit('did-start-navigation', {}, 'http://localhost', false, true)
    if (cause === 'crash') window.webContents.emit('render-process-gone')
    if (cause === 'geometry') { target.valid = () => false; await vi.advanceTimersByTimeAsync(100) }
    if (cause === 'timeout') await vi.advanceTimersByTimeAsync(15100)
    await done
    expect(window.destroyed).toBe(true)
    expect(target.focus).not.toHaveBeenCalled()
  })

  it('rejects foreign senders and malformed drafts; stale cancellation does not close the window', async () => {
    const done = controller.begin(request, async () => target)
    await tick()
    const window = fixture.windows[0]!
    expect(() => invoke('annotation:load', owner)).toThrow('无效')
    expect(() => invoke('desktop:game-annotation-result', {}, request.operationId, 1)).toThrow('无效')
    invoke('annotation:ready', window.webContents)
    await expect(invoke('annotation:submit', window.webContents, [{ ...draft, shape: { type: 'point', geometry: { x: NaN, y: 0 } } }])).rejects.toThrow('数据无效')
    controller.cancel('old')
    expect(window.destroyed).toBe(false)
    invoke('annotation:cancel', window.webContents)
    await done
    expect(target.focus).toHaveBeenCalledOnce()
  })

  it('settles an in-flight save after cancellation without applying its reply to another transaction', async () => {
    const done = controller.begin(request, async () => target)
    await tick()
    const window = fixture.windows[0]!
    invoke('annotation:ready', window.webContents)
    const save = invoke('annotation:submit', window.webContents, [draft])
    controller.cancel()
    await done; await save
    invoke('desktop:game-annotation-result', owner, request.operationId, 1, undefined)
    expect(target.focus).not.toHaveBeenCalled()
  })
})

describe('annotation wire validation', () => {
  it('bounds requests and geometry, including total counts and duplicate identities', () => {
    expect(isAnnotationRequest(request)).toBe(true)
    expect(isAnnotationRequest({ ...request, operationId: 'wrong' })).toBe(false)
    expect(isAnnotationRequest({ ...request, hwnd: 123 })).toBe(false)
    expect(isAnnotationDrafts([draft])).toBe(true)
    expect(isAnnotationDrafts([draft, draft])).toBe(false)
    expect(isAnnotationDrafts([{ ...draft, description: '' }])).toBe(false)
    expect(isAnnotationDrafts([{ ...draft, shape: { type: 'rect', geometry: { x: .9, y: 0, width: .2, height: .1 } } }])).toBe(false)
    expect(isAnnotationDrafts(Array(101).fill(draft))).toBe(false)
  })
})
