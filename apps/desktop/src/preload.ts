import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isDesktopMenuAction, type DesktopMenuAction, type DesktopMenuId, type DesktopMenuOpenRequest,
} from './menu.ts'
import { isDesktopGameEvent } from './preload-validation.ts'
import type { GameCaptureState } from './game-capture.ts'

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
  onGameSurfaceState?: (listener: (state: GameCaptureState) => void) => () => void
  reconnectGameSurface?: (cwd: string) => Promise<GameCaptureState>
  stopGameSurface?: (cwd: string) => Promise<void>
  screenshotGameSurface?: (cwd: string) => Promise<{ ref: string } | undefined>
  setGameSurfaceBounds?: (cwd: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<void>
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
  onGameSurfaceState: (listener: (state: GameCaptureState) => void) => {
    const wrapped = (_event: IpcRendererEvent, value: unknown): void => {
      if (value !== null && typeof value === 'object' && 'status' in value && typeof value.status === 'string') listener(value as GameCaptureState)
    }
    ipcRenderer.on('desktop:game-surface-state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:game-surface-state', wrapped) }
  },
  reconnectGameSurface: (cwd: string) => ipcRenderer.invoke('desktop:game-surface-reconnect', cwd),
  stopGameSurface: (cwd: string) => ipcRenderer.invoke('desktop:game-surface-stop', cwd),
  screenshotGameSurface: (cwd: string) => ipcRenderer.invoke('desktop:game-surface-screenshot', cwd),
  setGameSurfaceBounds: (cwd: string, bounds) => ipcRenderer.invoke('desktop:game-surface-bounds', { cwd, bounds }),
} satisfies DesktopBridge)
