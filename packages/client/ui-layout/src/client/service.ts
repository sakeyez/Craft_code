/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import type {
  GameSurfaceBridge, GameSurfaceEvent, GameAnnotationRequest, GameAnnotationDraft, GameAnnotationSnapshot, GameSurfaceState,
} from './game.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Select a project workbench page when the composition provides one. */
  setWorkbenchView?(cwd: string, view: 'conversation' | 'code' | 'dependencies' | 'test'): void
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /** Publish one complete project-scoped external-game state. */
  setGameSurface(event: GameSurfaceEvent): void
  /** Subscribe the active conversation to native annotation requests; returns its disposer. */
  bindAnnotationShortcut(request: GameAnnotationRequest, listener: (error?: string) => void): () => void
  /** Attach the desktop-only privileged operations and return their disposer. */
  attachGameSurfaceBridge(bridge: GameSurfaceBridge): () => void
  beginGameAnnotation(
    request: GameAnnotationRequest,
    commit: (drafts: GameAnnotationDraft[], snapshot?: GameAnnotationSnapshot) => Promise<void>,
  ): Promise<void>
  endGameAnnotation(operationId: string): Promise<void>
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  setWorkbenchView(cwd: string, view: 'conversation' | 'code' | 'dependencies' | 'test'): void { this.#require().setWorkbenchView(cwd, view) }
  #panels: PanelActions | undefined
  #gameBridge: GameSurfaceBridge | undefined
  readonly #pendingGameStates = new Map<string, GameSurfaceState>()

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
    for (const [cwd, state] of this.#pendingGameStates) actions.setGameSurface(cwd, state)
    this.#pendingGameStates.clear()
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  setGameSurface(event: GameSurfaceEvent): void {
    if (this.#panels === undefined) this.#pendingGameStates.set(event.cwd, event.state)
    else this.#panels.setGameSurface(event.cwd, event.state)
  }

  /** Bind the native shortcut when the desktop bridge is available; dispose on session changes. */
  bindAnnotationShortcut(request: GameAnnotationRequest, listener: (error?: string) => void): () => void {
    return this.#gameBridge?.bindAnnotationShortcut?.(request, listener) ?? (() => {})
  }

  attachGameSurfaceBridge(bridge: GameSurfaceBridge): () => void {
    this.#gameBridge = bridge
    return () => { if (this.#gameBridge === bridge) this.#gameBridge = undefined }
  }

  beginGameAnnotation(
    request: GameAnnotationRequest,
    commit: (drafts: GameAnnotationDraft[], snapshot?: GameAnnotationSnapshot) => Promise<void>,
  ): Promise<void> { return this.#requireGameBridge().beginAnnotation(request, commit) }
  endGameAnnotation(operationId: string): Promise<void> { return this.#requireGameBridge().endAnnotation(operationId) }

  #requireGameBridge(): GameSurfaceBridge {
    if (this.#gameBridge === undefined) throw new Error('layout: desktop game bridge not attached')
    return this.#gameBridge
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
