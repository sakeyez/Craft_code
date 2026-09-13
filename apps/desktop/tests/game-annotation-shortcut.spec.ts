import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { GameCaptureProvider } from '../src/game-capture.ts'
import type { GameAnnotationController } from '../src/game-annotation.ts'
import { GameAnnotationShortcut } from '../src/game-annotation-shortcut.ts'

const native = vi.hoisted(() => ({ register: vi.fn(), unregister: vi.fn() }))
vi.mock('electron', () => ({ globalShortcut: native }))
const request = { cwd: 'C:\\game', sessionId: 'session', labels: [], operationId: 'token' }

describe('native annotation shortcut', () => {
  let shortcut: GameAnnotationShortcut | undefined
  afterEach(() => { shortcut?.dispose(); vi.useRealTimers(); vi.resetAllMocks() })
  function setup() {
    vi.useFakeTimers()
    native.register.mockReturnValue(true)
    const owner = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false })
    const provider = { annotationTarget: vi.fn(async () => ({ bounds: {}, valid: () => true })),
      annotationShortcutHeld: vi.fn(async () => false), isAnnotationForeground: vi.fn(async () => true) }
    const annotation = { warm: vi.fn(async () => {}), release: vi.fn() }
    const selected = vi.fn(() => request.cwd)
    shortcut = new GameAnnotationShortcut(owner as unknown as WebContents, provider as unknown as GameCaptureProvider,
      annotation as unknown as GameAnnotationController, selected)
    shortcut.bind(request)
    return { owner, provider, annotation, selected }
  }

  it('dispatches in game focus, ignores repeated holds and unrelated foreground windows', async () => {
    const { owner, provider } = setup()
    await vi.advanceTimersByTimeAsync(250)
    expect(native.register).toHaveBeenCalledWith('Control+Shift+P', expect.any(Function))
    const trigger = native.register.mock.calls[0]![1] as () => void
    provider.annotationShortcutHeld.mockResolvedValue(true)
    trigger(); trigger()
    await vi.advanceTimersByTimeAsync(500)
    trigger()
    expect(owner.send).toHaveBeenCalledTimes(1)
    provider.annotationShortcutHeld.mockResolvedValue(false)
    provider.isAnnotationForeground.mockResolvedValue(false)
    await vi.advanceTimersByTimeAsync(250)
    trigger()
    await vi.advanceTimersByTimeAsync(0)
    expect(owner.send).toHaveBeenCalledTimes(1)
  })

  it('reports registration conflicts once and leaves the button path available', async () => {
    const { owner } = setup()
    native.register.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(native.register).toHaveBeenCalledTimes(1)
    expect(owner.send).toHaveBeenCalledWith('desktop:annotation-shortcut', { operationId: 'token', error: '快捷键被占用，请使用“在游戏上标注”按钮。' })
  })

  it('unregisters on disconnect and prevents stale cleanup from clearing a new binding', async () => {
    const { provider } = setup()
    await vi.advanceTimersByTimeAsync(250)
    shortcut!.bind({ ...request, operationId: 'new' })
    shortcut!.bind(undefined, 'token')
    await vi.advanceTimersByTimeAsync(250)
    expect(native.register).toHaveBeenCalledTimes(2)
    provider.annotationTarget.mockRejectedValue(new Error('disconnected'))
    await vi.advanceTimersByTimeAsync(250)
    expect(native.unregister).toHaveBeenCalledTimes(2)
  })

  it('drops a pending registration after the selected project changes', async () => {
    const { selected } = setup()
    selected.mockReturnValue('C:\\other')
    await vi.advanceTimersByTimeAsync(500)
    expect(native.register).not.toHaveBeenCalled()
  })
})
