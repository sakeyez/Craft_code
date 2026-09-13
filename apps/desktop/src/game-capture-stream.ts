import { isGameCaptureSnapshot } from './preload-validation.ts'
import { BrowserWindow, desktopCapturer, session, type DesktopCapturerSource } from 'electron'
import { fileURLToPath } from 'node:url'
import type { GameCaptureSnapshot } from './game-capture.ts'
import { DESKTOP_WEB_PREFERENCES } from './window.ts'

/** One prewarmed, silent window stream. Only requested stills cross into main. */
export class GameCaptureStream {
  #retryAt = 0
  #current: { hwnd: bigint; window: BrowserWindow; ready: Promise<void> } | undefined

  constructor(private readonly log: (line: string) => void = () => {}) {}

  /** Reuse the owned HWND stream; stale initialization cannot authorize another window. */
  warm(hwnd: bigint): void {
    if (this.#current?.hwnd === hwnd || Date.now() < this.#retryAt) return
    this.stop()
    const captureSession = session.fromPartition('craftcode-game-capture')
    const window = new BrowserWindow({ show: false, width: 1, height: 1, skipTaskbar: true,
      webPreferences: { ...DESKTOP_WEB_PREFERENCES, session: captureSession, backgroundThrottling: false } })
    let source: DesktopCapturerSource | undefined
    captureSession.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === 'media')
    captureSession.setPermissionRequestHandler((contents, permission, callback) => { callback(contents === window.webContents && permission === 'media') })
    captureSession.setDisplayMediaRequestHandler((request, callback) => {
      callback(this.#current?.window === window && request.frame === window.webContents.mainFrame && source ? { video: source } : {})
    })
    window.webContents.on('console-message', ({ message }) => {
      if (message.startsWith('annotation timing ')) this.log(message)
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => { event.preventDefault() })
    window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
    window.webContents.once('render-process-gone', () => { if (this.#current?.window === window) this.stop() })
    const current = { hwnd, window, ready: Promise.resolve() }
    this.#current = current
    current.ready = (async () => {
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      if (this.#current !== current) return
      source = sources.find(candidate => candidate.id.split(':')[1] === String(hwnd))
      if (!source) throw new Error('游戏捕获源不可用')
      await window.loadFile(fileURLToPath(new URL('./capture.html', import.meta.url)))
      if (this.#current !== current) return
      await window.webContents.executeJavaScript('window.startCapture()', true)
      this.log('annotation stream ready')
    })()
    void current.ready.catch((error: unknown) => {
      this.log(`annotation stream unavailable: ${String(error)}`)
      if (this.#current === current) { this.#retryAt = Date.now() + 5000; this.stop() }
    })
  }

  /** Requires a frame presented after this request; times out into the caller's fallback. */
  async capture(hwnd: bigint, crop: { x: number; y: number; width: number; height: number }): Promise<GameCaptureSnapshot> {
    const current = this.#current
    if (!current || current.hwnd !== hwnd) throw new Error('游戏捕获通道未预热')
    // A cold stream must not delay the thumbnail fallback indefinitely.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        (async () => {
          await current.ready
          if (this.#current !== current) throw new Error('游戏捕获通道已变化')
          const result: unknown = await current.window.webContents.executeJavaScript(`window.captureFrame(${JSON.stringify(crop)})`)
          if (this.#current !== current || !isGameCaptureSnapshot(result)) throw new Error('游戏捕获帧无效')
          return result
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new Error('游戏捕获帧等待超时')) }, 750) }),
      ])
    } finally { clearTimeout(timer) }
  }

  /** Destroying the private renderer stops all tracks and drops retained pixels. */
  stop(): void {
    const current = this.#current
    this.#current = undefined
    if (current && !current.window.isDestroyed()) current.window.destroy()
  }
}
