/** Electron-only menu UI mounted into the Web shell's frame overlay. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DesktopMenuBar, DesktopWindowControls } from './DesktopMenuBar.tsx'
import { DesktopMenuSurface } from './DesktopMenuSurface.tsx'
import type {
  DesktopGameEvent, DesktopMenuBarInjected, DesktopMenuEvent, DesktopMenuInjected, DesktopWindowControlsInjected,
} from './contract.ts'

/** Required services for the overlay registration and project/session actions. */
export const inject = ['slots', 'sessions', 'workspaces', 'layout']

/** Register the desktop overlay only when Electron's preload bridge is present. */
export function apply(ctx: ClientContext): void {
  const bridge = window.craftCodeDesktop
  if (bridge === undefined) return

  let snapshot: DesktopMenuEvent = { sequence: 0 }
  const listeners = new Set<() => void>()
  const desktopMenu: HostObservable<DesktopMenuEvent> = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  ctx.effect(() => bridge.onMenuAction((action) => {
    snapshot = { sequence: snapshot.sequence + 1, action }
    for (const listener of listeners) listener()
  }), 'ui-desktop-menu: preload menu subscription')

  let gameSnapshot: DesktopGameEvent = { sequence: 0 }
  const gameListeners = new Set<() => void>()
  const desktopGame: HostObservable<DesktopGameEvent> = {
    getSnapshot: () => gameSnapshot,
    subscribe(listener) {
      gameListeners.add(listener)
      return () => { gameListeners.delete(listener) }
    },
  }
  ctx.effect(() => bridge.onGameEvent((event) => {
    gameSnapshot = { sequence: gameSnapshot.sequence + 1, ...event }
    for (const listener of gameListeners) listener()
  }), 'ui-desktop-menu: preload game subscription')
  if (bridge.onGameSurfaceState !== undefined) {
    const onGameSurfaceState = bridge.onGameSurfaceState
    ctx.effect(
      () => onGameSurfaceState((event) => { ctx.layout.setGameSurface(event) }),
      'ui-desktop-menu: preload game surface subscription',
    )
  }
  ctx.effect(() => ctx.layout.attachGameSurfaceBridge({
    bindAnnotationShortcut: (request, listener) => bridge.bindGameAnnotationShortcut?.(request, listener) ?? (() => {}),
    beginAnnotation: async (request, commit) => {
      if (bridge.beginGameAnnotation === undefined) throw new Error('桌面端未提供游戏截图能力。')
      return bridge.beginGameAnnotation(request, commit)
    },
    endAnnotation: async (operationId) => { await bridge.endGameAnnotation?.(operationId) },
  }), 'ui-desktop-menu: game surface bridge')

  const injected = (): DesktopMenuInjected => ({
    hooks: { desktopMenu, desktopGame },
    invoke: request => bridge.invokeProjectCommand(request),
    setActiveProject: cwd => bridge.setActiveProject(cwd),
    createProject: async () => {
      const path = await ctx.workspaces.pickDirectory()
      if (path === null) return null
      const workspace = await ctx.workspaces.create({ path })
      ctx.workspaces.startSession(workspace.workspaceId)
      return workspace.path
    },
  })

  if (bridge.menuPresentation === 'web') {
    const menuInjected = (): DesktopMenuBarInjected => ({
      openMenu: (menu, anchor, cwd) => bridge.openMenu(menu, anchor, cwd),
    })
    const controlsInjected = (): DesktopWindowControlsInjected => ({
      windowControls: {
        minimize: () => bridge.minimizeWindow(),
        toggleMaximize: () => bridge.toggleMaximizeWindow(),
        close: () => bridge.closeWindow(),
        isMaximized: () => bridge.isMaximized(),
        onMaximizedChange: listener => bridge.onMaximizedChange(listener),
      },
    })
    ctx.slots.inject('shell.topbar', () => ctx.slots.register({
      name: 'shell.topbar',
      inject: menuInjected,
    }, DesktopMenuBar))
    ctx.slots.inject('shell.window-controls', () => ctx.slots.register({
      name: 'shell.window-controls',
      inject: controlsInjected,
    }, DesktopWindowControls))
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'desktop-menu',
    order: 20,
    inject: injected,
  }, DesktopMenuSurface))
}

export type { DesktopBridge, DesktopCommandRequest, DesktopCommandResult } from './contract.ts'
