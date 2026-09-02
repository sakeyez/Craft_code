/* oxlint-disable */
/** Renderer-safe contract for a native game capture provider. */
export type GameCaptureStatus = 'idle' | 'starting' | 'connected' | 'failed' | 'disconnected' | 'reconnecting' | 'unsupported'
export interface GameCaptureState { status: GameCaptureStatus; gameName?: string; surfaceUrl?: string; aspectRatio?: number; error?: string }
export interface GameCaptureProvider {
  start(cwd: string): Promise<GameCaptureState>
  reconnect(cwd: string): Promise<GameCaptureState>
  stop(cwd: string): Promise<void>
  screenshot(cwd: string): Promise<{ ref: string } | undefined>
  setBounds(cwd: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
}

/** Explicit fallback until a platform encoder is installed. Never claims a connected surface. */
export class UnsupportedGameCaptureProvider implements GameCaptureProvider {
  async start(_cwd: string): Promise<GameCaptureState> { return { status: 'unsupported', error: '当前平台没有可用的游戏画面 provider。' } }
  async reconnect(_cwd: string): Promise<GameCaptureState> { return { status: 'unsupported', error: '当前平台没有可用的游戏画面 provider。' } }
  async stop(_cwd: string): Promise<void> {}
  async screenshot(_cwd: string): Promise<undefined> { return undefined }
  async setBounds(_cwd: string, _bounds: { x: number; y: number; width: number; height: number }): Promise<void> {}
}
