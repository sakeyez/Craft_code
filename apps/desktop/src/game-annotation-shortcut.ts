import { globalShortcut, type WebContents } from 'electron'
import type { AnnotationRequest } from './game-annotation-contract.ts'
import type { GameCaptureProvider } from './game-capture.ts'
import type { GameAnnotationController } from './game-annotation.ts'

const ACCELERATOR = 'Control+Shift+P'

/** Registers only for the selected conversation; native focus is checked again on dispatch. */
export class GameAnnotationShortcut {
  #request: AnnotationRequest | undefined
  #registered = false
  #held = false
  #checking = false
  #failed = false
  #timer: ReturnType<typeof setInterval>

  constructor(private readonly owner: WebContents, private readonly provider: GameCaptureProvider,
    private readonly annotation: GameAnnotationController, private readonly selected: () => string | undefined) {
    this.#timer = setInterval(() => { void this.#refresh() }, 250)
    owner.on('did-start-navigation', this.#navigation)
    owner.on('render-process-gone', this.#clear)
    owner.on('destroyed', this.#clear)
  }

  #clear = (): void => { this.bind(undefined) }
  #navigation = (_event: unknown, _url: string, inPlace: boolean, main: boolean): void => {
    if (main && !inPlace) this.#clear()
  }

  /** Replaces readiness; a stale component may only unbind its own token. */
  bind(request: AnnotationRequest | undefined, token?: string): void {
    if (token !== undefined && this.#request?.operationId !== token) return
    this.#unregister()
    this.#request = request
    this.#failed = false
    if (!request) this.annotation.release()
    void this.#refresh()
  }

  #unregister(): void {
    if (this.#registered) globalShortcut.unregister(ACCELERATOR)
    this.#registered = false
  }

  async #refresh(): Promise<void> {
    if (this.#checking) return
    this.#checking = true
    const request = this.#request
    try {
      if (!request || this.selected() !== request.cwd || this.owner.isDestroyed()) {
        this.#unregister()
        return
      }
      if (!await this.provider.annotationShortcutHeld?.()) this.#held = false
      const target = await this.provider.annotationTarget(request.cwd)
      if (this.#request !== request || this.selected() !== request.cwd) return
      if (!target.valid()) throw new Error('game unavailable')
      void this.annotation.warm(target.bounds).catch(() => {})
      if (this.#registered || this.#failed) return
      this.#registered = globalShortcut.register(ACCELERATOR, () => { void this.#trigger() })
      if (!this.#registered) {
        this.#failed = true
        this.owner.send('desktop:annotation-shortcut', { operationId: request.operationId, error: '快捷键被占用，请使用“在游戏上标注”按钮。' })
      }
    } catch {
      if (this.#request === request) {
        this.#unregister()
        this.annotation.release()
      }
    } finally { this.#checking = false }
  }

  async #trigger(): Promise<void> {
    const request = this.#request
    if (this.#held || !request || request.cwd !== this.selected()) return
    this.#held = true
    try {
      if (await this.provider.isAnnotationForeground?.(request.cwd) && this.#request === request) {
        this.owner.send('desktop:annotation-shortcut', { operationId: request.operationId })
      }
    } catch { /* A disconnected game cannot receive a shortcut. */ }
  }

  dispose(): void {
    clearInterval(this.#timer)
    this.#clear()
    this.owner.removeListener('did-start-navigation', this.#navigation)
    this.owner.removeListener('render-process-gone', this.#clear)
    this.owner.removeListener('destroyed', this.#clear)
  }
}
