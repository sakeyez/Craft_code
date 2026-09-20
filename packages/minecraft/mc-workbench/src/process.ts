/** Managed subprocess execution with incremental UTF-8 output and tree cancellation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { open } from 'node:fs/promises'

/**
 * Process arguments, cancellation and output callbacks for a single owned command.
 */
export interface ProcessOptions {
  cwd: string
  argv: string[]
  signal: AbortSignal
  env?: NodeJS.ProcessEnv
  output?: (text: string, stream: 'stdout' | 'stderr') => Promise<void>
  spawned?: (handle: SubprocessHandle) => void
  maxBytes?: number
}

/**
 * Execution provider used by desktop subprocesses or policy-controlled model shell commands.
 */
export type ProcessRunner = (
  options: ProcessOptions,
) => Promise<{ exitCode: number | null; text: string; truncated: boolean }>

/**
 * Resolves after process close and output drain; cancellation waits for the owned tree.
 * @param ctx - Host context providing the required capabilities.
 * @param options - Command identity, environment, output and cancellation callbacks.
 * @returns Resolves after process close and output drain; cancellation waits for the owned tree.
 */
export async function runProcess(
  ctx: Context,
  options: ProcessOptions,
): Promise<{ exitCode: number | null; text: string; truncated: boolean }> {
  const child = ctx.subprocess.spawn({
    argv: options.argv,
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    graceMs: 5000,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: options.maxBytes ?? 1024 * 1024, spill: { maxBytes: 256 * 1024 * 1024 } },
      stderr: { maxBytes: 1024 * 1024, spill: { maxBytes: 256 * 1024 * 1024 } },
    },
  })
  options.spawned?.(child)
  const offsets = { stdout: 0, stderr: 0 }
  let text = ''
  let truncated = false
  let pending = Promise.resolve()
  let outputError: unknown
  const drain = async (): Promise<void> => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const chunk = child.collected[stream]?.readFrom(offsets[stream])
      if (!chunk) continue
      let content = chunk.text
      if (chunk.lossy && chunk.spillPath) {
        const file = await open(chunk.spillPath, 'r')
        try {
          const bytes = Buffer.alloc(chunk.nextOffset - offsets[stream])
          const result = await file.read(bytes, 0, bytes.length, offsets[stream])
          if (result.bytesRead !== bytes.length) throw new Error('原始进程日志读取不完整。')
          content = bytes.toString('utf8')
        } finally {
          await file.close()
        }
      } else if (chunk.lossy) {
        truncated = true
        await options.output?.('[日志已截断，完整进程日志不可用。]\n', stream)
      }
      offsets[stream] = chunk.nextOffset
      if (content) {
        text += content
        if (Buffer.byteLength(text) > (options.maxBytes ?? 1024 * 1024)) {
          text = text.slice(-Math.floor((options.maxBytes ?? 1024 * 1024) / 4))
          truncated = true
        }
        await options.output?.(content, stream)
      }
    }
  }
  const timer = setInterval(() => {
    pending = pending.then(drain).catch((error: unknown) => {
      outputError = error
      child.terminate()
    })
  }, 100)
  try {
    const result = await child.done
    clearInterval(timer)
    await pending
    if (outputError)
      throw outputError instanceof Error ? outputError : new Error('进程输出写入失败。', { cause: outputError })
    await drain()
    if (options.signal.aborted) {
      child.terminate()
      await child.waitForExit()
      options.signal.throwIfAborted()
    }
    return { exitCode: result.exitCode, text, truncated }
  } finally {
    clearInterval(timer)
  }
}
