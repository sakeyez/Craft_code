import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { backendArguments, readyUrlFromLine, startBackend } from '../src/backend.ts'

const fixture = fileURLToPath(new URL('./fixtures/backend.mjs', import.meta.url))

describe('desktop backend supervisor', () => {
  it('builds the dynamic loopback Web invocation without a shell', () => {
    expect(backendArguments({ cliEntry: 'cli.js', entryMode: 'source' })).toEqual([
      '--import', 'tsx/esm', 'cli.js', 'web',
      '--host', '127.0.0.1', '--port', '0', '--no-open',
    ])
    expect(backendArguments({ cliEntry: 'cli.js', entryMode: 'compiled' })).toEqual([
      'cli.js', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open',
    ])
  })

  it('accepts only a valid nonzero 127.0.0.1 readiness URL', () => {
    expect(readyUrlFromLine('dsh web: http://127.0.0.1:43123')).toBe('http://127.0.0.1:43123')
    expect(readyUrlFromLine('dsh web: http://127.0.0.1:43123 (LAN: http://10.0.0.1:43123)'))
      .toBe('http://127.0.0.1:43123')
    expect(readyUrlFromLine('dsh web: http://localhost:43123')).toBeUndefined()
    expect(readyUrlFromLine('dsh web: http://127.0.0.1:0')).toBeUndefined()
    expect(readyUrlFromLine('prefix dsh web: http://127.0.0.1:43123')).toBeUndefined()
  })

  it('stops a ready backend through the supervisor IPC message', async () => {
    const backend = await startBackend({
      nodeExecutable: process.execPath,
      cliEntry: fixture,
      entryMode: 'compiled',
      cwd: process.cwd(),
      env: { ...process.env, DSH_DESKTOP_FIXTURE_MODE: 'ready' },
      startTimeoutMs: 2_000,
      stopTimeoutMs: 2_000,
    })
    expect(backend.url).toBe('http://127.0.0.1:43123')
    await expect(backend.stop()).resolves.toMatchObject({ code: 0 })
    expect(backend.child.exitCode).toBe(0)
  })

  it('sends the IPC request before terminating an unresponsive backend', async () => {
    const backend = await startBackend({
      nodeExecutable: process.execPath,
      cliEntry: fixture,
      entryMode: 'compiled',
      cwd: process.cwd(),
      env: { ...process.env, DSH_DESKTOP_FIXTURE_MODE: 'stubborn' },
      startTimeoutMs: 2_000,
      stopTimeoutMs: 100,
    })
    let output = ''
    backend.child.stdout?.on('data', (chunk: Buffer | string) => { output += chunk.toString() })
    const result = await backend.stop()
    expect(result.signal).toBeTypeOf('string')
    expect(output).toContain('shutdown requested')
    expect(() => process.kill(backend.child.pid!, 0)).toThrow()
  })

  it('reports an early exit with stderr and leaves no running child', async () => {
    let childPid: number | undefined
    await expect(startBackend({
      nodeExecutable: process.execPath,
      cliEntry: fixture,
      entryMode: 'compiled',
      cwd: process.cwd(),
      env: { ...process.env, DSH_DESKTOP_FIXTURE_MODE: 'exit' },
      startTimeoutMs: 2_000,
      log: (line) => {
        const matched = /pid=(\d+)/u.exec(line)
        if (matched?.[1] !== undefined) childPid = Number(matched[1])
      },
    })).rejects.toThrow(/exited before readiness.*fixture exited before readiness/su)
    if (childPid !== undefined) expect(() => process.kill(childPid!, 0)).toThrow()
  })

  it('terminates a child that misses the startup deadline', async () => {
    let childPid: number | undefined
    await expect(startBackend({
      nodeExecutable: process.execPath,
      cliEntry: fixture,
      entryMode: 'compiled',
      cwd: process.cwd(),
      env: { ...process.env, DSH_DESKTOP_FIXTURE_MODE: 'hang' },
      startTimeoutMs: 50,
      log: (line) => {
        const matched = /pid=(\d+)/u.exec(line)
        if (matched?.[1] !== undefined) childPid = Number(matched[1])
      },
    })).rejects.toThrow('startup deadline')
    expect(childPid).toBeTypeOf('number')
    expect(() => process.kill(childPid!, 0)).toThrow()
  })
})
