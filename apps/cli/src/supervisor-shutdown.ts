/** Optional parent-process shutdown channel for supervised CLI launches. */
import type { ProcessShutdown } from './process-shutdown.ts'

/** Exact IPC message accepted from an explicitly enabled parent supervisor. */
export const SUPERVISOR_SHUTDOWN_MESSAGE = 'dsh/supervisor-shutdown'
export const SUPERVISOR_IPC_ENV = 'DSH_SUPERVISOR_IPC'

/** Process operations needed by the supervisor shutdown adapter. */
export interface SupervisorProcess {
  env: NodeJS.ProcessEnv
  connected?: boolean
  send?: unknown
  on(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  disconnect?(): void
}

/**
 * Install the desktop supervisor's graceful shutdown request when this process
 * has both the explicit environment opt-in and a real Node IPC channel.
 * @param shutdown - launcher-owned bounded disposal controller.
 * @param proc - process adapter, replaceable by focused tests.
 * @returns a disposer removing the message listener.
 */
export function installSupervisorShutdown(
  shutdown: ProcessShutdown,
  proc: SupervisorProcess = process,
): () => void {
  if (proc.env[SUPERVISOR_IPC_ENV] !== '1' || typeof proc.send !== 'function') return () => {}
  let accepting = true
  const dispose = (): void => {
    if (!accepting) return
    accepting = false
    proc.off('message', onMessage)
  }
  const onMessage = (message: unknown): void => {
    if (!accepting || message !== SUPERVISOR_SHUTDOWN_MESSAGE) return
    dispose()
    void shutdown.shutdown(0).finally(() => {
      if (proc.connected === true) proc.disconnect?.()
    })
  }
  proc.on('message', onMessage)
  return dispose
}
