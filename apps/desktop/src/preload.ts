import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isDesktopMenuAction, type DesktopMenuAction, type DesktopMenuId, type DesktopMenuOpenRequest,
} from './menu.ts'
import { isDesktopGameEvent, isGameCaptureEvent, isGameCaptureSnapshot, isGameCaptureState } from './preload-validation.ts'
import type { GameCaptureEvent, GameCaptureSnapshot, GameCaptureState } from './game-capture.ts'

export interface DesktopCommandRequest {
  kind: 'project-settings-read' | 'project-settings-write' | 'export-jar' | 'game-toggle'
    | 'git-status' | 'git-diff' | 'git-log' | 'git-branch' | 'git-commit' | 'git-push' | 'git-pull'
  cwd: string
  artifactName?: string
  message?: string
  branch?: string
  createBranch?: boolean
  switchBranch?: boolean
  settings?: { prerequisites: { name: string; path: string }[]; systemPrompt: string }
}

export interface DesktopGameEvent {
  cwd: string
  result: DesktopCommandResult
}

export interface DesktopCommandResult {
  ok: boolean
  title: string
  message: string
  stdout?: string
  stderr?: string
  path?: string
  artifacts?: string[]
  settings?: { prerequisites: { name: string; path: string }[]; systemPrompt: string }
}

export interface DesktopBridge {
  menuPresentation: 'web' | 'native'
  onMenuAction: (listener: (action: DesktopMenuAction) => void) => () => void
  openMenu: (menu: DesktopMenuId, anchor: DesktopMenuOpenRequest['anchor'], cwd?: string) => Promise<void>
  setActiveProject: (cwd?: string) => Promise<void>
  onGameEvent: (listener: (event: DesktopGameEvent) => void) => () => void
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
  invokeProjectCommand: (request: DesktopCommandRequest) => Promise<DesktopCommandResult>
  onGameSurfaceState?: (listener: (event: GameCaptureEvent) => void) => () => void
  reconnectGameSurface?: (cwd: string) => Promise<GameCaptureState>
  beginGameAnnotation?: (cwd: string) => Promise<GameCaptureSnapshot>
  endGameAnnotation?: (cwd: string) => Promise<void>
  repositionGameCompanion?: (cwd: string) => Promise<void>
}

contextBridge.exposeInMainWorld('craftCodeDesktop', {
  menuPresentation: process.platform === 'darwin' ? 'native' : 'web',
  onMenuAction: (listener: (action: DesktopMenuAction) => void) => {
    const wrapped = (_event: IpcRendererEvent, action: unknown): void => {
      if (isDesktopMenuAction(action)) listener(action)
    }
    ipcRenderer.on('desktop:menu-action', wrapped)
    return () => { ipcRenderer.removeListener('desktop:menu-action', wrapped) }
  },
  openMenu: (menu: DesktopMenuId, anchor: DesktopMenuOpenRequest['anchor'], cwd?: string) =>
    ipcRenderer.invoke('desktop:open-menu', { menu, anchor, ...(cwd === undefined ? {} : { cwd }) }),
  setActiveProject: (cwd?: string) => ipcRenderer.invoke('desktop:set-active-project', cwd),
  onGameEvent: (listener: (event: DesktopGameEvent) => void) => {
    const wrapped = (_event: IpcRendererEvent, value: unknown): void => {
      if (isDesktopGameEvent(value)) listener(value)
    }
    ipcRenderer.on('desktop:game-event', wrapped)
    return () => { ipcRenderer.removeListener('desktop:game-event', wrapped) }
  },
  minimizeWindow: () => ipcRenderer.invoke('desktop:window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('desktop:window-toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('desktop:window-close'),
  isMaximized: () => ipcRenderer.invoke('desktop:window-is-maximized'),
  onMaximizedChange: (listener: (maximized: boolean) => void) => {
    const wrapped = (_event: IpcRendererEvent, maximized: unknown): void => {
      if (typeof maximized === 'boolean') listener(maximized)
    }
    ipcRenderer.on('desktop:window-maximized', wrapped)
    return () => { ipcRenderer.removeListener('desktop:window-maximized', wrapped) }
  },
  invokeProjectCommand: (request: DesktopCommandRequest) => ipcRenderer.invoke('desktop:command', request),
  onGameSurfaceState: (listener: (event: GameCaptureEvent) => void) => {
    const wrapped = (_event: IpcRendererEvent, value: unknown): void => {
      if (isGameCaptureEvent(value)) listener(value)
    }
    ipcRenderer.on('desktop:game-surface-state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:game-surface-state', wrapped) }
  },
  reconnectGameSurface: async (cwd: string) => {
    const value: unknown = await ipcRenderer.invoke('desktop:game-surface-reconnect', cwd)
    if (!isGameCaptureState(value)) throw new Error('主进程返回了无效的游戏状态。')
    return value
  },
  beginGameAnnotation: async (cwd: string) => {
    const value: unknown = await ipcRenderer.invoke('desktop:game-annotation-begin', cwd)
    if (!isGameCaptureSnapshot(value)) throw new Error('主进程返回了无效的游戏截图。')
    return value
  },
  endGameAnnotation: (cwd: string) => ipcRenderer.invoke('desktop:game-annotation-end', cwd),
  repositionGameCompanion: (cwd: string) => ipcRenderer.invoke('desktop:game-companion-reposition', cwd),
} satisfies DesktopBridge)
