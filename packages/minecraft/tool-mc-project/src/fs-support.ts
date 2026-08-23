/** Bounded filesystem helpers shared by Minecraft detection and validation. */

import type { Context } from '@deepseek-ai/cordis'
import { posix } from 'node:path'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

const BINARY_SAMPLE_BYTES = 8_192
const MISSING_ERROR_CODES = new Set(['FS_NOT_FOUND', 'ENOENT', 'ENOTDIR'])
const ABORT_ERROR_CODES = new Set(['FS_ABORTED'])

/** Limits applied to bounded directory and file reads. */
export interface FsScanConfig {
  maxEntries: number
  maxFileBytes: number
}

/** Mutable scan budget shared by one bounded directory walk. */
export interface WalkState {
  entries: number
  warned: boolean
}

/** A text file read through the session filesystem provider. */
export interface TextFile {
  path: string
  text: string
}

/** A directory entry paired with its normalized path. */
export interface WalkedFile {
  path: string
  entry: FsDirEntry
}

/**
 * Resolve filesystem operations using the current session workspace.
 * @param exec - Tool execution carrying the workspace and cancellation signal.
 * @returns Provider resolve options for the current session.
 */
export function sessionResolveOptions(exec: ToolExecution): { cwd?: string; signal?: AbortSignal } {
  const cwd = exec.agent?.session.header.cwd
  return {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  }
}

/**
 * Return a provider error code without trusting unknown error structure.
 * @param error - Unknown provider failure.
 * @returns A string error code when present.
 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function hasErrorCode(error: unknown, codes: ReadonlySet<string>): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== undefined; depth++) {
    if (codes.has(errorCode(current) ?? '')) return true
    if (typeof current !== 'object' || current === null || !('cause' in current)) return false
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Return whether an error denotes an absent filesystem path.
 * @param error - Unknown provider failure.
 * @returns Whether the error identifies a missing path.
 */
export function isMissingError(error: unknown): boolean {
  return hasErrorCode(error, MISSING_ERROR_CODES)
}

/**
 * Return whether the current tool execution was cancelled.
 * @param error - Unknown provider failure.
 * @param signal - Optional tool cancellation signal.
 * @returns Whether cancellation is indicated by the signal or error.
 */
export function isAbortedError(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
    || hasErrorCode(error, ABORT_ERROR_CODES)
    || (error instanceof Error && error.name === 'AbortError')
}

function decodeBoundedText(bytes: Uint8Array, path: string): string {
  if (bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
    throw new FsError(`cannot read "${path}": binary file`, 'FS_NOT_TEXT')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new FsError(`cannot read "${path}": invalid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
  }
}

/**
 * Read a UTF-8 text file without exceeding the configured byte bound.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param target - Resolved file target.
 * @param config - Read-size limit.
 * @returns Decoded UTF-8 file contents.
 */
export async function readBoundedText(
  ctx: Context,
  exec: ToolExecution,
  target: FsTarget,
  config: Pick<FsScanConfig, 'maxFileBytes'>,
): Promise<string> {
  const bytes = await ctx.fs.readBytes(target, exec.signal, config.maxFileBytes)
  return decodeBoundedText(bytes, target.displayPath)
}

/**
 * Resolve and stat an optional path, treating only missing paths as absent.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative path.
 * @returns File target and metadata, or undefined for a missing path.
 */
export async function optionalStat(
  ctx: Context,
  exec: ToolExecution,
  path: string,
): Promise<{ target: FsTarget; type: FsDirEntry['type']; size?: number } | undefined> {
  try {
    const target = await ctx.fs.resolve(path, sessionResolveOptions(exec))
    const info = await ctx.fs.stat(target, exec.signal)
    if (info === undefined) return undefined
    return { target, type: info.type, ...info.size === undefined ? {} : { size: info.size } }
  } catch (error) {
    if (isMissingError(error)) return undefined
    throw error
  }
}

/**
 * Read an existing text file and append bounded-read diagnostics to warnings.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative display path.
 * @param target - Resolved file target.
 * @param size - Provider-reported file size.
 * @param config - Read-size limit.
 * @param warnings - Mutable warning output.
 * @returns Decoded file or undefined when it is skipped or unreadable.
 */
export async function readTextFile(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  target: FsTarget,
  size: number | undefined,
  config: Pick<FsScanConfig, 'maxFileBytes'>,
  warnings: string[],
): Promise<TextFile | undefined> {
  if (size !== undefined && size > config.maxFileBytes) {
    warnings.push(`${path}: skipped because file size ${size} exceeds maxFileBytes ${config.maxFileBytes}`)
    return undefined
  }
  try {
    return { path, text: await readBoundedText(ctx, exec, target, config) }
  } catch (error) {
    if (isAbortedError(error, exec.signal)) throw error
    if (errorCode(error) === 'FS_TOO_LARGE') {
      warnings.push(`${path}: skipped because content exceeds maxFileBytes ${config.maxFileBytes}`)
      return undefined
    }
    warnings.push(`${path}: could not read text (${error instanceof Error ? error.message : String(error)})`)
    return undefined
  }
}

/**
 * Read an optional path when it is a regular file.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative file path.
 * @param config - Read-size limit.
 * @param warnings - Mutable warning output.
 * @returns Decoded file or undefined when absent or not a regular file.
 */
export async function readOptionalText(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  config: Pick<FsScanConfig, 'maxFileBytes'>,
  warnings: string[],
): Promise<TextFile | undefined> {
  const stat = await optionalStat(ctx, exec, path)
  if (stat === undefined || stat.type !== 'file') return undefined
  return readTextFile(ctx, exec, path, stat.target, stat.size, config, warnings)
}

/**
 * List an optional directory, treating only missing directories as empty.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative directory path.
 * @returns Directory entries, or an empty list for a missing directory.
 */
export async function listOptionalDir(ctx: Context, exec: ToolExecution, path: string): Promise<FsDirEntry[]> {
  const stat = await optionalStat(ctx, exec, path)
  if (stat === undefined || stat.type !== 'directory') return []
  try {
    return await ctx.fs.listDir(stat.target, exec.signal)
  } catch (error) {
    if (isMissingError(error)) return []
    throw error
  }
}

/**
 * Walk files below a path while enforcing entry and text-read bounds.
 * @param ctx - Filesystem service context.
 * @param exec - Tool execution and cancellation signal.
 * @param path - Session-relative directory path.
 * @param state - Shared mutable traversal budget.
 * @param config - Entry and read-size limits.
 * @param warnings - Mutable warning output.
 * @param predicate - File selection predicate.
 * @returns Selected files with their provider entries.
 */
export async function walkFiles(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  state: WalkState,
  config: FsScanConfig,
  warnings: string[],
  predicate: (path: string, entry: FsDirEntry) => boolean,
): Promise<WalkedFile[]> {
  if (state.entries >= config.maxEntries) {
    if (!state.warned) {
      state.warned = true
      warnings.push(`directory scan stopped after maxEntries ${config.maxEntries}`)
    }
    return []
  }
  const entries = await listOptionalDir(ctx, exec, path)
  const out: WalkedFile[] = []
  for (const entry of entries) {
    state.entries++
    const child = posix.join(path, entry.name)
    if (entry.type === 'file' && predicate(child, entry)) out.push({ path: child, entry })
    if (entry.type === 'directory') {
      out.push(...await walkFiles(ctx, exec, child, state, config, warnings, predicate))
    }
    if (state.entries >= config.maxEntries) break
  }
  return out
}
