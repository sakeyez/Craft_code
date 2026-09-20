import { workbenchIdSchema } from './contracts.ts'
/** Read-only dependency sources and cancellable, verified Vineflower decompilation. */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { cachedDownload, extractZip, zipEntries } from './download.ts'
import { manifestSchema } from './contracts.ts'
import { z } from 'zod'
import { cacheRoot, ensureJava, javaEnv } from './environment.ts'
import { hash, listFiles, projectPath, readText, searchFiles } from './files.ts'
import { runProcess } from './process.ts'
import type { Dependency, SourceSnapshot, FileEntry, TextFile, SearchHit } from './types.ts'

const ENGINE_VERSION = '1.11.1'
const ENGINE_SHA = 'a615d07ddbbcd489369674f40e42df639c32be95410890b38f173d5c1e2ea39c'

/**
 * Reuse matching published sources or a verified decompiler cache without starting background work.
 * @param cwd - Absolute project root.
 * @param jarHashes - Hashes of the verified resolved project classpath.
 * @param symbol - Fully qualified class name in the project namespace.
 * @returns Matching published or decompiled source, when already available.
 */
export async function cachedClassSource(
  cwd: string,
  jarHashes: ReadonlySet<string>,
  symbol: string,
): Promise<{ text: string; source: string } | undefined> {
  const manifest = await readFile(await projectPath(cwd, '.dsh/dependencies.json', true), 'utf8').catch(
    (error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    },
  )
  if (!manifest) return undefined
  const path = `${symbol.split('$', 1).join('').replaceAll('.', '/')}.java`
  for (const dependency of manifestSchema.parse(JSON.parse(manifest)).dependencies) {
    if (!jarHashes.has(dependency.sha256)) continue
    let sourceHash = ENGINE_SHA
    if (dependency.sourcesFile) {
      const archive = await readFile(await projectPath(cwd, dependency.sourcesFile))
      sourceHash = hash(archive)
      const bytes = zipEntries(archive)[path]
      if (bytes)
        return { text: new TextDecoder().decode(bytes).slice(0, 12000), source: `dependency-source:${sourceHash}` }
    }
    const key = hash(`${dependency.sha256}:${sourceHash}`)
    const index = await readFile(join(cacheRoot(), 'sources', `${key}.json`), 'utf8').catch(() => undefined)
    if (!index) continue
    const cache = z
      .object({
        directory: z.uuid(),
        files: z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f\d]{64}$/u) })).max(50000),
      })
      .parse(JSON.parse(index))
    const entry = cache.files.find(entry => entry.path === path)
    if (!entry) continue
    const bytes = await readFile(await projectPath(join(cacheRoot(), 'sources', cache.directory), path))
    if (hash(bytes) !== entry.sha256) throw new Error('反编译缓存校验失败，请重新准备源码。')
    return {
      text: bytes.toString('utf8').slice(0, 12000),
      source: `decompiled:${dependency.sha256}:vineflower-${ENGINE_VERSION}`,
    }
  }
  return undefined
}
interface SourceOperation {
  cwd: string
  snapshot: SourceSnapshot
  directory: string
  controller: AbortController
  done: Promise<void>
}

/**
 * Owns cancellable read-only source extraction and content-verified cache reuse.
 */
export class MinecraftSources {
  private readonly operations = new Map<string, SourceOperation>()
  constructor(private readonly ctx: Context) {}

  /**
   * Prepare read-only sources with input hashes and durable cache validation.
   * @param cwd - Absolute project directory.
   * @param dependency - Committed dependency artifact and provenance.
   * @param sourceArchive - Optional explicit path to matching source ZIP/JAR content.
   * @returns Prepare read-only sources with input hashes and durable cache validation.
   */
  async start(cwd: string, dependency: Dependency, sourceArchive?: string): Promise<SourceSnapshot> {
    const bytes = await readFile(await projectPath(cwd, dependency.file))
    if (hash(bytes) !== dependency.sha256) throw new Error('依赖 JAR 已变化，请重新导入。')
    const id = workbenchIdSchema.parse(randomUUID())
    const controller = new AbortController()
    const directory = join(cacheRoot(), 'sources', id)
    const sourcePath =
      sourceArchive ?? (dependency.sourcesFile ? await projectPath(cwd, dependency.sourcesFile) : undefined)
    const archiveBytes = sourcePath ? await readFile(sourcePath) : undefined
    if (archiveBytes && archiveBytes.length > 128 * 1024 * 1024) throw new Error('源码归档超过 128 MiB 限制。')
    const sourceHash = archiveBytes ? hash(archiveBytes) : ENGINE_SHA
    const cacheKey = hash(Buffer.from(`${dependency.sha256}:${sourceHash}`))
    const index = join(cacheRoot(), 'sources', `${cacheKey}.json`)
    const snapshot: SourceSnapshot = {
      id,
      dependencyId: dependency.id,
      status: 'running',
      provenance: `${dependency.name} ${dependency.version} · ${dependency.source.kind} · 关系 ${dependency.role} · JAR SHA-256 ${dependency.sha256} · ${sourcePath ? `关联源码 SHA-256 ${sourceHash}` : `Vineflower ${ENGINE_VERSION} SHA-256 ${ENGINE_SHA}`} · 映射未经转换`,
    }
    const operation: SourceOperation = { cwd, snapshot, directory, controller, done: Promise.resolve() }
    this.operations.set(id, operation)
    operation.done = (async () => {
      const cached = await readFile(index, 'utf8')
        .then(text => JSON.parse(text) as { directory?: unknown; files?: unknown })
        .catch(() => undefined)
      if (
        cached &&
        typeof cached.directory === 'string' &&
        /^[a-f\d-]{36}$/u.test(cached.directory) &&
        Array.isArray(cached.files) &&
        cached.files.length > 0 &&
        cached.files.length <= 50_000
      ) {
        const root = join(cacheRoot(), 'sources', cached.directory)
        let intact = true
        for (const entry of cached.files as { path?: unknown; sha256?: unknown }[]) {
          controller.signal.throwIfAborted()
          if (
            typeof entry.path !== 'string' ||
            typeof entry.sha256 !== 'string' ||
            (await readFile(await projectPath(root, entry.path))
              .then(bytes => hash(bytes) !== entry.sha256)
              .catch(() => true))
          ) {
            intact = false
            break
          }
        }
        if (intact) {
          operation.directory = root
          operation.snapshot = { ...snapshot, status: 'ready' }
          return
        }
      }
      await mkdir(directory, { recursive: true })
      if (archiveBytes) await extractZip(archiveBytes, directory)
      else {
        const java = await ensureJava(this.ctx, 21, controller.signal, async () => {})
        if (!java.executable) throw new Error('Java 尚未就绪。')
        const engine = await cachedDownload(
          join(cacheRoot(), 'downloads'),
          `https://repo.maven.apache.org/maven2/org/vineflower/vineflower/${ENGINE_VERSION}/vineflower-${ENGINE_VERSION}.jar`,
          ENGINE_SHA,
          controller.signal,
        )
        const enginePath = join(cacheRoot(), `vineflower-${ENGINE_VERSION}.jar`)
        await writeFile(enginePath, engine)
        const input = await projectPath(cwd, dependency.file)
        const result = await runProcess(this.ctx, {
          cwd: directory,
          argv: [java.executable, '-jar', enginePath, '-dgs=1', '-rsy=1', input, directory],
          env: javaEnv(java),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]),
        })
        if (result.exitCode !== 0) throw new Error(`反编译失败：${result.text.slice(-2000)}`)
      }
      controller.signal.throwIfAborted()
      const files: { path: string; sha256: string }[] = []
      const collect = async (path: string): Promise<void> => {
        for (const entry of await listFiles(directory, path)) {
          controller.signal.throwIfAborted()
          if (entry.directory) await collect(entry.path)
          else
            files.push({
              path: entry.path,
              sha256: hash(await readFile(await projectPath(directory, entry.path))),
            })
        }
      }
      await collect('')
      const temporary = `${index}.${id}.tmp`
      await writeFile(temporary, JSON.stringify({ directory: id, files }))
      await rename(temporary, index)
      operation.snapshot = { ...snapshot, status: 'ready' }
    })().catch((error: unknown) => {
      operation.snapshot = {
        ...snapshot,
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    })
    return operation.snapshot
  }

  private operation(cwd: string, id: string): SourceOperation {
    const operation = this.operations.get(id)
    if (!operation || operation.cwd !== cwd) throw new Error('源码任务不属于当前项目。')
    return operation
  }
  /**
   * Read the source operation belonging to the specified project.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   * @returns Read the source operation belonging to the specified project.
   */
  status(cwd: string, id: string): SourceSnapshot {
    return this.operation(cwd, id).snapshot
  }
  /**
   * Abort extraction or decompilation and wait for its process to settle.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   */
  async cancel(cwd: string, id: string): Promise<void> {
    const operation = this.operation(cwd, id)
    operation.controller.abort()
    await operation.done
  }
  /**
   * List files only after source extraction is ready.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   * @param path - Workspace-relative path within the selected project or source root.
   * @returns List files only after source extraction is ready.
   */
  async files(cwd: string, id: string, path: string): Promise<FileEntry[]> {
    const operation = this.operation(cwd, id)
    if (operation.snapshot.status !== 'ready') throw new Error('源码尚未就绪。')
    return listFiles(operation.directory, path)
  }
  /**
   * Read source text with an enforced read-only flag.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   * @param path - Workspace-relative path within the selected project or source root.
   * @returns Read source text with an enforced read-only flag.
   */
  async read(cwd: string, id: string, path: string): Promise<TextFile> {
    const operation = this.operation(cwd, id)
    if (operation.snapshot.status !== 'ready') throw new Error('源码尚未就绪。')
    return readText(operation.directory, path, true)
  }
  /**
   * Search within the selected source operation.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   * @param query - Literal search text.
   * @returns Search within the selected source operation.
   */
  async search(cwd: string, id: string, query: string): Promise<{ hits: SearchHit[]; truncated: boolean }> {
    const operation = this.operation(cwd, id)
    if (operation.snapshot.status !== 'ready') throw new Error('源码尚未就绪。')
    return searchFiles(operation.directory, query)
  }
  /**
   * Cancel source operations and await owned processes during teardown.
   */
  async dispose(): Promise<void> {
    for (const operation of this.operations.values()) operation.controller.abort()
    await Promise.allSettled([...this.operations.values()].map(operation => operation.done))
  }
}
