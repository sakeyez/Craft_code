import { BrowserWindow, ipcMain, type Rectangle, type WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
import { isAnnotationDrafts, type AnnotationRequest } from './game-annotation-contract.ts'
import type { GameCaptureSnapshot } from './game-capture.ts'
import { DESKTOP_WEB_PREFERENCES } from './window.ts'

/** Main-process-only capture and ownership capabilities for a fixed game rectangle. */
export interface AnnotationTarget {
  bounds: Rectangle
  capture: () => Promise<GameCaptureSnapshot>
  valid: () => boolean
  focus: () => void
}

interface Transaction {
  request: AnnotationRequest
  target?: AnnotationTarget
  window?: BrowserWindow
  close: (error?: Error) => void
  snapshot?: GameCaptureSnapshot
  snapshotPromise?: Promise<GameCaptureSnapshot>
  saving?: { attempt: number; resolve: (error?: string) => void }
  attempt: number
  ready: boolean
}

/** Owns capture, overlay, save acknowledgement and cleanup as one transaction. */
export class GameAnnotationController {
  #active: Transaction | undefined

  constructor(private readonly owner: WebContents) {
    const trusted = (sender: WebContents) => {
      const active = this.#active
      if (active?.window?.webContents !== sender) throw new Error('无效的标注窗口。')
      return active
    }
    ipcMain.handle('annotation:load', (event) => {
      const active = trusted(event.sender)
      if (active.snapshot !== undefined) return { snapshot: active.snapshot, labels: active.request.labels }
      if (active.snapshotPromise === undefined) throw new Error('标注截图为空，请重试。')
      return active.snapshotPromise.then(snapshot => ({ snapshot, labels: active.request.labels }))
    })
    ipcMain.handle('annotation:ready', (event) => {
      const active = trusted(event.sender)
      const window = active.window
      if (window === undefined || !active.target?.valid()) { active.close(new Error('游戏窗口已变化，请重新标注。')); return }
      active.ready = true
      window.show()
      window.focus()
    })
    ipcMain.handle('annotation:cancel', (event) => {
      const active = trusted(event.sender)
      if (active.saving) return
      const target = active.target
      active.close()
      if (target?.valid()) target.focus()
    })
    ipcMain.handle('annotation:submit', async (event, drafts: unknown) => {
      const active = trusted(event.sender)
      if (!active.ready || active.saving || !isAnnotationDrafts(drafts)
        || drafts.some(draft => active.request.labels.includes(draft.label))) throw new Error('标注数据无效或正在保存。')
      if (!active.target?.valid()) { active.close(new Error('游戏窗口已变化，请重新标注。')); return }
      const error = await new Promise<string | undefined>((resolve) => {
        active.saving = { attempt: ++active.attempt, resolve }
        this.owner.send('desktop:game-annotation-commit', {
          ...active.request, attempt: active.attempt, drafts, snapshot: active.snapshot,
        })
      })
      if (this.#active !== active) return { error: error ?? '标注已结束。' }
      delete active.saving
      if (error !== undefined) return { error }
      const target = active.target
      active.close()
      if (target.valid()) target.focus()
      return {}
    })
    ipcMain.handle('desktop:game-annotation-result', (event, operationId: unknown, attempt: unknown, error: unknown) => {
      if (event.sender !== this.owner) throw new Error('无效的标注保存回执。')
      const active = this.#active
      if (!active || !active.saving || active.request.operationId !== operationId || active.saving.attempt !== attempt) return
      if (error !== undefined && (typeof error !== 'string' || error.length > 10000)) throw new Error('无效的标注保存错误。')
      active.saving.resolve(error)
    })
    owner.on('did-start-navigation', this.#navigation)
    owner.on('render-process-gone', this.#ownerGone)
    owner.on('destroyed', this.#ownerGone)
  }

  #navigation = (_event: unknown, _url: string, inPlace: boolean, main: boolean): void => {
    if (main && !inPlace) this.cancel()
  }
  #ownerGone = (): void => { this.cancel() }

  /** Resolves only when closed; capture/show failure rejects without leaving a window. */
  begin(request: AnnotationRequest, prepare: () => Promise<AnnotationTarget>): Promise<void> {
    if (this.#active) return Promise.reject(new Error('已有标注正在进行。'))
    return new Promise<void>((resolve, reject) => {
      const active: Transaction = {
        request, attempt: 0, ready: false,
        close: (error) => {
          if (this.#active !== active) return
          this.#active = undefined
          clearInterval(poll)
          active.saving?.resolve('标注已结束。')
          if (!active.window?.isDestroyed()) active.window?.destroy()
          delete active.snapshot
          if (error) reject(error)
          else resolve()
        },
      }
      this.#active = active
      const deadline = Date.now() + 15000
      const poll = setInterval(() => {
        if (active.target && !active.target.valid()) active.close(new Error('游戏窗口已变化，请重新标注。'))
        else if (!active.ready && Date.now() > deadline) active.close(new Error('标注窗口加载超时，请重试。'))
      }, 100)
      void (async () => {
        const target = await prepare()
        if (this.#active !== active) return
        active.target = target
        // Capture and renderer startup are independent, so overlap them while
        // the window stays hidden. annotation:load waits for the same snapshot.
        active.snapshotPromise = target.capture().then((snapshot) => {
          if (this.#active === active) active.snapshot = snapshot
          return snapshot
        })
        const window = new BrowserWindow({
          ...target.bounds, show: false, frame: false, resizable: false, movable: false,
          minimizable: false, maximizable: false, skipTaskbar: true, alwaysOnTop: true,
          backgroundColor: '#161c17',
          webPreferences: { ...DESKTOP_WEB_PREFERENCES, preload: fileURLToPath(new URL('./annotation-preload.cjs', import.meta.url)) },
        })
        active.window = window
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', (event) => { event.preventDefault() })
        window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
        window.webContents.once('render-process-gone', () => { active.close(new Error('标注窗口意外关闭，请重新标注。')) })
        window.once('closed', () => { active.close() })
        await window.loadFile(fileURLToPath(new URL('./annotation.html', import.meta.url)))
        const snapshot = await active.snapshotPromise
        if (this.#active !== active) return
        if (!target.valid()) throw new Error('游戏窗口已变化，请重新标注。')
        active.snapshot = snapshot
      })().catch((error: unknown) => {
        active.close(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  /** Operation-scoped cancellation prevents an old component from closing a newer overlay. */
  cancel(operationId?: string): void {
    if (operationId === undefined || this.#active?.request.operationId === operationId) this.#active?.close()
  }

  dispose(): void {
    this.cancel()
    for (const channel of ['annotation:load', 'annotation:ready', 'annotation:cancel', 'annotation:submit', 'desktop:game-annotation-result']) ipcMain.removeHandler(channel)
    this.owner.removeListener('did-start-navigation', this.#navigation)
    this.owner.removeListener('render-process-gone', this.#ownerGone)
    this.owner.removeListener('destroyed', this.#ownerGone)
  }
}
