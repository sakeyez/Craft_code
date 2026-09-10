import { EventEmitter } from 'node:events'
import type { BrowserWindow, Rectangle } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowsGameCaptureProvider, type NativeRect, type Win32Bindings } from '../src/game-capture-win32.ts'
import type { GameCaptureEvent } from '../src/game-capture.ts'

const display = vi.hoisted(() => ({
  scale: 1,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  workArea: { x: 0, y: 0, width: 1536, height: 832 },
}))
vi.mock('electron', () => ({
  desktopCapturer: {},
  screen: {
    getDisplayMatching: () => display,
    screenToDipRect: (_window: unknown, rect: Rectangle) =>
      Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / display.scale])),
    dipToScreenRect: (_window: unknown, rect: Rectangle) =>
      Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * display.scale)])),
  },
}))

class TestWindow extends EventEmitter {
  bounds = { x: 100, y: 100, width: 900, height: 640 }
  minimumSize: [number, number] = [900, 640]
  visible = true
  maximized = false
  throttling = true
  topmost = false
  webContents = {
    getBackgroundThrottling: () => this.throttling,
    setBackgroundThrottling: (value: boolean) => { this.throttling = value },
  }
  getBounds() { return { ...this.bounds } }
  getNormalBounds() { return { x: 100, y: 100, width: 900, height: 640 } }
  setBounds(bounds: Partial<Rectangle>) { this.bounds = { ...this.bounds, ...bounds } }
  isDestroyed() { return false }
  getMinimumSize() { return this.minimumSize }
  setMinimumSize(width: number, height: number) { this.minimumSize = [width, height] }
  isMaximized() { return this.maximized }
  maximize() { this.maximized = true; this.emit('maximize') }
  unmaximize() { this.maximized = false; this.emit('unmaximize') }
  isMinimized() { return false }
  isAlwaysOnTop() { return this.topmost }
  setAlwaysOnTop(value: boolean) { this.topmost = value }
  isVisible() { return this.visible }
  hide() { this.visible = false; this.emit('hide') }
  showInactive() { this.visible = true; this.emit('show') }
}

function fixture() {
  const window = new TestWindow()
  const game = { rect: { left: 100, top: 100, right: 900, bottom: 700 }, minimized: false, maximized: false, caption: true, pid: 10, identity: 'created-10', valid: true }
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
    hasCaption: () => game.caption,
    isWindowMaximized: () => game.maximized,
    restoreWindow: vi.fn(() => { game.maximized = false; return true }),
    positionWindow: vi.fn((_hwnd: bigint, rect: NativeRect) => { game.rect = { ...rect }; return true }),
  } satisfies Win32Bindings
  const events: GameCaptureEvent[] = []
  const log = vi.fn()
  const provider = new WindowsGameCaptureProvider({
    window: window as unknown as BrowserWindow, publish: event => events.push(event), log,
  }, bindings)
  return { window, game, bindings, events, log, provider }
}

describe('game companion lifecycle', () => {
  let test: ReturnType<typeof fixture>
  beforeEach(() => { vi.useFakeTimers(); display.scale = 1; display.workArea.width = 1536; test = fixture() })
  afterEach(async () => { await test.provider.dispose(); vi.useRealTimers() })
  async function connect() {
    await test.provider.select('project')
    await test.provider.start('project', 10)
    await vi.advanceTimersByTimeAsync(500)
  }

  it.each([1, 1.25, 1.5, 2])('arranges once with stable observations at scale %s', async (scale) => {
    display.scale = scale
    await test.provider.select('project')
    await test.provider.start('project', 10)
    await vi.advanceTimersByTimeAsync(0)
    expect(test.bindings.positionWindow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
    expect(test.window.bounds.x).toBeCloseTo(1135, 0)
    expect(test.window.bounds).toMatchObject({ y: 8, width: 393, height: 816 })
    expect(test.game.rect.left).toBe(8 * scale)
    expect(test.window.throttling).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
  })

  it('follows game movement with a manually resized panel, then pauses until repositioned', async () => {
    await connect()
    test.window.bounds.width = 380
    test.game.rect.left += 20; test.game.rect.right += 20
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.bounds).toMatchObject({ x: 1155, width: 380 })
    const last = test.window.getBounds()
    test.game.rect.right += 400
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.getBounds()).toEqual(last)
    expect(test.window.topmost).toBe(false)
    test.game.rect.right -= 410
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.getBounds()).toEqual(last)
    await test.provider.reposition('project')
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(2)
    expect(test.window.bounds.width).toBe(393)
  })

  it('does not resize the game on selection, reconnect, or minimize/restore', async () => {
    await connect()
    test.game.minimized = true
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.visible).toBe(false)
    test.game.minimized = false
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.visible).toBe(true)
    await test.provider.select(undefined)
    await test.provider.select('project')
    await test.provider.reconnect('project')
    await vi.advanceTimersByTimeAsync(500)
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
  })

  it('waits for selection and for fullscreen to return to ordinary window mode', async () => {
    test.game.caption = false
    test.game.rect = { left: 0, top: 0, right: 1536, bottom: 864 }
    await test.provider.start('project', 10)
    await vi.advanceTimersByTimeAsync(500)
    await test.provider.select('project')
    await vi.advanceTimersByTimeAsync(500)
    expect(test.bindings.positionWindow).not.toHaveBeenCalled()
    test.game.caption = true
    test.game.maximized = true
    await vi.advanceTimersByTimeAsync(500)
    expect(test.bindings.restoreWindow).toHaveBeenCalledTimes(1)
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
  })

  it.each(['pid', 'identity', 'valid'] as const)('rejects a stale window when %s changes', async (field) => {
    await connect()
    if (field === 'pid') test.game.pid = 20
    else if (field === 'identity') test.game.identity = 'reused'
    else test.game.valid = false
    await expect(test.provider.reposition('project')).rejects.toThrow('游戏窗口已变化')
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled native resize and does not keep retrying it', async () => {
    vi.mocked(test.bindings.positionWindow).mockImplementation(() => true)
    await connect()
    await vi.advanceTimersByTimeAsync(3000)
    expect(test.log).toHaveBeenCalledWith(expect.stringContaining('超时'))
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
    expect(test.window.throttling).toBe(true)
  })

  it('cancels an in-flight layout after switching projects', async () => {
    vi.mocked(test.bindings.positionWindow).mockImplementation(() => true)
    await connect()
    await test.provider.select(undefined)
    await vi.advanceTimersByTimeAsync(500)
    expect(test.window.bounds.width).toBe(900)
    expect(test.window.throttling).toBe(true)
  })

  it('restores saved window settings after the game exits while minimized', async () => {
    test.window.maximized = true
    test.window.throttling = false
    test.window.topmost = true
    await connect()
    test.game.minimized = true
    await vi.advanceTimersByTimeAsync(250)
    await test.provider.stop('project')
    expect(test.window.visible).toBe(true)
    expect(test.window.maximized).toBe(true)
    expect(test.window.throttling).toBe(false)
    expect(test.window.topmost).toBe(true)
    expect(test.window.minimumSize).toEqual([900, 640])
    expect(test.window.bounds).toEqual({ x: 100, y: 100, width: 900, height: 640 })
  })

  it('keeps an independent host visible when the work area cannot fit a companion', async () => {
    display.workArea.width = 800
    await connect()
    expect(test.bindings.positionWindow).not.toHaveBeenCalled()
    test.game.minimized = true
    await vi.advanceTimersByTimeAsync(250)
    expect(test.window.visible).toBe(true)
    await test.provider.stop('project')
    expect(test.window.visible).toBe(true)
    expect(test.window.throttling).toBe(true)
  })

  it('does not accumulate rounded panel widths when returning to the project', async () => {
    vi.spyOn(test.window, 'setBounds').mockImplementation((bounds) => {
      test.window.bounds = { ...test.window.bounds, ...bounds }
      if (bounds.width !== undefined) test.window.bounds.width = bounds.width + 1
    })
    await connect()
    for (let index = 0; index < 4; index++) {
      await test.provider.select(undefined)
      await test.provider.select('project')
      expect(test.window.bounds.width).toBe(394)
    }
    expect(test.bindings.positionWindow).toHaveBeenCalledTimes(1)
  })
})
