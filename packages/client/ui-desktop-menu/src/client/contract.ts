import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Native menu actions admitted by the sandboxed desktop preload bridge. */
export type DesktopAction =
  | 'project:new' | 'project:export-jar' | 'project:settings'
  | 'editor:find-current' | 'editor:find-project'
  | 'git:status' | 'git:diff' | 'git:log' | 'git:branch' | 'git:commit' | 'git:push' | 'git:pull'
  | 'help:docs' | 'help:sponsor'

/** Closed set of top-level application menus available to the Web menu bar. */
export type DesktopMenuId = 'project' | 'editor' | 'git' | 'help'

/** Renderer-relative popup position in device-independent CSS pixels. */
export interface DesktopMenuAnchor {
  x: number
  y: number
}

/** Whether this platform renders the application menu in Web content or OS chrome. */
export type DesktopMenuPresentation = 'web' | 'native'

/** Project settings persisted by the desktop main process. */
export interface DesktopSettings {
  prerequisites: { name: string; path: string }[]
  systemPrompt: string
}

/** Request sent through the desktop command IPC boundary. */
export interface DesktopCommandRequest {
  kind: string
  cwd: string
  message?: string
  createBranch?: boolean
  switchBranch?: boolean
  branch?: string
  settings?: DesktopSettings
}

/** Bounded result returned by a desktop command invocation. */
export interface DesktopCommandResult {
  ok: boolean
  title: string
  message: string
  stdout?: string
  stderr?: string
  path?: string
  artifacts?: string[]
  settings?: DesktopSettings
}

/** Privileged desktop surface exposed by the sandboxed preload script. */
export interface DesktopBridge {
  menuPresentation: DesktopMenuPresentation
  onMenuAction(listener: (action: DesktopAction) => void): () => void
  openMenu(menu: DesktopMenuId, anchor: DesktopMenuAnchor): Promise<void>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  closeWindow(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
  invokeProjectCommand(request: DesktopCommandRequest): Promise<DesktopCommandResult>
}

/** Observable renderer event derived from a native menu action. */
export interface DesktopMenuEvent {
  sequence: number
  action?: DesktopAction
}

/** One project-wide conversation search match. */
export interface ProjectSearchItem {
  sessionId: string
  snippet: string
}

/** Host capabilities injected into the desktop menu overlay component. */
export interface DesktopMenuInjected {
  hooks: { desktopMenu: HostObservable<DesktopMenuEvent> }
  invoke: (request: DesktopCommandRequest) => Promise<DesktopCommandResult>
  createProject: () => Promise<string | null>
  searchProject: (query: string, cwd: string, signal: AbortSignal) => Promise<ProjectSearchItem[]>
}

/** Capability injected only into the desktop top menu bar. */
export interface DesktopMenuBarInjected {
  openMenu: (menu: DesktopMenuId, anchor: DesktopMenuAnchor) => Promise<void>
  windowControls?: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
  }
}

declare global {
  interface Window {
    craftCodeDesktop?: DesktopBridge
    find?(text: string): boolean
  }
}
