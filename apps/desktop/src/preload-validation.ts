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
