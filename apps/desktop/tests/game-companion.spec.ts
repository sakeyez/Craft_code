import { EventEmitter } from 'node:events'
import type { BrowserWindow, Rectangle } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowsGameCaptureProvider, type Win32Bindings } from '../src/game-capture-win32.ts'
import type { GameCaptureEvent } from '../src/game-capture.ts'

const display = vi.hoisted(() => ({ scale: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 } }))
vi.mock('electron', () => ({
  desktopCapturer: {},
  screen: {
    getDisplayMatching: () => display,
    screenToDipRect: (_window: unknown, rect: Rectangle) => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / display.scale])),
  },
}))

class TestWindow extends EventEmitter {
  bounds = { x: 100, y: 100, width: 900, height: 640 }
  visible = true
  throttling = true
  focused = true
  webContents = { getBackgroundThrottling: () => this.throttling, setBackgroundThrottling: (value: boolean) => { this.throttling = value } }
  getBounds() { return { ...this.bounds } }
  isDestroyed() { return false }
  isFocused() { return this.focused }
}

function fixture() {
  const window = new TestWindow()
  const game = { rect: { left: 100, top: 100, right: 900, bottom: 700 }, minimized: false, pid: 10, identity: 'created-10', valid: true }
  const bindings = {
    processSnapshot: () => [{ pid: 10, parentPid: 1 }],
    processIdentity: () => game.identity,
    enumerateWindows: () => [{ hwnd: 1n, pid: 10, className: 'GLFW30', title: 'Minecraft', width: 800, height: 600 }],
    isWindow: () => game.valid,
    getWindowRect: () => ({ ...game.rect }),
    getClientRect: () => ({ ...game.rect }),
    focusWindow: vi.fn(),
    isWindowVisible: () => true,
    isWindowMinimized: () => game.minimized,
    windowPid: () => game.pid,
    hasCaption: () => true,
  } satisfies Win32Bindings
  const events: GameCaptureEvent[] = []
  const provider = new WindowsGameCaptureProvider({ window: window as unknown as BrowserWindow, publish: event => events.push(event) }, bindings)
  return { window, game, events, provider }
}

describe('independent game capture lifecycle', () => {
  let test: ReturnType<typeof fixture>
  beforeEach(() => { vi.useFakeTimers(); test = fixture() })
  afterEach(async () => { await test.provider.dispose(); vi.useRealTimers() })

  async function connect() {
    await test.provider.select('project')
    await test.provider.start('project', 10)
    await vi.advanceTimersByTimeAsync(500)
  }

  it('discovers Minecraft without moving or reconfiguring CraftCode', async () => {
    const original = test.window.getBounds()
    await connect()
    expect(test.events.at(-1)?.state.status).toBe('connected')
    expect(test.window.getBounds()).toEqual(original)
    expect(test.window.visible).toBe(true)
    expect(test.window.throttling).toBe(true)
  })

  it('keeps CraftCode visible and unchanged when the game moves or minimizes', async () => {
    await connect()
    const original = test.window.getBounds()
    test.game.rect.left += 20; test.game.rect.right += 20
    await vi.advanceTimersByTimeAsync(250)
    test.game.minimized = true
    await vi.advanceTimersByTimeAsync(250)
    test.game.minimized = false
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.getBounds()).toEqual(original)
    expect(test.window.visible).toBe(true)
    expect(test.window.throttling).toBe(true)
  })

  it('does not change host geometry across selection and stop', async () => {
    await connect()
    const original = test.window.getBounds()
    await test.provider.select(undefined)
    await test.provider.select('project')
    await test.provider.stop('project')
    expect(test.window.getBounds()).toEqual(original)
    expect(test.window.visible).toBe(true)
    expect(test.window.throttling).toBe(true)
  })

  it.each(['pid', 'identity', 'valid'] as const)('rejects a stale window during annotation when %s changes', async (field) => {
    await connect()
    if (field === 'pid') test.game.pid = 20
    else if (field === 'identity') test.game.identity = 'reused'
    else test.game.valid = false
    await expect(test.provider.annotationTarget('project')).rejects.toThrow()
  })
})
