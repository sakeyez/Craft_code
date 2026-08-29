import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  isDesktopMenuAction, type DesktopMenuAction, type DesktopMenuId, type DesktopMenuOpenRequest,
} from './menu.ts'

export interface DesktopCommandRequest {
  kind: 'project-settings-read' | 'project-settings-write' | 'export-jar'
    | 'git-status' | 'git-diff' | 'git-log' | 'git-branch' | 'git-commit' | 'git-push' | 'git-pull'
  cwd: string
  artifactName?: string
  message?: string
  branch?: string
  createBranch?: boolean
  switchBranch?: boolean
  settings?: { prerequisites: { name: string; path: string }[]; systemPrompt: string }
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
  openMenu: (menu: DesktopMenuId, anchor: DesktopMenuOpenRequest['anchor']) => Promise<void>
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
  invokeProjectCommand: (request: DesktopCommandRequest) => Promise<DesktopCommandResult>
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
  openMenu: (menu: DesktopMenuId, anchor: DesktopMenuOpenRequest['anchor']) =>
    ipcRenderer.invoke('desktop:open-menu', { menu, anchor }),
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
} satisfies DesktopBridge)
