import type { BrowserWindow } from 'electron'

/** Lifecycle states published for one project-owned external game window. */
export type GameCaptureStatus =
  | 'idle'
  | 'starting'
  | 'connected'
  | 'failed'
  | 'disconnected'
  | 'reconnecting'
  | 'unsupported'

/** Renderer-safe state for one project-owned external game window. */
export type GameCaptureState =
  | { status: 'idle' }
  | { status: 'starting' | 'reconnecting'; gameName?: string }
  | { status: 'connected'; gameName?: string; surfaceKind: 'external-window' }
  | { status: 'failed' | 'disconnected' | 'unsupported'; gameName?: string; error: string }

/** Project key plus the complete replacement state sent across IPC. */
export interface GameCaptureEvent {
  cwd: string
  state: GameCaptureState
}

/** Bounded still image used only while the HTML annotation layer is active. */
export interface GameCaptureSnapshot {
  dataUrl: string
  width: number
  height: number
}

/** Native game-window ownership behind the desktop IPC boundary. */
export interface GameCaptureProvider {
  start(cwd: string, rootPid: number): Promise<GameCaptureState>
  reconnect(cwd: string): Promise<GameCaptureState>
  select(cwd: string | undefined): Promise<void>
  stop(cwd: string): Promise<void>
  beginAnnotation(cwd: string): Promise<GameCaptureSnapshot>
  endAnnotation(cwd: string): Promise<void>
  dispose(): Promise<void>
}

export interface GameCaptureProviderOptions {
  window: BrowserWindow
  publish: (event: GameCaptureEvent) => void
  log?: (line: string) => void
}

/** Non-Windows provider: launches remain external and no active workspace is claimed. */
export class UnsupportedGameCaptureProvider implements GameCaptureProvider {
  constructor(private readonly publish?: (event: GameCaptureEvent) => void) {}

  start(cwd: string, _rootPid: number): Promise<GameCaptureState> {
    const state: GameCaptureState = {
      status: 'unsupported',
      error: '当前平台不支持内嵌游戏窗口，Minecraft 将在独立窗口中运行。',
    }
    this.publish?.({ cwd, state })
    return Promise.resolve(state)
  }

  reconnect(cwd: string): Promise<GameCaptureState> {
    const state: GameCaptureState = { status: 'unsupported', error: '当前平台不支持内嵌游戏窗口。' }
    this.publish?.({ cwd, state })
    return Promise.resolve(state)
  }

  select(_cwd: string | undefined): Promise<void> { return Promise.resolve() }
  stop(cwd: string): Promise<void> {
    this.publish?.({ cwd, state: { status: 'idle' } })
    return Promise.resolve()
  }

  beginAnnotation(_cwd: string): Promise<GameCaptureSnapshot> {
    return Promise.reject(new Error('当前平台不支持游戏画面标注。'))
  }

  endAnnotation(_cwd: string): Promise<void> { return Promise.resolve() }
  dispose(): Promise<void> { return Promise.resolve() }
}

/** Create the platform provider without loading Koffi on non-Windows hosts. */
export async function createGameCaptureProvider(options: GameCaptureProviderOptions): Promise<GameCaptureProvider> {
  if (process.platform !== 'win32') return new UnsupportedGameCaptureProvider(options.publish)
  const { WindowsGameCaptureProvider } = await import('./game-capture-win32.ts')
  return new WindowsGameCaptureProvider(options)
}
