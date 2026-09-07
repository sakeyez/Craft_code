/** A completed game process event with renderer-safe primitive fields. */
export interface ValidDesktopGameEvent {
  cwd: string
  result: {
    ok: boolean
    title: string
    message: string
    stdout?: string
    stderr?: string
  }
}

/** Validate the game event before it crosses from Electron IPC into the renderer. */
export function isDesktopGameEvent(value: unknown): value is ValidDesktopGameEvent {
  if (value === null || typeof value !== 'object' || !('cwd' in value) || !('result' in value)
    || typeof value.cwd !== 'string' || value.result === null || typeof value.result !== 'object') return false
  const result = value.result
  return 'ok' in result && typeof result.ok === 'boolean'
    && 'title' in result && typeof result.title === 'string'
    && 'message' in result && typeof result.message === 'string'
    && (!('stdout' in result) || result.stdout === undefined || typeof result.stdout === 'string')
    && (!('stderr' in result) || result.stderr === undefined || typeof result.stderr === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

/** Validate one complete renderer-safe external-game state. */
export function isGameCaptureState(value: unknown): value is GameCaptureState {
  if (!isRecord(value) || typeof value.status !== 'string') return false
  const named = value.gameName === undefined || typeof value.gameName === 'string'
  switch (value.status) {
    case 'idle': return hasOnly(value, ['status'])
    case 'starting':
    case 'reconnecting': return named && hasOnly(value, ['status', 'gameName'])
    case 'connected': return named && value.surfaceKind === 'external-window'
      && hasOnly(value, ['status', 'gameName', 'surfaceKind'])
    case 'failed':
    case 'disconnected':
    case 'unsupported': return named && typeof value.error === 'string'
      && hasOnly(value, ['status', 'gameName', 'error'])
    default: return false
  }
}

/** Validate a project-scoped game state envelope before renderer delivery. */
export function isGameCaptureEvent(value: unknown): value is GameCaptureEvent {
  return isRecord(value) && hasOnly(value, ['cwd', 'state'])
    && typeof value.cwd === 'string' && /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(value.cwd)
    && isGameCaptureState(value.state)
}

/** Validate the bounded JPEG returned by annotation capture. */
export function isGameCaptureSnapshot(value: unknown): value is GameCaptureSnapshot {
  return isRecord(value) && hasOnly(value, ['dataUrl', 'width', 'height'])
    && typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:image/jpeg;base64,')
    && value.dataUrl.length <= 4_000_000
    && typeof value.width === 'number' && Number.isInteger(value.width) && value.width > 0 && value.width <= 1920
    && typeof value.height === 'number' && Number.isInteger(value.height) && value.height > 0 && value.height <= 1080
}
import type { GameCaptureEvent, GameCaptureSnapshot, GameCaptureState } from './game-capture.ts'
