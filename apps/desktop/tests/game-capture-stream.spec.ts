import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameCaptureStream } from '../src/game-capture-stream.ts'

const fixture = vi.hoisted(() => ({ getSources: vi.fn(), execute: vi.fn(), destroy: vi.fn(), windows: [] as EventEmitter[] }))
vi.mock('electron', () => ({
  desktopCapturer: { getSources: fixture.getSources },
  session: { fromPartition: () => ({
    setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn(),
  }) },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, setWindowOpenHandler: vi.fn(), executeJavaScript: fixture.execute })
    constructor() { super(); fixture.windows.push(this) }
    loadFile = async (): Promise<void> => {}
    isDestroyed = (): boolean => false
    destroy = fixture.destroy
  },
}))
const frame = { dataUrl: 'data:image/jpeg;base64,AA==', width: 800, height: 600 }
const crop = { x: 0, y: 0, width: 1, height: 1 }
const tick = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }

describe('prewarmed window stream', () => {
  let stream: GameCaptureStream | undefined
  afterEach(() => { stream?.stop(); fixture.windows.length = 0; vi.resetAllMocks(); vi.useRealTimers() })
  function start(): GameCaptureStream {
    fixture.getSources.mockResolvedValue([{ id: 'window:12:0' }])
    fixture.execute.mockImplementation(async (code: string) => code === 'window.startCapture()' ? undefined : frame)
    stream = new GameCaptureStream()
    stream.warm(12n)
    return stream
  }

  it('enumerates without thumbnails once and only encodes requested frames', async () => {
    const capture = start()
    await tick()
    capture.warm(12n)
    expect(fixture.getSources).toHaveBeenCalledTimes(1)
    expect(fixture.getSources).toHaveBeenCalledWith({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    expect(await capture.capture(12n, crop)).toEqual(frame)
    expect(fixture.execute).toHaveBeenCalledTimes(2)
  })

  it('rejects a frame completing after its window was released', async () => {
    const capture = start()
    await tick()
    let finish: (value: unknown) => void = () => {}
    fixture.execute.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const result = capture.capture(12n, crop)
    await tick()
    capture.stop()
    finish(frame)
    await expect(result).rejects.toThrow('无效')
    expect(fixture.destroy).toHaveBeenCalledOnce()
  })

  it('bounds frame waits and refuses oversized renderer results', async () => {
    vi.useFakeTimers()
    const capture = start()
    await tick()
    fixture.execute.mockResolvedValue({ ...frame, width: 1921 })
    await expect(capture.capture(12n, crop)).rejects.toThrow('无效')
    fixture.execute.mockImplementation(() => new Promise(() => {}))
    const pending = expect(capture.capture(12n, crop)).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(751)
    await pending
  })

  it('contains unavailable sources and retries after its cooldown', async () => {
    vi.useFakeTimers()
    const capture = start()
    fixture.getSources.mockResolvedValue([])
    capture.warm(13n)
    await tick()
    const count = fixture.getSources.mock.calls.length
    capture.warm(13n)
    expect(fixture.getSources).toHaveBeenCalledTimes(count)
    await vi.advanceTimersByTimeAsync(5001)
    capture.warm(13n)
    expect(fixture.getSources).toHaveBeenCalledTimes(count + 1)
    await tick()
  })
})
