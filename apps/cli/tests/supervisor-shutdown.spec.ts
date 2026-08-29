import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ProcessShutdown } from '../src/process-shutdown.ts'
import {
  installSupervisorShutdown,
  SUPERVISOR_SHUTDOWN_MESSAGE,
  type SupervisorProcess,
} from '../src/supervisor-shutdown.ts'

class FakeProcess extends EventEmitter implements SupervisorProcess {
  env: NodeJS.ProcessEnv = {}
  connected = true
  send: () => void = () => {}
  disconnect = vi.fn(() => { this.connected = false })
}

function fakeShutdown(): ProcessShutdown & { shutdown: ReturnType<typeof vi.fn> } {
  return {
    shutdown: vi.fn(async () => {}),
    interrupt: vi.fn(),
  }
}

describe('CLI supervisor shutdown adapter', () => {
  it('ignores IPC when the parent did not opt in', () => {
    const proc = new FakeProcess()
    const shutdown = fakeShutdown()
    installSupervisorShutdown(shutdown, proc)
    proc.emit('message', SUPERVISOR_SHUTDOWN_MESSAGE)
    expect(shutdown.shutdown).not.toHaveBeenCalled()
  })

  it('coalesces the accepted message into graceful disposal and disconnects IPC', async () => {
    const proc = new FakeProcess()
    proc.env.DSH_SUPERVISOR_IPC = '1'
    const shutdown = fakeShutdown()
    installSupervisorShutdown(shutdown, proc)
    proc.emit('message', 'unrelated')
    proc.emit('message', SUPERVISOR_SHUTDOWN_MESSAGE)
    proc.emit('message', SUPERVISOR_SHUTDOWN_MESSAGE)
    await vi.waitFor(() => { expect(proc.disconnect).toHaveBeenCalledOnce() })
    expect(shutdown.shutdown).toHaveBeenCalledOnce()
    expect(shutdown.shutdown).toHaveBeenCalledWith(0)
  })
})
