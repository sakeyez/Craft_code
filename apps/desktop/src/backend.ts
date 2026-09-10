/**
 * Supervise one private `dsh desktop` child and expose only its settled loopback URL.
 * The CLI owns profile composition and Cordis disposal; this module owns
 * readiness, parent/child lifetime, and forced termination fallback.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

const READY_LINE = /^dsh desktop: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/u
const SUPERVISOR_SHUTDOWN_MESSAGE = 'dsh/supervisor-shutdown'
const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 7_000
const TERMINATE_TIMEOUT_MS = 2_000

/** Inputs needed to launch the repository CLI without a shell. */
export interface BackendOptions {
  /** Absolute Node.js executable used for the source CLI. */
  nodeExecutable: string
  /** Absolute source or compiled entry of apps/cli. */
  cliEntry: string
  /** Whether the CLI entry needs the source-only tsx loader. */
  entryMode: 'source' | 'compiled'
  /** Working directory inherited by project operations. */
  cwd: string
  /** Parent environment; tests may isolate Harness homes through this value. */
  env: NodeJS.ProcessEnv
  /** Startup deadline, replaceable by focused tests. */
  startTimeoutMs?: number
  /** Graceful shutdown deadline, replaceable by focused tests. */
  stopTimeoutMs?: number
  /** Optional credential-free lifecycle log sink. */
  log?: (line: string) => void
}

/** Build the shell-free argv used for a source or compiled CLI entry. */
export function backendArguments(options: Pick<BackendOptions, 'cliEntry' | 'entryMode'>): string[] {
  return [
    ...options.entryMode === 'source' ? ['--import', 'tsx/esm'] : [],
    options.cliEntry,
    'desktop',
    '--port', '0',
  ]
}

/** How the supervised child stopped. */
export interface BackendExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/** A ready backend and the operation Electron owns. */
export interface BackendHandle {
  child: ChildProcess
  url: string
  exited: Promise<BackendExit>
  /** Request Cordis disposal, then escalate only when the child misses its deadline. */
  stop(): Promise<BackendExit>
}

/** Convert a settled CLI readiness line into the only URL Electron may load. */
export function readyUrlFromLine(line: string): string | undefined {
  const matched = READY_LINE.exec(line)?.[1]
  if (matched === undefined) return undefined
  const url = new URL(matched)
  const port = Number(url.port)
  if (url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.pathname !== '/'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535) return undefined
  return url.origin
}

/** Deliver complete lines without losing a final unterminated line. */
function readLines(stream: Readable, visit: (line: string) => void): void {
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    pending += chunk
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      visit(pending.slice(0, newline).replace(/\r$/u, ''))
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
    }
  })
  stream.once('end', () => {
    if (pending !== '') visit(pending.replace(/\r$/u, ''))
  })
}

/** Wait for one promise within the supervisor's bounded lifetime. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => { reject(new Error(message)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function isRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null
}

/** Terminate and join a child that never reached or completed graceful shutdown. */
async function terminateChild(child: ChildProcess, exited: Promise<BackendExit>): Promise<BackendExit> {
  if (!isRunning(child)) return { code: child.exitCode, signal: child.signalCode }
  child.kill('SIGTERM')
  try {
    return await withTimeout(exited, TERMINATE_TIMEOUT_MS, 'desktop backend did not exit after SIGTERM')
  } catch {
    if (isRunning(child)) child.kill('SIGKILL')
    return withTimeout(exited, TERMINATE_TIMEOUT_MS, 'desktop backend did not exit after SIGKILL')
  }
}

/** Launch the private desktop profile and resolve after its Loader-ready URL line. */
export async function startBackend(options: BackendOptions): Promise<BackendHandle> {
  const args = backendArguments(options)
  options.log?.(`backend spawn node=${options.nodeExecutable} entry=${options.cliEntry} mode=${options.entryMode} cwd=${options.cwd}`)
  const child = spawn(options.nodeExecutable, args, {
    cwd: options.cwd,
    env: { ...options.env, DSH_SUPERVISOR_IPC: '1' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  options.log?.(`backend spawned pid=${String(child.pid)}`)
  const exited = new Promise<BackendExit>((resolve) => {
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  const failed = new Promise<never>((_resolve, reject) => {
    child.once('error', reject)
  })

  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_192)
    process.stderr.write(chunk)
  })

  if (child.stdout === null) {
    await terminateChild(child, exited).catch(() => {})
    throw new Error('desktop backend: child stdout is unavailable')
  }
  let resolveReady: ((url: string) => void) | undefined
  const ready = new Promise<string>((resolve) => { resolveReady = resolve })
  readLines(child.stdout, (line) => {
    process.stdout.write(`${line}\n`)
    const url = readyUrlFromLine(line)
    if (url !== undefined) resolveReady?.(url)
  })

  let url: string
  try {
    url = await withTimeout(Promise.race([
      ready,
      failed,
      exited.then(({ code, signal }) => {
        const detail = stderr.trim() === '' ? '' : `\n${stderr.trim()}`
        throw new Error(`desktop backend exited before readiness (${String(code ?? signal)})${detail}`)
      }),
    ]), options.startTimeoutMs ?? START_TIMEOUT_MS, 'desktop backend did not become ready before its startup deadline')
  } catch (error) {
    await terminateChild(child, exited).catch(() => {})
    throw error
  }

  let stopping: Promise<BackendExit> | undefined
  return {
    child,
    url,
    exited,
    stop() {
      stopping ??= (async () => {
        if (!isRunning(child)) return exited
        if (child.connected) {
          try {
            child.send(SUPERVISOR_SHUTDOWN_MESSAGE)
          } catch {
            // The bounded signal fallback below owns a concurrently closed IPC channel.
          }
        }
        try {
          return await withTimeout(
            exited,
            options.stopTimeoutMs ?? STOP_TIMEOUT_MS,
            'desktop backend graceful shutdown timed out',
          )
        } catch {
          return terminateChild(child, exited)
        }
      })()
      return stopping
    },
  }
}
