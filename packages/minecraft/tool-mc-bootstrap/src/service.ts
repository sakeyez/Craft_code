/** Host-only operation engine for deterministic Minecraft project creation. */

import { developmentEnvironment, saveDevelopmentEnvironment, ensureJava, networkFetch, networkJavaEnvironment, networkGradleArguments, isMinecraftNetworkFailure, automaticMinecraftNetwork } from '@deepseek-ai/dsh-mc-workbench'
import { createHash, randomUUID } from 'node:crypto'
import { access, chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  type BootstrapStartRequest, type CatalogEntry, type CatalogSnapshot,
  type OperationSnapshot, type OperationRpcRequest, type StartRpcResponse,
} from './types.ts'
import {
  isSha256, isValidDirectoryName, isValidModId, isValidModName, isValidPackageName, recordPayload,
  isCatalogEntry,
} from './validation.ts'
import { MinecraftCatalogResolver } from './catalog.ts'
import { projectFiles, wrapperFiles } from './template.ts'
import { gradleDistributionDownloadFailed, gradleFailureMessage } from './gradle-failure.ts'

const MAX_LOG_TAIL_BYTES = 32 * 1024
const BUILD_TIMEOUT_MS = 30 * 60 * 1000
const CONNECT_TIMEOUT_MS = 10 * 1000
const READ_TIMEOUT_MS = 120 * 1000
const LOG_IO_TIMEOUT_MS = 10 * 1000
const PROCESS_KILL_TIMEOUT_MS = 10 * 1000
/** Refuse to read unexpectedly large deterministic inputs into memory. */
const MAX_GENERATED_FILE_BYTES = 16 * 1024 * 1024
const STAGING_MARKER = '.dsh/bootstrap-state.json'

interface BootstrapHostContext extends Context {
  readonly connection: {
    readonly rpc: {
      handle(channel: string, handler: MinecraftBootstrapService['handleRpc'], options: { authority: 'loopback' }): () => Promise<void>
    }
  }
}

/** Injectable seams for deterministic unit tests. */
export interface BootstrapServiceOptions {
  readonly prepareJava?: (
    major: number, signal: AbortSignal, progress: (text: string) => Promise<void>,
  ) => Promise<{ available: boolean; version: number; executable?: string }>
  readonly catalog?: MinecraftCatalogResolver
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  readonly now?: () => Date
  readonly build?: (
    projectPath: string,
    entry: CatalogEntry,
    signal: AbortSignal,
    append: (text: string) => Promise<void>,
    javaExecutable: string,
  ) => Promise<void>
  readonly wrapperJar?: (
    version: string,
    destination: string,
    signal: AbortSignal,
    append: (text: string) => Promise<void>,
  ) => Promise<void>
  /** Application-owned cache root for wrapper jars and Gradle user home. */
  readonly cacheDirectory?: string
}

/** Host service face, useful to trusted in-process consumers and tests. */
export interface MinecraftBootstrap {
  /**
   * Read the supported release catalog and local Java facts.
   * @param signal - Caller-owned cancellation signal.
   * @returns Current catalog entries and environment availability.
   */
  catalog(signal?: AbortSignal): Promise<CatalogSnapshot>
  /**
   * Create a project and retain its preparation/build operation.
   * @param request - Project identity, destination and catalog selection.
   * @param signal - Caller-owned cancellation signal.
   * @returns Identifier for polling and cancellation.
   */
  start(request: BootstrapStartRequest, signal?: AbortSignal): Promise<StartRpcResponse>
  /**
   * Read the current or retained bootstrap operation.
   * @param operationId - Identifier returned by start.
   * @returns Latest snapshot, or undefined for an unknown operation.
   */
  status(operationId: string): OperationSnapshot | undefined
  /**
   * Request cancellation of the selected bootstrap operation.
   * @param operationId - Identifier returned by start.
   * @returns Whether an active operation received cancellation.
   */
  cancel(operationId: string): boolean
}

interface Operation {
  readonly controller: AbortController
  readonly state: { snapshot: OperationSnapshot }
  done?: Promise<void>
}

interface BootstrapStateFile {
  readonly format: 2
  readonly operationId: string
  readonly entryId: string
  readonly requestFingerprint: string
  readonly generatedHashes: Record<string, string>
  readonly finalPath: string
}

/** Build the host service and register the loopback RPC channel. */
export function applyBootstrapService(ctx: Context, options: BootstrapServiceOptions = {}): void {
  const prepareJava: BootstrapServiceOptions['prepareJava'] = ctx.get('subprocess')
    ? async (major, signal, progress) => {
      const java = await ensureJava(ctx, major, signal, progress)
      return { available: java.available, version: java.major, ...(java.executable ? { executable: java.executable } : {}) }
    }
    : undefined
  const service = new MinecraftBootstrapService(ctx, { ...options, ...(prepareJava ? { prepareJava } : {}) })
  ctx.provide('minecraftBootstrap', service)
  const host = ctx as BootstrapHostContext
  ctx.effect(() => host.connection.rpc.handle('/mc-bootstrap', service.handleRpc, { authority: 'loopback' }), 'minecraft-bootstrap: rpc')
  ctx.effect(() => async () => { await service.dispose() }, 'minecraft-bootstrap: dispose')
}

/** Stateful host implementation. */
export class MinecraftBootstrapService implements MinecraftBootstrap {
  private readonly resolver: MinecraftCatalogResolver
  private readonly now: () => Date
  private readonly operations = new Map<string, Operation>()
  private activeOperation: string | undefined
  private disposed = false
  private readonly options: BootstrapServiceOptions
  private readonly cacheDirectory: string

  constructor(private readonly ctx: Context, options: BootstrapServiceOptions = {}) {
    this.options = options
    this.now = options.now ?? (() => new Date())
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    this.cacheDirectory = resolve(options.cacheDirectory ?? join(home, 'cache', 'minecraft-bootstrap'))
    this.resolver = options.catalog ?? new MinecraftCatalogResolver({
      now: this.now,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })
  }

  catalog(signal?: AbortSignal): Promise<CatalogSnapshot> {
    const network = this.ctx.get('minecraftWorkbench')?.network
    return network ? network.run(() => this.resolver.load(signal)) : this.resolver.load(signal)
  }

  async start(request: BootstrapStartRequest, signal?: AbortSignal): Promise<StartRpcResponse> {
    if (this.disposed) throw new Error('bootstrap service is disposed')
    if (this.activeOperation !== undefined) throw new Error('another Minecraft project is already being built')
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')

    // Return before refreshing the online catalog.  Catalog requests can take
    // seconds, while the caller's start RPC is intentionally short-lived;
    // explicit cancellation is handled by the cancel endpoint instead of
    // inheriting that request's AbortSignal.
    validateStartRequest(request)
    const operationId = randomUUID()
    const controller = new AbortController()
    const initial: OperationSnapshot = {
      operationId, status: 'queued', stage: 'validate', progress: 0,
      logTail: '', updatedAt: this.now().toISOString(),
    }
    const state = { snapshot: initial }
    const operation: Operation = { controller, state }
    this.operations.set(operationId, operation)
    this.activeOperation = operationId
    this.publish(state.snapshot)
    const network = this.ctx.get('minecraftWorkbench')?.network
    const done = network ? network.run(() => this.run(operation, request)) : this.run(operation, request)
    operation.done = done
    void done.catch((error: unknown) => {
      this.fail(operation, 'internal', error instanceof Error ? error.message : String(error))
    })
    // Keep the public method Promise-shaped without yielding before the lock
    // is installed (which would permit two concurrent starts).
    await Promise.resolve()
    return { operationId }
  }

  status(operationId: string): OperationSnapshot | undefined {
    return this.operations.get(operationId)?.state.snapshot
  }

  cancel(operationId: string): boolean {
    const operation = this.operations.get(operationId)
    if (operation === undefined || operation.controller.signal.aborted
      || ['ready', 'failed', 'cancelled'].includes(operation.state.snapshot.status)) return false
    operation.controller.abort(new Error('operation cancelled by user'))
    // Keep the operation non-terminal until the build subprocess and its
    // children are gone. This preserves the one-operation lock while Gradle
    // may still hold files in the staging directory.
    this.update(operation, { message: '正在取消并清理进程' })
    return true
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const operation of this.operations.values()) {
      if (isTerminal(operation.state.snapshot.status)) continue
      operation.controller.abort(new Error('host shutting down'))
      this.update(operation, { message: '宿主正在关闭' })
    }
    await Promise.all([...this.operations.values()].map(operation => operation.done ?? Promise.resolve()))
  }

  /** RPC adapter used by HostConnectionService after envelope validation. */
  readonly handleRpc = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> => {
    const network = this.ctx.get('minecraftWorkbench')?.network
    return network ? network.run(() => this.dispatchRpc(endpoint, payload, signal)) : this.dispatchRpc(endpoint, payload, signal)
  }

  private async dispatchRpc(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult<unknown>> {
    try {
      if (endpoint === 'catalog-cache') return { ok: true, value: await this.resolver.cached() ?? null }
      if (endpoint === 'catalog') return { ok: true, value: await this.catalog(signal) }
      if (endpoint === 'start') return { ok: true, value: await this.start(parseStartPayload(payload), signal) }
      if (endpoint === 'status') {
        const id = parseOperationPayload(payload).operationId
        const snapshot = this.status(id)
        if (snapshot === undefined) return errorResult(`unknown operation ${id}`)
        return { ok: true, value: snapshot }
      }
      if (endpoint === 'cancel') {
        const id = parseOperationPayload(payload).operationId
        return { ok: true, value: { cancelled: this.cancel(id), snapshot: this.status(id) } }
      }
      return badRequestResult(`unknown mc-bootstrap endpoint ${endpoint}`)
    } catch (error) {
      return rpcErrorResult(error)
    }
  }

  private async run(operation: Operation, request: BootstrapStartRequest): Promise<void> {
    const { controller } = operation
    let staging: string | undefined
    try {
      controller.signal.throwIfAborted()
      this.update(operation, { status: 'running', stage: 'validate', progress: 2, message: '正在检查保存位置' })
      const catalog = await this.resolver.load(controller.signal, false)
      controller.signal.throwIfAborted()
      const entry = catalog.entries.find(candidate => candidate.entryId === request.entryId)
      if (entry === undefined || !isCatalogEntry(entry)) {
        throw bootstrapError('catalog-entry-unavailable', catalog.error ?? 'selected Minecraft version is no longer available; refresh the catalog')
      }
      this.update(operation, { entry, ...(catalog.cached ? { message: '使用缓存版本目录' } : {}) })
      // Check the exact required JDK before creating a staging directory or
      // touching any project files.  A failed environment gate must leave no
      // partial tree behind for the user to clean up.
      this.update(operation, { stage: 'java', progress: 8, message: `需要 JDK ${entry.requiredJdk}` })
      const java = this.options.prepareJava
        ? await this.options.prepareJava(entry.requiredJdk, controller.signal, (text) => {
          this.update(operation, { message: text.trim(), logTail: (operation.state.snapshot.logTail + text).slice(-8000) })
          return Promise.resolve()
        }) : catalog.java
      if (!java.available || java.version !== entry.requiredJdk
        || typeof java.executable !== 'string' || !isAbsolute(java.executable)) {
        throw bootstrapError('jdk-mismatch', `需要 JDK ${entry.requiredJdk}，当前 Java ${java.version ?? '不可用'}`)
      }
      controller.signal.throwIfAborted()
      const parent = await canonicalDirectory(request.parentDirectory)
      const finalPath = await validateTarget(parent, request.directoryName)
      const files = { ...projectFiles({ ...request, entry }), ...wrapperFiles(entry.gradleVersion, entry.gradleSha256) }
      const expectedHashes: Record<string, string> = Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, sha256(Buffer.from(content, 'utf8'))]),
      )
      expectedHashes['gradle/wrapper/gradle-wrapper.jar'] = entry.wrapperSha256
      const requestFingerprint = bootstrapRequestFingerprint(request, entry, finalPath)
      let resumable: ResumableStaging | undefined
      try {
        resumable = await findResumableStaging(
          parent, finalPath, entry.entryId, requestFingerprint, expectedHashes, entry.loader,
        )
      } catch (error) {
        // Keep the modified staging path in the snapshot so the user can
        // inspect it instead of losing the only pointer to their files.
        const candidate = stagingPathFromError(error)
        if (candidate !== undefined) staging = candidate
        throw error
      }
      staging = resumable?.path ?? `${finalPath}.dsh-staging-${operation.state.snapshot.operationId}`
      if (resumable === undefined) {
        await assertAbsent(staging)
        await createStaging(staging)
        // Install the marker before the first generated file.  A cancellation
        // during generation must leave an inspectable staging tree even when
        // the complete hash set has not been written yet.
        await writeState(staging, {
          format: 2,
          operationId: operation.state.snapshot.operationId,
          entryId: entry.entryId,
          requestFingerprint,
          generatedHashes: {},
          finalPath: resolve(finalPath),
        })
      }
      const append = this.logger(staging, operation)
      await append(`Minecraft bootstrap ${operation.state.snapshot.operationId}\n`)

      this.update(operation, { stage: 'generate', progress: 18, message: '正在生成项目文件' })
      // A marker is installed before generation starts, and is updated after
      // every file.  That makes an interrupted generation resumable while
      // still refusing to overwrite a file that a user changed in staging.
      const generatedHashes: Record<string, string> = { ...(resumable?.state.generatedHashes ?? {}) }
      for (const [path, content] of Object.entries(files)) {
        controller.signal.throwIfAborted()
        const target = safeJoin(staging, path)
        const expected = sha256(Buffer.from(content, 'utf8'))
        if (generatedHashes[path] !== undefined) {
          if (generatedHashes[path] !== expected || !await generatedFileMatches(staging, path, expected)) {
            throw stagingModified(staging, '上次失败的临时项目已被修改，不能自动续跑')
          }
          continue
        }
        await ensureDirectoryTree(staging, dirname(target))
        const existing = await lstat(target).catch(() => undefined)
        if (existing !== undefined) {
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw stagingModified(staging, `生成文件路径不可用: ${path}`)
          }
          const actual = sha256(await readFile(target))
          if (actual !== expected) throw stagingModified(staging, `生成文件已被修改: ${path}`)
        } else {
          await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
        }
        generatedHashes[path] = expected
        await updateState(staging, {
          format: 2,
          operationId: operation.state.snapshot.operationId,
          entryId: entry.entryId,
          requestFingerprint,
          generatedHashes,
          finalPath,
        })
      }
      await chmod(join(staging, 'gradlew'), 0o755).catch(() => {})
      await updateState(staging, {
        format: 2,
        operationId: operation.state.snapshot.operationId,
        entryId: entry.entryId,
        requestFingerprint,
        generatedHashes,
        finalPath,
      })

      this.update(operation, { stage: 'gradle-download', progress: 30, message: '正在准备 Gradle Wrapper' })
      if (this.options.wrapperJar === undefined || this.options.build === undefined) {
        await ensureSafeCacheDirectory(this.cacheDirectory, [staging, finalPath])
      }
      const jar = join(staging, 'gradle/wrapper/gradle-wrapper.jar')
      await this.ensureWrapperJar(
        entry.gradleVersion,
        jar,
        controller.signal,
        append,
        entry.wrapperSha256,
      )
      // Record the wrapper in the marker on both fresh and resumed runs.  A
      // resumed operation may have downloaded it after the previous marker
      // write; omitting it would let a later retry silently accept a modified
      // wrapper jar.
      generatedHashes['gradle/wrapper/gradle-wrapper.jar'] = sha256(await readFile(jar))
      await updateState(staging, {
        format: 2,
        operationId: operation.state.snapshot.operationId,
        entryId: entry.entryId,
        requestFingerprint,
        generatedHashes,
        finalPath: resolve(finalPath),
      })
      this.update(operation, { stage: 'dependencies', progress: 48, message: '正在解析依赖' })
      await append('Resolving dependencies with mirror-first repositories; official fallback is enabled.\n')
      this.update(operation, { stage: 'build', progress: 62, message: '正在执行首次 build' })
      const build = this.options.build
        ?? ((path: string, selected: CatalogEntry, buildSignal: AbortSignal,
          log: (text: string) => Promise<void>, javaExecutable: string) => runGradleBuild(
          path, selected, buildSignal, log, this.cacheDirectory, javaExecutable,
        ))
      await build(staging, entry, controller.signal, append, java.executable)
      controller.signal.throwIfAborted()
      await assertStagingTree(staging, expectedHashes, true, entry.loader)
      // Refresh the marker immediately before the commit check.  This closes
      // the normal crash window where the wrapper hash was written after the
      // last per-file checkpoint, and leaves the committed tree with a
      // complete, current resume record.
      await updateState(staging, {
        format: 2,
        operationId: operation.state.snapshot.operationId,
        entryId: entry.entryId,
        requestFingerprint,
        generatedHashes,
        finalPath: resolve(finalPath),
      })
      await assertStagingTree(staging, expectedHashes, true, entry.loader)

      this.update(operation, { stage: 'finalize', progress: 92, message: '正在提交项目目录' })
      await assertNoSymlinkComponents(parent)
      await assertAbsent(finalPath)
      await rename(staging, finalPath)
      staging = undefined
      this.update(operation, { status: 'ready', stage: 'done', progress: 100, projectPath: finalPath, message: '构建成功' })
    } catch (error) {
      const cancelled = operation.controller.signal.aborted || isAbort(error)
      let message = error instanceof Error ? error.message : String(error)
      if (staging !== undefined) {
        try {
          await appendStateLog(staging, `FAILED: ${message}\n`)
        } catch (logError) {
          message += `（完整日志写入失败：${logError instanceof Error ? logError.message : String(logError)}）`
        }
      }
      // Terminal state permits immediate retry, so publish it only after log cleanup.
      if (cancelled) {
        this.update(operation, { status: 'cancelled', message: '已取消', ...(staging === undefined ? {} : { projectPath: staging }) })
      } else {
        this.fail(operation, errorCode(error), message, staging)
      }
    } finally {
      if (this.activeOperation === operation.state.snapshot.operationId) this.activeOperation = undefined
    }
  }

  private logger(staging: string, operation: Operation): (text: string) => Promise<void> {
    const path = join(staging, '.dsh/bootstrap.log')
    return async (text) => {
      if (await containsSymlink(staging, path)) throw bootstrapError('staging-modified', '日志路径不能包含符号链接')
      await withIoTimeout(ensureDirectoryTree(staging, dirname(path)), LOG_IO_TIMEOUT_MS, '日志目录准备超时')
      await withIoTimeout(writeFile(path, text, { encoding: 'utf8', flag: 'a' }), LOG_IO_TIMEOUT_MS, '日志写入超时')
      const next = `${operation.state.snapshot.logTail}${text}`
      const tail = boundedUtf8Tail(next, MAX_LOG_TAIL_BYTES)
      this.update(operation, { logTail: tail })
    }
  }

  private async ensureWrapperJar(
    version: string,
    destination: string,
    signal: AbortSignal,
    append: (text: string) => Promise<void>,
    expectedSha256?: string,
  ): Promise<void> {
    if (await access(destination, fsConstants.F_OK).then(() => true, () => false)) {
      await verifyWrapper(destination, expectedSha256, dirname(dirname(dirname(destination))))
      await append('Existing Gradle Wrapper is intact; resuming the staged operation.\n')
      return
    }
    if (this.options.wrapperJar !== undefined) {
      await this.options.wrapperJar(version, destination, signal, append)
      await verifyWrapper(destination, expectedSha256, dirname(dirname(dirname(destination))))
      return
    }
    const cachedJar = join(this.cacheDirectory, 'wrappers', `gradle-${version}-wrapper.jar`)
    if (await access(cachedJar, fsConstants.F_OK).then(() => true, () => false)) {
      try {
        await verifyWrapper(cachedJar, expectedSha256, this.cacheDirectory)
        await ensureDirectoryTree(dirname(dirname(dirname(destination))), dirname(destination))
        await copyFile(cachedJar, destination, fsConstants.COPYFILE_EXCL)
        await verifyWrapper(destination, expectedSha256, dirname(dirname(dirname(destination))))
        await append('Gradle Wrapper loaded from the application cache.\n')
        return
      } catch (error) {
        if (isAbort(error)) throw error
        // A stale or tampered cache entry is not used.  Keep it in place for
        // diagnostics and fetch a fresh, checksummed copy below.
        await append('Cached Gradle Wrapper is invalid; downloading a fresh copy.\n')
      }
    }
    // Gradle does not publish a `*-wrapper.jar` beside its distribution zips;
    // use the version-pinned official source tree for the small wrapper binary.
    // The generated wrapper properties still resolve the much larger Gradle
    // distribution through Tencent first, then the official distribution URL.
    const urls = [
      `https://raw.githubusercontent.com/gradle/gradle/v${version}/gradle/wrapper/gradle-wrapper.jar`,
      `https://github.com/gradle/gradle/raw/v${version}/gradle/wrapper/gradle-wrapper.jar`,
    ]
    let lastError: unknown
    for (const [index, url] of urls.entries()) {
      try {
        const response = await fetchResponseBytes(url, signal, this.options.fetch)
        if (!response.response.ok) throw new Error(`wrapper download failed (${response.response.status})`)
        if (response.bytes.length === 0) throw bootstrapError('wrapper-invalid', 'Gradle Wrapper 下载内容为空')
        if (expectedSha256 !== undefined && sha256(response.bytes) !== expectedSha256) {
          throw bootstrapError('checksum-mismatch', 'Gradle Wrapper 校验和不匹配')
        }
        await ensureDirectoryTree(dirname(dirname(dirname(destination))), dirname(destination))
        await writeFile(destination, response.bytes, { flag: 'wx' })
        await writeCachedWrapper(this.cacheDirectory, cachedJar, response.bytes)
        await append(index === 0
          ? 'Gradle Wrapper downloaded from the official Gradle source tree.\n'
          : 'Gradle Wrapper downloaded from the official Gradle source fallback.\n')
        return
      } catch (error) {
        if (isAbort(error)) throw error
        lastError = error
        // A bad mirror is not authoritative; try the official bytes before
        // surfacing a checksum/download failure to the caller.
      }
    }
    if (errorCode(lastError) === 'checksum-mismatch' || errorCode(lastError) === 'wrapper-invalid') throw lastError
    throw bootstrapError('wrapper-download', `Gradle Wrapper 下载失败: ${String(lastError)}`)
  }

  private update(operation: Operation, patch: Partial<OperationSnapshot>): void {
    const currentStatus = operation.state.snapshot.status
    // A cancellation/failure is terminal.  Late output from a child process
    // must not move the operation back to running or ready.
    if (isTerminal(currentStatus) && patch.status !== currentStatus) return
    operation.state.snapshot = { ...operation.state.snapshot, ...patch, updatedAt: this.now().toISOString() }
    this.publish(operation.state.snapshot)
  }

  private fail(operation: Operation, failureCode: string, message: string, staging?: string): void {
    if (isTerminal(operation.state.snapshot.status)) return
    this.update(operation, {
      status: 'failed', failureCode, message, ...(staging === undefined ? {} : { projectPath: staging }),
    })
  }

  private publish(snapshot: OperationSnapshot): void {
    try { this.ctx.emit('minecraft-bootstrap/progress', snapshot) } catch { /* event delivery is best effort */ }
  }
}

function validateStartRequest(request: unknown): asserts request is BootstrapStartRequest {
  const row = recordPayload(request)
  if (row === undefined) throw bootstrapError('bad-request', 'start payload must be an object')
  const fields = ['entryId', 'parentDirectory', 'directoryName', 'modName', 'modId', 'packageName'] as const
  if (Object.keys(row).some(key => !(fields as readonly string[]).includes(key))) {
    throw bootstrapError('bad-request', 'start payload contains an unsupported field')
  }
  if (fields.some(field => typeof row[field] !== 'string')) {
    throw bootstrapError('bad-request', 'start payload fields must be strings')
  }
  const entryId = row.entryId as string
  const parentDirectory = row.parentDirectory as string
  const directoryName = row.directoryName as string
  const modName = row.modName as string
  const modId = row.modId as string
  const packageName = row.packageName as string
  if (entryId.length < 1 || entryId.length > 256 || /[\u0000-\u001f\u007f]/u.test(entryId)) {
    throw bootstrapError('invalid-entry', '版本条目标识无效')
  }
  if (parentDirectory.length < 1 || parentDirectory.length > 32_000 || !isAbsolute(parentDirectory)) throw bootstrapError('invalid-path', '保存位置必须是绝对路径')
  if (!isValidDirectoryName(directoryName)) throw bootstrapError('invalid-directory', '项目目录名无效')
  if (!isValidModName(modName)) throw bootstrapError('invalid-mod-name', '模组名称无效')
  if (!isValidModId(modId)) throw bootstrapError('invalid-mod-id', 'modId 必须是小写字母、数字和下划线')
  if (!isValidPackageName(packageName)) throw bootstrapError('invalid-package', 'Java 包名无效')
}

async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw bootstrapError('invalid-path', '保存位置必须是绝对路径')
  await assertNoSymlinkComponents(path)
  const info = await lstat(path).catch(() => undefined)
  if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) throw bootstrapError('invalid-path', '保存位置不是可用的真实目录')
  return realpath(path)
}

async function validateTarget(parent: string, name: string): Promise<string> {
  const target = resolve(parent, name)
  const rel = relative(parent, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw bootstrapError('path-escape', '项目路径越界')
  await assertNoSymlinkComponents(target)
  const info = await lstat(target).catch(() => undefined)
  if (info !== undefined) {
    if (info.isSymbolicLink()) throw bootstrapError('target-symlink', '目标目录不能是符号链接')
    if (!info.isDirectory()) throw bootstrapError('target-exists', '目标路径已存在且不是目录')
    const children = await readdir(target)
    if (children.length > 0) throw bootstrapError('target-nonempty', '目标目录必须为空')
    throw bootstrapError('target-exists', '目标目录已存在')
  }
  return target
}

async function assertAbsent(path: string): Promise<void> {
  if (await lstat(path).catch(() => undefined) !== undefined) throw bootstrapError('target-exists', '目标或 staging 目录已存在')
}

/** Create a staging root without following a pre-existing symlink. */
async function createStaging(path: string): Promise<void> {
  await assertNoSymlinkComponents(path)
  try {
    await mkdir(path, { recursive: false })
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST') {
      throw bootstrapError('target-exists', '目标或 staging 目录已存在')
    }
    throw error
  }
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw bootstrapError('staging-symlink', 'staging 目录不能是符号链接')
  const stateDirectory = join(path, '.dsh')
  await mkdir(stateDirectory, { recursive: false })
  const stateInfo = await lstat(stateDirectory)
  if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()) throw bootstrapError('staging-symlink', '状态目录不能是符号链接')
}

interface ResumableStaging {
  readonly path: string
  readonly state: BootstrapStateFile
}

/** Find a previous failed staging tree, but never resume one the user edited. */
async function findResumableStaging(
  parent: string,
  finalPath: string,
  entryId: string,
  requestFingerprint: string,
  expectedHashes: Readonly<Record<string, string>>,
  loader: CatalogEntry['loader'],
): Promise<ResumableStaging | undefined> {
  const prefix = `${finalPath}.dsh-staging-`
  let found: ResumableStaging | undefined
  for (const item of await readdir(parent, { withFileTypes: true })) {
    const candidate = join(parent, item.name)
    const suffix = candidate.startsWith(prefix) ? candidate.slice(prefix.length) : ''
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(suffix)) continue
    const info = await lstat(candidate).catch(() => undefined)
    if (info?.isSymbolicLink()) {
      const error = bootstrapError('staging-symlink', 'staging 目录不能是符号链接')
      ;(error as Error & { stagingPath?: string }).stagingPath = candidate
      throw error
    }
    if (info === undefined || !info.isDirectory()) continue
    const state = await readBootstrapState(candidate)
    if (state === undefined) throw stagingModified(candidate, 'staging 状态标记缺失或损坏，不能自动续跑')
    if (resolve(state.finalPath) !== resolve(finalPath)) continue
    if (state.entryId !== entryId || state.requestFingerprint !== requestFingerprint) {
      throw stagingModified(candidate, 'staging 与本次搭建参数不同，不能自动续跑')
    }
    const markerMatchesRecipe = Object.entries(state.generatedHashes)
      .every(([path, hash]) => expectedHashes[path] === hash)
    if (!await generatedFilesMatch(candidate, state.generatedHashes)) {
      const error = bootstrapError('staging-modified', '上次失败的临时项目已被修改，不能自动续跑')
      ;(error as Error & { stagingPath?: string }).stagingPath = candidate
      throw error
    }
    try {
      await assertStagingTree(candidate, markerMatchesRecipe ? expectedHashes : state.generatedHashes, false, loader)
    } catch (error) {
      if (errorCode(error) === 'staging-modified') {
        ;(error as Error & { stagingPath?: string }).stagingPath = candidate
      }
      throw error
    }
    // Preserve verified older templates; a fresh staging tree uses the current recipe.
    if (!markerMatchesRecipe) continue
    if (found !== undefined) throw stagingModified(candidate, '存在多个可续跑的 staging，不能安全选择')
    found = { path: candidate, state }
  }
  return found
}

async function readBootstrapState(staging: string): Promise<BootstrapStateFile | undefined> {
  try {
    const marker = join(staging, STAGING_MARKER)
    if (await containsSymlink(staging, marker)) return undefined
    const markerInfo = await lstat(marker)
    if (!markerInfo.isFile() || markerInfo.size > 256 * 1024) return undefined
    const parsed = JSON.parse(await readFile(marker, 'utf8')) as Partial<BootstrapStateFile>
    const hashes = parsed.generatedHashes
    const paths = hashes === undefined || typeof hashes !== 'object' || Array.isArray(hashes)
      ? [] : Object.keys(hashes)
    const foldedPaths = new Set(paths.map(path => path.toLowerCase()))
    if (parsed.format !== 2 || typeof parsed.operationId !== 'string' || parsed.operationId.length < 1
      || typeof parsed.entryId !== 'string' || parsed.entryId.length < 1
      || !isSha256(parsed.requestFingerprint)
      || typeof parsed.finalPath !== 'string' || !isAbsolute(parsed.finalPath)
      || hashes === undefined || typeof hashes !== 'object' || Array.isArray(hashes)
      || foldedPaths.size !== paths.length
      || Object.entries(hashes).some(([path, hash]) => !isManifestPath(path) || !isSha256(hash))) return undefined
    return parsed as BootstrapStateFile
  } catch { return undefined }
}

function isManifestPath(path: string): boolean {
  return path.length > 0 && path.length <= 512 && !isAbsolute(path) && !path.includes('\\')
    && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
    && path !== '.dsh' && !path.startsWith('.dsh/')
}

function bootstrapRequestFingerprint(request: BootstrapStartRequest, entry: CatalogEntry, finalPath: string): string {
  return sha256(Buffer.from(JSON.stringify([
    1,
    entry.entryId,
    resolve(finalPath),
    request.directoryName,
    request.modName,
    request.modId,
    request.packageName,
  ]), 'utf8'))
}

async function generatedFilesMatch(staging: string, hashes: Record<string, string>): Promise<boolean> {
  for (const [path, expected] of Object.entries(hashes)) {
    try {
      const target = safeJoin(staging, path)
      if (await containsSymlink(staging, target)) return false
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_GENERATED_FILE_BYTES) return false
      const bytes = await readFile(target)
      if (sha256(bytes) !== expected) return false
    } catch { return false }
  }
  return true
}

async function generatedFileMatches(staging: string, path: string, expected: string): Promise<boolean> {
  try {
    const target = safeJoin(staging, path)
    if (await containsSymlink(staging, target)) return false
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_GENERATED_FILE_BYTES) return false
    return sha256(await readFile(target)) === expected
  } catch { return false }
}

/**
 * Reject files that are neither deterministic inputs nor known Gradle output.
 * An interrupted write may leave a not-yet-recorded template file, so retry
 * accepts any present input only when it matches the complete expected recipe.
 */
async function assertStagingTree(
  staging: string,
  expectedHashes: Readonly<Record<string, string>>,
  requireComplete: boolean,
  loader: CatalogEntry['loader'],
): Promise<void> {
  const allowedInternalFiles = new Set([STAGING_MARKER, '.dsh/bootstrap.log', '.dsh/environment.json', '.dsh/environment.json.tmp'])
  // NeoGradle's build task writes JUnit launch arguments outside build/.
  if (loader === 'neoforge') {
    allowedInternalFiles.add('runs/junit/junit_jvm_args.txt')
    allowedInternalFiles.add('runs/junit/junit_test_args.txt')
  }
  const normalize = (path: string): string => path.split(sep).join('/')
  const rootInfo = await lstat(staging).catch(() => undefined)
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw stagingModified(staging, 'staging 根目录不可用或已被替换')
  }
  const visit = async (directory: string): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, item.name)
      const relativePath = normalize(relative(staging, target))
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw stagingModified(staging, `staging 不能包含符号链接: ${relativePath}`)
      if (info.isDirectory()) {
        const knownAncestor = Object.keys(expectedHashes).some(path => path.startsWith(`${relativePath}/`))
          || [...allowedInternalFiles].some(path => path.startsWith(`${relativePath}/`))
        const generatedOutput = relativePath === '.gradle' || relativePath.startsWith('.gradle/')
          || relativePath === 'build' || relativePath.startsWith('build/')
          || relativePath === '.dsh'
        if (!knownAncestor && !generatedOutput) {
          throw stagingModified(staging, `staging 包含未授权目录: ${relativePath}`)
        }
        await visit(target)
        continue
      }
      if (!info.isFile()) throw stagingModified(staging, `staging 包含不支持的文件类型: ${relativePath}`)
      const expected = expectedHashes[relativePath]
      if (expected !== undefined) {
        if (info.size > MAX_GENERATED_FILE_BYTES
          || sha256(await readFile(target)) !== expected) throw stagingModified(staging, `生成文件已被修改: ${relativePath}`)
        continue
      }
      const generatedOutput = relativePath.startsWith('.gradle/') || relativePath.startsWith('build/')
      if (!allowedInternalFiles.has(relativePath) && !generatedOutput) {
        throw stagingModified(staging, `staging 包含未授权文件: ${relativePath}`)
      }
    }
  }
  await visit(staging)
  if (requireComplete) {
    for (const [path, expected] of Object.entries(expectedHashes)) {
      if (!await generatedFileMatches(staging, path, expected)) {
        throw stagingModified(staging, `生成文件缺失或已被修改: ${path}`)
      }
    }
  }
}

function stagingModified(staging: string, message: string): Error & { code: string; stagingPath: string } {
  const error = bootstrapError('staging-modified', message) as Error & { code: string; stagingPath: string }
  error.stagingPath = staging
  return error
}

/** Reject a generated file if any path component was replaced by a symlink. */
async function containsSymlink(root: string, target: string): Promise<boolean> {
  const rootInfo = await lstat(root).catch(() => undefined)
  if (rootInfo === undefined || rootInfo.isSymbolicLink()) return true
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return true
  let current = root
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component)
    const info = await lstat(current).catch(() => undefined)
    if (info === undefined) return false
    if (info.isSymbolicLink()) return true
  }
  return false
}

/**
 * Check every existing component of an absolute path without resolving it.
 * `realpath()` alone is insufficient here: it follows a link and would make
 * a user-selected parent appear to be inside the requested directory.  The
 * check stops at the first missing component, which is safe for a path that
 * will subsequently be created one component at a time by
 * {@link ensureDirectoryTree}.
 */
async function assertNoSymlinkComponents(path: string): Promise<void> {
  if (!isAbsolute(path)) throw bootstrapError('invalid-path', '路径必须是绝对路径')
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  const parts = relative(root, absolute).split(sep).filter(Boolean)
  for (const part of parts) {
    current = join(current, part)
    const info = await lstat(current).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined
      throw error
    })
    if (info === undefined) return
    if (info.isSymbolicLink()) throw bootstrapError('path-symlink', `路径不能经过符号链接: ${current}`)
  }
}

/** Create an existing-or-new directory below a verified staging root. */
async function ensureDirectoryTree(root: string, directory: string): Promise<void> {
  const absoluteRoot = resolve(root)
  const absoluteDirectory = resolve(directory)
  const rel = relative(absoluteRoot, absoluteDirectory)
  if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw bootstrapError('template-escape', '模板目录越界')
  }
  const rootInfo = await lstat(absoluteRoot).catch(() => undefined)
  if (rootInfo === undefined || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw bootstrapError('staging-modified', 'staging 根目录不可用')
  }
  let current = absoluteRoot
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part)
    const info = await lstat(current).catch(() => undefined)
    if (info === undefined) {
      try { await mkdir(current, { recursive: false }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
      }
    }
    const after = await lstat(current).catch(() => undefined)
    if (after === undefined || !after.isDirectory() || after.isSymbolicLink()) {
      throw bootstrapError('staging-modified', '生成目录不能包含符号链接或非目录')
    }
  }
}

function safeJoin(root: string, child: string): string {
  const target = resolve(root, child)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw bootstrapError('template-escape', `模板路径越界: ${child}`)
  return target
}

async function writeState(staging: string, state: BootstrapStateFile): Promise<void> {
  const path = join(staging, STAGING_MARKER)
  if (await containsSymlink(staging, path)) throw bootstrapError('staging-modified', '状态路径不能包含符号链接')
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

async function updateState(staging: string, state: BootstrapStateFile): Promise<void> {
  const path = join(staging, STAGING_MARKER)
  if (await containsSymlink(staging, path)) throw bootstrapError('staging-modified', '状态路径不能包含符号链接')
  const temporary = join(staging, `.dsh/bootstrap-state.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, path)
  } finally {
    // A failed replacement must not leave a second file that could be picked
    // up as a marker by a future retry.
    await unlink(temporary).catch(() => {})
  }
}

async function appendStateLog(staging: string, text: string): Promise<void> {
  const path = join(staging, '.dsh/bootstrap.log')
  if (await containsSymlink(staging, path)) return
  await withIoTimeout(ensureDirectoryTree(staging, dirname(path)), LOG_IO_TIMEOUT_MS, '日志目录准备超时')
  await withIoTimeout(writeFile(path, text, { encoding: 'utf8', flag: 'a' }), LOG_IO_TIMEOUT_MS, '日志写入超时')
}

function withIoTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(bootstrapError('log-write', message))
    }, timeoutMs)
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

async function drainWriteChain(chain: Promise<unknown>): Promise<void> {
  await withIoTimeout(chain, LOG_IO_TIMEOUT_MS, '日志排空超时').catch(() => {})
}

function sha256(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }

function boundedUtf8Tail(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= maxBytes) return value
  let start = bytes.byteLength - maxBytes
  // Do not begin in the middle of a UTF-8 continuation sequence. Moving the
  // boundary forward keeps the decoded tail valid and never exceeds the cap.
  while (start < bytes.byteLength && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString('utf8')
}

function stagingPathFromError(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'stagingPath' in error
    && typeof (error as { stagingPath?: unknown }).stagingPath === 'string'
    ? (error as { stagingPath: string }).stagingPath : undefined
}

async function verifyWrapper(path: string, expectedSha256: string | undefined, safeRoot: string): Promise<void> {
  let bytes: Buffer
  try {
    if (await containsSymlink(safeRoot, path)) throw bootstrapError('wrapper-invalid', 'Gradle Wrapper 路径不能包含符号链接')
    bytes = await readFile(path)
  }
  catch (error) { throw bootstrapError('wrapper-invalid', `Gradle Wrapper 无法读取: ${String(error)}`) }
  if (bytes.length === 0) throw bootstrapError('wrapper-invalid', 'Gradle Wrapper 文件为空')
  if (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256) {
    throw bootstrapError('checksum-mismatch', 'Gradle Wrapper 校验和不匹配')
  }
}

/** Atomically populate the application-owned wrapper cache. */
async function writeCachedWrapper(root: string, path: string, bytes: Uint8Array): Promise<void> {
  await ensureDirectoryTree(root, dirname(path))
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    // Another bootstrap operation may have filled the same cache slot while
    // this download was in flight.  Both copies are checksummed; retain the
    // first one and do not replace an entry that a concurrent run may be
    // reading.
    await copyFile(temporary, path, fsConstants.COPYFILE_EXCL).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
    })
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

async function ensureSafeCacheDirectory(cacheDirectory: string, projectPaths: readonly string[]): Promise<void> {
  const cache = resolve(cacheDirectory)
  for (const projectPath of projectPaths) {
    const project = resolve(projectPath)
    const cacheToProject = relative(cache, project)
    const projectToCache = relative(project, cache)
    const cacheContainsProject = cacheToProject === '' || (!cacheToProject.startsWith(`..${sep}`) && cacheToProject !== '..' && !isAbsolute(cacheToProject))
    const projectContainsCache = projectToCache === '' || (!projectToCache.startsWith(`..${sep}`) && projectToCache !== '..' && !isAbsolute(projectToCache))
    if (cacheContainsProject || projectContainsCache) {
      throw bootstrapError('cache-overlap', '应用缓存不能位于项目目录内，也不能包含项目目录')
    }
  }
  await ensureAbsoluteDirectoryTree(cache)
}

async function ensureAbsoluteDirectoryTree(directory: string): Promise<void> {
  const absolute = resolve(directory)
  const root = parse(absolute).root
  let current = root
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, part)
    const before = await lstat(current).catch(() => undefined)
    if (before === undefined) {
      try { await mkdir(current, { recursive: false }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'EEXIST') throw error
      }
    }
    const after = await lstat(current).catch(() => undefined)
    if (after === undefined || !after.isDirectory() || after.isSymbolicLink()) {
      throw bootstrapError('cache-symlink', '应用缓存路径不能包含符号链接或非目录')
    }
  }
}

function parseStartPayload(payload: unknown): BootstrapStartRequest {
  const row = recordPayload(payload)
  if (row === undefined) throw bootstrapError('bad-request', 'start payload must be an object')
  const fields = ['entryId', 'parentDirectory', 'directoryName', 'modName', 'modId', 'packageName'] as const
  if (Object.keys(row).some(key => !(fields as readonly string[]).includes(key))) {
    throw bootstrapError('bad-request', 'start payload contains an unsupported field')
  }
  for (const field of fields) if (typeof row[field] !== 'string') throw bootstrapError('bad-request', `${field} must be a string`)
  return {
    entryId: row.entryId as string, parentDirectory: row.parentDirectory as string,
    directoryName: row.directoryName as string, modName: row.modName as string,
    modId: row.modId as string, packageName: row.packageName as string,
  }
}

function parseOperationPayload(payload: unknown): OperationRpcRequest {
  const row = recordPayload(payload)
  if (row === undefined || typeof row.operationId !== 'string' || row.operationId.length < 1 || row.operationId.length > 128) {
    throw bootstrapError('bad-request', 'operationId must be a non-empty string')
  }
  return { operationId: row.operationId }
}

function errorResult(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function badRequestResult(message: string): RpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

/** Preserve the transport-level bad-request contract for malformed payloads. */
function rpcErrorResult(error: unknown): RpcResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  return code === 'bad-request' || code.startsWith('invalid-') || code.startsWith('path-')
    ? badRequestResult(message)
    : errorResult(message)
}

function bootstrapError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : 'build-failed'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted|cancelled/iu.test(error.message))
}

function isTerminal(status: OperationSnapshot['status']): boolean {
  return status === 'ready' || status === 'failed' || status === 'cancelled'
}

async function runGradleBuild(
  projectPath: string,
  _entry: CatalogEntry,
  signal: AbortSignal,
  append: (text: string) => Promise<void>,
  cacheDirectory: string,
  java: string,
): Promise<void> {
  const wrapperJar = join(projectPath, 'gradle/wrapper/gradle-wrapper.jar')
  const hasJar = await access(wrapperJar, fsConstants.F_OK).then(() => true, () => false)
  if (!hasJar) throw bootstrapError('wrapper-missing', 'Gradle Wrapper 文件缺失；不能使用本机 Gradle 回退')
  const args = [
    '-classpath', wrapperJar, 'org.gradle.wrapper.GradleWrapperMain',
    ...await networkGradleArguments(_entry.loader), '--stacktrace', 'build',
  ]
  const officialArgs = [
    '-Ddsh.bootstrap.officialOnly=true',
    '-classpath', wrapperJar, 'org.gradle.wrapper.GradleWrapperMain',
    '--stacktrace', 'build',
  ]
  const gradleUserHome = join(cacheDirectory, 'gradle-user-home')
  await ensureDirectoryTree(cacheDirectory, gradleUserHome)
  const binding = await developmentEnvironment(projectPath, ['settings.gradle', 'build.gradle', 'gradle.properties'], gradleUserHome)
  await saveDevelopmentEnvironment(projectPath, binding, [{ executable: java, major: _entry.requiredJdk, managed: false, available: true }])
  const javaHome = dirname(dirname(java))
  const environment = { GRADLE_USER_HOME: gradleUserHome, JAVA_HOME: javaHome, ...await networkJavaEnvironment() }
  const deadline = Date.now() + BUILD_TIMEOUT_MS
  const remaining = (): number => Math.max(1, deadline - Date.now())
  try {
    await runChild(java, args, projectPath, signal, append, remaining(), environment)
  } catch (error) {
    if (signal.aborted || Date.now() >= deadline || !isMirrorResolutionFailure(error)) throw error
    const properties = join(projectPath, 'gradle/wrapper/gradle-wrapper.properties')
    const original = gradleDistributionDownloadFailed(gradleErrorOutput(error))
      ? await readFile(properties, 'utf8') : undefined
    if (original !== undefined) {
      await replaceDistributionUrl(properties, 'https://services.gradle.org/distributions/', _entry.gradleVersion)
    }
    try {
      await append('依赖下载失败；保留缓存，使用官方源重试一次。\n')
      try { await runChild(java, officialArgs, projectPath, signal, append, remaining(), environment) }
      catch (officialError) {
        signal.throwIfAborted()
        if (!automaticMinecraftNetwork() || Date.now() >= deadline || !isMirrorResolutionFailure(officialError)) throw officialError
        await append('Official source failed; trying a direct connection without clearing caches.\n')
        await runChild(java, officialArgs, projectPath, signal, append, remaining(), {
          ...environment, ...await networkJavaEnvironment(true),
        })
      }
    }
    finally { if (original !== undefined) await writeFile(properties, original, 'utf8') }
  }
}

function isMirrorResolutionFailure(error: unknown): boolean {
  return isMinecraftNetworkFailure(gradleErrorOutput(error))
}

function gradleErrorOutput(error: unknown): string {
  const rawOutput = typeof error === 'object' && error !== null && 'output' in error
    ? (error as { output?: unknown }).output : undefined
  return typeof rawOutput === 'string' ? rawOutput : ''
}

async function replaceDistributionUrl(properties: string, baseUrl: string, gradleVersion: string): Promise<void> {
  const original = await readFile(properties, 'utf8')
  const replacement = original.replace(/^distributionUrl=.*$/mu, `distributionUrl=${baseUrl}gradle-${gradleVersion}-bin.zip`)
  if (!/^distributionUrl=.+$/mu.test(original)) throw bootstrapError('wrapper-config', 'Gradle Wrapper 配置缺少 distributionUrl')
  if (replacement !== original) await writeFile(properties, replacement, 'utf8')
}

async function runChild(
  executable: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  append: (text: string) => Promise<void>,
  timeoutMs: number,
  overrides: NodeJS.ProcessEnv = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted', 'AbortError'))
      return
    }
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      // A detached POSIX child gets its own process group so cancellation can
      // terminate Gradle and any JVM children it spawned, not just the shell.
      ...(process.platform === 'win32' ? {} : { detached: true }),
      env: { ...cleanChildEnv(), ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let writeChain = Promise.resolve()
    let output = ''
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error === undefined) resolvePromise(); else reject(error)
    }
    let terminationError: Error | undefined
    const terminate = (error: Error, drainWrites = true): void => {
      if (settled || terminationError !== undefined) return
      terminationError = error
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      void terminateProcessTree(child)
        .then(() => drainWrites ? drainWriteChain(writeChain) : undefined)
        .then(() => { finish(error) }, () => { finish(error) })
    }
    const write = (stream: { pause(): unknown; resume(): unknown }, chunk: unknown): void => {
      const text = String(chunk)
      output = `${output}${text}`.slice(-64 * 1024)
      stream.pause()
      writeChain = writeChain.then(() => append(text)).then(
        () => { stream.resume() },
        (error: unknown) => {
          const failure = error instanceof Error ? error : new Error(String(error))
          terminate(failure, false)
        },
      )
    }
    child.stdout.on('data', (chunk) => { write(child.stdout, chunk) })
    child.stderr.on('data', (chunk) => { write(child.stderr, chunk) })
    const abort = (): void => { terminate(new DOMException('The operation was aborted', 'AbortError')) }
    const timer = setTimeout(() => { terminate(bootstrapError('timeout', '首次构建超过 30 分钟')) }, timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => {
      if (terminationError === undefined) finish(error)
    })
    child.once('close', (code) => {
      if (terminationError !== undefined) return
      void withIoTimeout(writeChain, LOG_IO_TIMEOUT_MS, '日志写入超时').then(() => {
        if (code === 0) finish()
        else {
          const error = bootstrapError('build-failed', gradleFailureMessage(output, code))
          ;(error as Error & { output?: string }).output = output
          finish(error)
        }
      }).catch((error: unknown) => {
        terminate(error instanceof Error ? error : new Error(String(error)), false)
      })
    })
  })
}

/**
 * Keep Gradle/JVM children independent from the Harness process.  In
 * particular, option variables such as NODE_OPTIONS and JAVA_TOOL_OPTIONS can
 * inject code or change the selected runtime; project/property variables can
 * also smuggle arbitrary Gradle settings into a supposedly deterministic
 * bootstrap.  Proxy and certificate variables remain available for networks
 * that require them.
 */
function cleanChildEnv(): NodeJS.ProcessEnv {
  const blocked = new Set([
    'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', '_JAVA_OPTIONS',
    'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', 'JAVA_HOME', 'JDK_HOME',
    'GRADLE_OPTS', 'GRADLE_ARGS', 'GRADLE_USER_HOME',
    'MAVEN_OPTS', 'MAVEN_ARGS', 'MAVEN_HOME', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'CLASSPATH',
  ])
  const blockedPrefixes = ['TS_NODE_', 'ORG_GRADLE_PROJECT_']
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    const denied = blocked.has(key) || blockedPrefixes.some(prefix => key.startsWith(prefix))
    if (value !== undefined && !denied) env[key] = value
  }
  return env
}

function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return Promise.resolve()
  if (process.platform === 'win32') {
    return (async (): Promise<void> => {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const taskkill = join(systemRoot, 'System32', 'taskkill.exe')
      let killer: ChildProcess | undefined
      try {
        killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
          shell: false, windowsHide: true, stdio: 'ignore',
        })
        await waitForChildClose(killer, PROCESS_KILL_TIMEOUT_MS)
      } catch {
        // Fall through to the direct handle and bounded close wait below.
      }
      if (child.exitCode === null) {
        try { child.kill() } catch { /* the process may have exited between checks */ }
        await waitForChildClose(child, PROCESS_KILL_TIMEOUT_MS)
      }
    })()
  }
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null) { resolvePromise(); return }
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      clearTimeout(giveUpTimer)
      child.removeListener('close', finish)
      resolvePromise()
    }
    child.once('close', finish)
    try { process.kill(-pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
    const killTimer = setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }, 2_000)
    const giveUpTimer = setTimeout(finish, 5_000)
  })
}

async function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  return await new Promise<boolean>((resolvePromise) => {
    let settled = false
    const finish = (closed: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('close', onClose)
      child.removeListener('error', onError)
      resolvePromise(closed)
    }
    const timer = setTimeout(() => {
      finish(false)
    }, timeoutMs)
    const onClose = (): void => { finish(true) }
    const onError = (): void => { finish(false) }
    child.once('close', onClose)
    child.once('error', onError)
  })
}

async function fetchResponseBytes(
  url: string,
  signal?: AbortSignal,
  fetcher: BootstrapServiceOptions['fetch'] = networkFetch,
): Promise<{ response: Response; bytes: Buffer }> {
  if (fetcher === networkFetch) {
    const response = await networkFetch(url, { ...(signal ? { signal } : {}) })
    return { response, bytes: Buffer.from(await response.arrayBuffer()) }
  }
  const controller = new AbortController()
  const onAbort = (): void => { controller.abort(signal?.reason) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    // The abort signal is advisory for injected test fetchers and some native
    // adapters, so race each promise with an explicit bounded timer.
    const response = await awaitWithTimeout(
      () => fetcher(url, { signal: controller.signal }),
      CONNECT_TIMEOUT_MS,
      'Connection timed out',
      controller,
      signal,
    )
    const bytes = await awaitWithTimeout(
      () => response.arrayBuffer(),
      READ_TIMEOUT_MS,
      'Read timed out',
      controller,
      signal,
    )
    return { response, bytes: Buffer.from(bytes) }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Await an adapter promise with both caller cancellation and a hard timeout. */
async function awaitWithTimeout<T>(
  factory: () => PromiseLike<T>,
  timeoutMs: number,
  timeoutMessage: string,
  controller: AbortController,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => {
      const reason: unknown = signal?.reason as unknown
      controller.abort(reason)
      finish(() => { reject(abortError(reason)) })
    }
    const timer = setTimeout(() => {
      const error = bootstrapError('network-timeout', timeoutMessage)
      controller.abort(error)
      finish(() => { reject(error) })
    }, timeoutMs)
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(factory).then(
      (value) => { finish(() => { resolvePromise(value) }) },
      (error: unknown) => {
        const reason = error instanceof Error ? error : new Error(String(error))
        finish(() => { reject(reason) })
      },
    )
  })
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new DOMException('The operation was aborted', 'AbortError')
}
