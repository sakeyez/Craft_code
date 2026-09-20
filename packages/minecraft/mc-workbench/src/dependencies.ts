import { workbenchIdSchema } from './contracts.ts'
/** Dependency resolution and previewed Gradle/metadata transactions. */
import { randomUUID, createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { valid, validRange, satisfies } from 'semver'
import { z } from 'zod'
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project'
import { download, fetchJson, zipEntries } from './download.ts'
import { hash, projectPath, readText } from './files.ts'
import { manifestSchema } from './contracts.ts'
import type { CurseForge, CurseFile } from './curseforge.ts'
import { downloadArtifact } from './transfer.ts'
import { cacheRoot } from './environment.ts'
import { join } from 'node:path'
import { MinecraftCheckpoints } from './checkpoints.ts'
import { matchesDependencyVersion } from './dependency-version.ts'
import type {
  Dependency,
  DependencyManifest,
  DependencyPlan,
  DependencyRole,
  DependencySource,
  FileChange,
  ModSearchResult,
  ModVersion,
} from './types.ts'

const MANIFEST = '.dsh/dependencies.json'
const GRADLE = '.dsh/dependencies.gradle'
interface Artifact {
  filename: string
  url: string
  hashes: { sha512?: string | undefined; sha1?: string | undefined }
  primary?: boolean | undefined
}
interface Release {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  files: Artifact[]
  dependencies: {
    project_id?: string | null | undefined
    version_id?: string | null | undefined
    dependency_type: string
  }[]
}
interface Pending {
  cwd: string
  plan: DependencyPlan
  artifacts: Map<string, Buffer>
}
/** Parsed mod identity, dependencies and side constraints; absent facts remain unknown. */
export interface JarDescriptor {
  modId?: string
  name?: string
  version?: string
  loader?: string
  requirements: Record<string, string[]>
  warnings: string[]
  side?: 'client' | 'server'
  incompatible?: string[]
  requirementSides?: Record<string, 'client' | 'server'>
  incompatibleRanges?: Record<string, string[]>
}

function version(project: DetectionResult): string {
  if (
    project.loaderSupport !== 'supported' ||
    project.minecraftVersion.status !== 'determined' ||
    project.minecraftVersion.classification !== 'exact'
  )
    throw new Error('请先解决加载器和 Minecraft 版本检测问题。')
  return project.minecraftVersion.value
}

function release(value: unknown): Release {
  return z
    .object({
      id: z.string(),
      project_id: z.string(),
      name: z.string(),
      version_number: z.string(),
      game_versions: z.array(z.string()),
      loaders: z.array(z.string()),
      files: z.array(
        z.object({
          filename: z.string(),
          url: z.url(),
          hashes: z
            .object({ sha512: z.string().optional(), sha1: z.string().optional() })
            .refine(hashes => !!(hashes.sha512 || hashes.sha1)),
          primary: z.boolean().optional(),
        }),
      ),
      dependencies: z.array(
        z.object({
          project_id: z.string().nullable().optional(),
          version_id: z.string().nullable().optional(),
          dependency_type: z.string(),
        }),
      ),
    })
    .parse(value)
}

/**
 * Read mod identity without executing bytecode or trusting the filename.
 * @param bytes - Archive or text bytes to inspect.
 * @returns Read mod identity without executing bytecode or trusting the filename.
 */
export function inspectJar(bytes: Uint8Array): JarDescriptor {
  const entries = zipEntries(bytes)
  const decode = (name: string): string | undefined =>
    entries[name] ? new TextDecoder().decode(entries[name]) : undefined
  const fabric = decode('fabric.mod.json')
  if (fabric) {
    const value = JSON.parse(fabric) as Record<string, unknown>
    const requirements: Record<string, string[]> = {}
    if (value.depends && typeof value.depends === 'object')
      for (const [id, constraint] of Object.entries(value.depends)) {
        if (typeof constraint === 'string') requirements[id] = [constraint]
        else if (Array.isArray(constraint) && constraint.every(item => typeof item === 'string'))
          requirements[id] = constraint
        else throw new Error(`模组依赖 ${id} 的版本约束无效。`)
      }
    return {
      ...(typeof value.id === 'string' ? { modId: value.id } : {}),
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.version === 'string' ? { version: value.version } : {}),
      loader: 'fabric',
      ...(value.environment === 'client' || value.environment === 'server' ? { side: value.environment } : {}),
      incompatible: value.breaks && typeof value.breaks === 'object' ? Object.keys(value.breaks) : [],
      incompatibleRanges: z
        .record(
          z.string(),
          z
            .union([z.string(), z.array(z.string())])
            .transform(value => (typeof value === 'string' ? [value] : value)),
        )
        .parse(value.breaks ?? {}),
      requirements,
      warnings: [],
    }
  }
  const neo = decode('META-INF/neoforge.mods.toml') ?? decode('META-INF/mods.toml')
  if (neo) {
    const value = parseToml(neo)
    const mods = value.mods
    const first = Array.isArray(mods) ? (mods[0] as Record<string, unknown> | undefined) : undefined
    const manifestVersion = /^Implementation-Version:\s*(.+)$/mu.exec(decode('META-INF/MANIFEST.MF') ?? '')?.[1]?.trim()
    const requirements: Record<string, string[]> = {}
    const incompatible: string[] = []
    const incompatibleRanges: Record<string, string[]> = {}
    const requirementSides: Record<string, 'client' | 'server'> = {}
    const deps: unknown[] =
      value.dependencies && typeof value.dependencies === 'object' && !Array.isArray(value.dependencies)
        ? Object.values(value.dependencies).flat()
        : []
    for (const input of deps) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) continue
      const item = input as Record<string, unknown>
      if (typeof item.modId === 'string' && (item.side === 'CLIENT' || item.side === 'SERVER'))
        requirementSides[item.modId] = item.side === 'CLIENT' ? 'client' : 'server'
      if (
        typeof item.modId === 'string' &&
        typeof item.versionRange === 'string' &&
        (item.type === 'required' || item.mandatory === true)
      )
        requirements[item.modId] = [item.versionRange]
      if (typeof item.modId === 'string' && item.type === 'incompatible') {
        incompatible.push(item.modId)
        incompatibleRanges[item.modId] = [typeof item.versionRange === 'string' ? item.versionRange : '*']
      }
    }
    return {
      ...(typeof first?.modId === 'string' ? { modId: first.modId } : {}),
      ...(typeof first?.displayName === 'string' ? { name: first.displayName } : {}),
      ...(typeof first?.version === 'string' && (!first.version.includes('${') || manifestVersion)
        ? { version: first.version === '${file.jarVersion}' && manifestVersion ? manifestVersion : first.version }
        : {}),
      ...(entries['META-INF/neoforge.mods.toml'] ? { loader: 'neoforge' } : {}),
      requirements,
      incompatible,
      incompatibleRanges,
      requirementSides,
      warnings: ['请根据发布方说明确认 NeoForge 版本兼容性及必需前置。'],
    }
  }
  return { requirements: {}, warnings: ['未发现可识别的模组元数据；此文件可能是普通 Java 库。'] }
}

/**
 * Read nested mod metadata with a shared expansion budget; plain nested Java libraries have no mod identity.
 * @param bytes - Archive content or incremental download progress callback.
 * @returns Root and nested descriptors in archive traversal order.
 */
export function inspectJarTree(bytes: Uint8Array): JarDescriptor[] {
  let remaining = 256 * 1024 ** 2
  let count = 0
  const visit = (archive: Uint8Array, depth: number): JarDescriptor[] => {
    if (depth > 8 || ++count > 200) throw new Error('嵌套依赖超过验收限制。')
    const entries = zipEntries(archive, remaining)
    remaining -= Object.values(entries).reduce((total, entry) => total + entry.length, 0)
    const descriptor = inspectJar(archive)
    const paths: string[] = []
    if (entries['fabric.mod.json']) {
      const metadata = z
        .object({
          jars: z
            .array(z.object({ file: z.string() }))
            .max(100)
            .default([]),
        })
        .parse(JSON.parse(new TextDecoder().decode(entries['fabric.mod.json'])))
      paths.push(...metadata.jars.map(row => row.file))
    }
    if (entries['META-INF/jarjar/metadata.json']) {
      const metadata = z
        .object({ jars: z.array(z.object({ path: z.string() })).max(100) })
        .parse(JSON.parse(new TextDecoder().decode(entries['META-INF/jarjar/metadata.json'])))
      paths.push(...metadata.jars.map(row => row.path))
    }
    return [
      descriptor,
      ...paths.flatMap((path) => {
        const child = entries[path]
        if (!child) throw new Error(`缺少嵌套依赖：${path}`)
        return visit(child, depth + 1)
      }),
    ]
  }
  return visit(bytes, 0)
}

/**
 * Resolves dependency previews and commits recoverable Gradle and metadata transactions.
 */
export class MinecraftDependencies {
  constructor(private readonly curseforge?: CurseForge) {}
  private readonly checkpoints = new MinecraftCheckpoints()
  private readonly plans = new Map<string, Pending>()
  private readonly busy = new Set<string>()

  /**
   * Recover interrupted edits before reading the validated dependency lockfile.
   * @param cwd - Absolute project directory.
   * @returns Recover interrupted edits before reading the validated dependency lockfile.
   */
  async read(cwd: string): Promise<DependencyManifest> {
    if (this.busy.has(cwd)) throw new Error('依赖事务正在提交，请稍后读取。')
    this.busy.add(cwd)
    try {
      await this.recover(cwd)
    } finally {
      this.busy.delete(cwd)
    }
    const file = await projectPath(cwd, MANIFEST, true)
    const text = await readFile(file, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (!text) return { format: 1, dependencies: [] }
    return manifestSchema.parse(JSON.parse(text))
  }

  private async recover(cwd: string): Promise<void> {
    const journal = await projectPath(cwd, '.dsh/dependency-transaction.json', true)
    const content = await readFile(journal, 'utf8').catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (!content) return
    const changes = z
      .array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }))
      .max(20)
      .parse(JSON.parse(content))
    for (const change of [...changes].reverse()) {
      if (
        ![MANIFEST, GRADLE, 'build.gradle', 'build.gradle.kts'].includes(change.path) &&
        !/^src\/[\w-]+\/resources\/(?:fabric\.mod\.json|META-INF\/(?:neoforge\.)?mods\.toml)$/u.test(change.path)
      )
        throw new Error('依赖事务包含不受支持的目标文件。')
      const file = await projectPath(cwd, change.path, true)
      const current = await readFile(file, 'utf8').catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
        throw error
      })
      if (current === change.before) continue
      if (current !== change.after)
        throw new Error(`${change.path} 在依赖事务中断后被修改。请保留该文件并人工恢复事务。`)
      if (change.before === null) await unlink(file)
      else await writeFile(file, change.before)
    }
    await unlink(journal)
  }

  /**
   * Find Modrinth mods matching the exact game release and loader.
   * @param project - Detected loader and exact Minecraft version evidence.
   * @param query - Literal search text.
   * @param signal - Cancellation signal for the caller-owned operation.
   * @returns Find Modrinth mods matching the exact game release and loader.
   */
  async search(project: DetectionResult, query: string, signal?: AbortSignal): Promise<ModSearchResult[]> {
    const facets = JSON.stringify([
      [`versions:${version(project)}`],
      [`categories:${project.loader}`],
      ['project_type:mod'],
    ])
    const data = (await fetchJson(
      `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query.slice(0, 200))}&facets=${encodeURIComponent(facets)}&limit=25`,
      signal,
    )) as { hits?: unknown[] }
    if (!Array.isArray(data.hits)) throw new Error('Modrinth 搜索结果无效。')
    return data.hits.flatMap((value) => {
      const row = value as Record<string, unknown>
      return typeof row.project_id === 'string' && typeof row.title === 'string' && typeof row.description === 'string'
        ? [{ id: row.project_id, name: row.title, description: row.description }]
        : []
    })
  }

  private async releases(project: DetectionResult, id: string, signal?: AbortSignal): Promise<Release[]> {
    const data = await fetchJson(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version?game_versions=${encodeURIComponent(JSON.stringify([version(project)]))}&loaders=${encodeURIComponent(JSON.stringify([project.loader]))}`,
      signal,
    )
    if (!Array.isArray(data)) throw new Error('Modrinth 版本列表无效。')
    return data.map(release)
  }

  /**
   * List compatible Modrinth publications for the project.
   * @param project - Detected loader and exact Minecraft version evidence.
   * @param id - Identifier returned by the owning operation.
   * @param signal - Cancellation signal for the caller-owned operation.
   * @returns List compatible Modrinth publications for the project.
   */
  async versions(project: DetectionResult, id: string, signal?: AbortSignal): Promise<ModVersion[]> {
    return (await this.releases(project, id, signal)).map(row => ({
      id: row.id,
      name: row.name,
      version: row.version_number,
    }))
  }

  /**
   * Resolve the dependency graph and bind a preview to original file revisions.
   * @param cwd - Absolute project directory.
   * @param project - Detected loader and exact Minecraft version evidence.
   * @param input - Requested dependency source, role or removal/update.
   * @param signal - Cancellation signal for the caller-owned operation.
   * @returns Resolve the dependency graph and bind a preview to original file revisions.
   */
  async preview(
    cwd: string,
    project: DetectionResult,
    input: {
      source?: DependencySource | undefined
      role?: DependencyRole | undefined
      removeId?: string | undefined
      updateId?: string | undefined
      enabled?: boolean | undefined
    },
    signal?: AbortSignal,
  ): Promise<DependencyPlan> {
    version(project)
    const prior = await this.read(cwd)
    const dependencies = prior.dependencies.map(row => ({ ...row, dependencies: [...row.dependencies] }))
    const artifacts = new Map<string, Buffer>()
    const publications = new Map<string, CurseFile>()
    if (input.removeId) {
      const index = dependencies.findIndex(row => row.id === input.removeId && !row.automatic)
      if (index < 0) throw new Error('只能直接移除手动添加的目标模组。')
      dependencies.splice(index, 1)
    }
    if (input.updateId) {
      const entry = dependencies.find(row => row.id === input.updateId && !row.automatic)
      if (!entry) throw new Error('目标依赖不存在。')
      if (input.role) entry.role = input.role
      if (input.enabled !== undefined) entry.enabled = input.enabled
    }
    if (input.source)
      await this.resolve(cwd, project, input.source, input.role ?? 'required', false, dependencies, artifacts, publications, signal)
    const retained = new Set(dependencies.filter(row => !row.automatic).map(row => row.id))
    const visit = (id: string): void => {
      for (const child of dependencies.find(row => row.id === id)?.dependencies ?? [])
        if (!retained.has(child)) {
          retained.add(child)
          visit(child)
        }
    }
    for (const id of retained) visit(id)
    const next = dependencies.filter(row => retained.has(row.id))
    for (const entry of next) {
      const descriptor = inspectJar(artifacts.get(entry.file) ?? (await readFile(await projectPath(cwd, entry.file))))
      for (const [id, ranges] of Object.entries(descriptor.requirements)) {
        const installed = next.find(row => row.modId === id)
        const actual = id === 'minecraft' ? version(project) : installed?.version
        if (actual && valid(actual) && ranges.every(range => validRange(range))) {
          if (!ranges.some(range => satisfies(actual, range)))
            throw new Error(`${entry.name} 要求 ${id} ${ranges.join(' 或 ')}，当前为 ${actual}。`)
        } else if (!['java', 'fabricloader'].includes(id))
          entry.warnings.push(`必需前置 ${id} ${ranges.join(' 或 ')} 需要人工核对。`)
        if (installed && !entry.dependencies.includes(installed.id)) entry.dependencies.push(installed.id)
      }
      entry.warnings = [...new Set(entry.warnings)]
    }
    const ids = next.flatMap(row => (row.modId ? [row.modId] : []))
    if (new Set(ids).size !== ids.length) throw new Error('检测到相同 mod ID 的多个文件，请先解决冲突。')
    const checked = new Set<string>()
    const acyclic = (id: string, ancestors: Set<string>): void => {
      if (ancestors.has(id)) throw new Error('依赖关系包含循环。')
      if (checked.has(id)) return
      for (const child of next.find(row => row.id === id)?.dependencies ?? [])
        acyclic(child, new Set([...ancestors, id]))
      checked.add(id)
    }
    for (const row of next) acyclic(row.id, new Set())
    for (const row of next) {
      if (row.source.kind === 'curseforge') {
        if (!this.curseforge) throw new Error('未配置 CurseForge API 密钥。')
        const publication = publications.get(row.id) ?? await this.curseforge.file(project, row.source.projectId, row.source.fileId, signal)
        for (const relation of publication.dependencies)
          if (relation.relationType === 5 && next.some(other => other.id === `curseforge:${relation.modId}`))
            throw new Error(`${row.name} 的 CurseForge 发布方声明与项目 ${relation.modId} 不兼容。`)
      }
      const descriptor = inspectJar(artifacts.get(row.file) ?? (await readFile(await projectPath(cwd, row.file))))
      for (const id of descriptor.incompatible ?? []) {
        const other = next.find(candidate => candidate.modId === id)
        if (other && matchesDependencyVersion(other.version, descriptor.incompatibleRanges?.[id] ?? ['*']))
          throw new Error(`${row.name} 声明与 ${id} ${other.version} 不兼容。`)
      }
    }
    const changes = await this.changes(cwd, project, prior.dependencies, next)
    const plan: DependencyPlan = {
      id: workbenchIdSchema.parse(randomUUID()),
      dependencies: next,
      changes,
      warnings: next.flatMap(row => row.warnings.map(warning => `${row.name}: ${warning}`)),
    }
    for (const [id, item] of this.plans) if (item.cwd === cwd) this.plans.delete(id)
    this.plans.set(plan.id, { cwd, plan, artifacts })
    return plan
  }

  private async resolve(
    cwd: string,
    project: DetectionResult,
    source: DependencySource,
    role: DependencyRole,
    automatic: boolean,
    entries: Dependency[],
    artifacts: Map<string, Buffer>,
    publications: Map<string, CurseFile>,
    signal?: AbortSignal,
  ): Promise<Dependency> {
    signal?.throwIfAborted()
    if (entries.length >= 100) throw new Error('依赖数量超过 100，请缩小导入范围。')
    let bytes: Buffer
    let id: string
    let name: string
    let resolvedVersion: string
    let releaseInfo: Release | undefined
    let curseInfo: CurseFile | undefined
    let sourcesFile: string | undefined
    if (source.kind === 'modrinth') {
      releaseInfo = release(
        await fetchJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(source.versionId)}`, signal),
      )
      if (
        releaseInfo.project_id !== source.projectId ||
        !releaseInfo.game_versions.includes(version(project)) ||
        !releaseInfo.loaders.includes(project.loader)
      )
        throw new Error('所选模组版本与当前项目不兼容。')
      id = `modrinth:${source.projectId}`
      name = releaseInfo.name
      resolvedVersion = releaseInfo.version_number
      const existing = entries.find(row => row.id === id)
      if (existing) {
        if (existing.source.kind !== 'modrinth' || existing.source.versionId !== source.versionId)
          throw new Error(`${name} 的版本要求冲突。`)
        if (!automatic) {
          existing.automatic = false
          existing.role = role
        }
        return existing
      }
      const artifact = releaseInfo.files.find(file => file.primary) ?? releaseInfo.files[0]
      if (!artifact || !artifact.filename.endsWith('.jar')) throw new Error('发布版本没有可安装的 JAR。')
      bytes = await download(artifact.url, signal)
      const algorithm = artifact.hashes.sha512 ? 'sha512' : 'sha1'
      if (createHash(algorithm).update(bytes).digest('hex') !== artifact.hashes[algorithm])
        throw new Error('模组下载校验失败。')
    } else if (source.kind === 'curseforge') {
      if (!this.curseforge) throw new Error('未配置 CurseForge API 密钥。')
      id = `curseforge:${source.projectId}`
      const existing = entries.find(row => row.id === id)
      if (existing) {
        if (existing.source.kind !== 'curseforge' || existing.source.fileId !== source.fileId)
          throw new Error('CurseForge 依赖版本冲突。')
        if (!automatic) {
          existing.automatic = false
          existing.role = role
        }
        return existing
      }
      curseInfo = await this.curseforge.file(project, source.projectId, source.fileId, signal)
      publications.set(id, curseInfo)
      const publisher = curseInfo.hashes.find(row => row.algo === 1)
      if (!publisher || !/^[a-f\d]{40}$/iu.test(publisher.value) || !curseInfo.downloadUrl)
        throw new Error('CurseForge 未提供有效 SHA-1 或允许的下载地址。')
      const path = await downloadArtifact({
        url: curseInfo.downloadUrl,
        destination: join(cacheRoot(), 'downloads', publisher.value.toLowerCase()),
        digest: { algorithm: 'sha1', value: publisher.value },
        maxBytes: 256 * 1024 ** 2,
        ...(signal ? { signal } : {}),
      })
      bytes = await readFile(path)
      source = { ...source, publisherHash: { algorithm: 'sha1', value: publisher.value.toLowerCase() } }
      name = curseInfo.displayName
      resolvedVersion = curseInfo.displayName
    } else if (source.kind === 'maven') {
      const match = /^([A-Za-z\d_.-]+):([A-Za-z\d_.-]+):([A-Za-z\d_.+-]+)$/u.exec(source.coordinate)
      if (!match || source.coordinate.includes('..')) throw new Error('Maven 坐标格式应为 group:artifact:version。')
      const repo = new URL(source.repository)
      if (repo.protocol !== 'https:' || repo.username || repo.password || repo.search || repo.hash)
        throw new Error('Maven 仓库必须是 HTTPS 地址。')
      const [, group, artifact, number] = match
      if (!group || !artifact || !number) throw new Error('Maven 坐标不完整。')
      const base = `${repo.href.replace(/\/$/u, '')}/${group.replaceAll('.', '/')}/${artifact}/${number}/${artifact}-${number}`
      bytes = await download(`${base}.jar`, signal)
      id = `maven:${group}:${artifact}`
      name = artifact
      resolvedVersion = number
      const existing = entries.find(row => row.id === id)
      if (existing) {
        if (existing.version !== resolvedVersion) throw new Error('Maven 依赖版本冲突。')
        return existing
      }
      const sources = await download(`${base}-sources.jar`, signal).catch(() => undefined)
      if (sources) {
        sourcesFile = `.dsh/dependency-sources/${hash(sources)}.jar`
        artifacts.set(sourcesFile, sources)
      }
    } else {
      bytes = await readFile(source.path)
      if (bytes.length > 256 * 1024 * 1024) throw new Error('本地 JAR 超过大小限制。')
      id = `local:${hash(bytes)}`
      name = basename(source.path)
      resolvedVersion = '未知'
      const existing = entries.find(row => row.id === id)
      if (existing) return existing
    }
    const descriptor = inspectJar(bytes)
    if (descriptor.modId && !/^[a-z][a-z\d_-]{1,63}$/u.test(descriptor.modId)) throw new Error('JAR 中的 mod ID 无效。')
    if (descriptor.loader && descriptor.loader !== project.loader) throw new Error('JAR 加载器与项目不一致。')
    const sha256 = hash(bytes)
    const file = `.dsh/dependencies/${sha256}.jar`
    const entry: Dependency = {
      id,
      name: descriptor.name ?? name,
      version: descriptor.version ?? resolvedVersion,
      ...(descriptor.modId ? { modId: descriptor.modId } : {}),
      role,
      enabled: true,
      source: source.kind === 'local' ? { kind: 'local', path: file } : source,
      sha256,
      file,
      dependencies: [],
      automatic,
      compatibility: releaseInfo || curseInfo ? 'verified' : 'unknown',
      warnings: [...descriptor.warnings, ...(!releaseInfo && !curseInfo ? ['Minecraft 版本兼容性尚未验证。'] : [])],
      ...(sourcesFile ? { sourcesFile } : {}),
    }
    entries.push(entry)
    artifacts.set(file, bytes)
    for (const required of curseInfo?.dependencies ?? []) {
      if (required.relationType !== 3) continue
      const existing = entries.find(row => row.id === `curseforge:${required.modId}`)
      if (existing) {
        entry.dependencies.push(existing.id)
        continue
      }
      if (!this.curseforge) throw new Error('未配置 CurseForge 服务。')
      const candidate = (await this.curseforge.files(project, required.modId, signal))[0]
      if (!candidate) throw new Error(`${name} 的必需前置没有兼容版本。`)
      const child = await this.resolve(
        cwd,
        project,
        { kind: 'curseforge', projectId: required.modId, fileId: candidate.id },
        'required',
        true,
        entries,
        artifacts,
        publications,
        signal,
      )
      entry.dependencies.push(child.id)
    }
    for (const dependency of releaseInfo?.dependencies ?? []) {
      if (dependency.dependency_type !== 'required') continue
      let target: Release | undefined
      if (dependency.version_id)
        target = release(
          await fetchJson(`https://api.modrinth.com/v2/version/${encodeURIComponent(dependency.version_id)}`, signal),
        )
      else if (dependency.project_id) {
        const existing = entries.find(row => row.id === `modrinth:${dependency.project_id}`)
        if (existing) {
          entry.dependencies.push(existing.id)
          continue
        }
        target = (await this.releases(project, dependency.project_id, signal))[0]
      }
      if (!target) throw new Error(`${entry.name} 的必需前置没有兼容版本。`)
      const child = await this.resolve(
        cwd,
        project,
        { kind: 'modrinth', projectId: target.project_id, versionId: target.id },
        'required',
        true,
        entries,
        artifacts,
        publications,
        signal,
      )
      entry.dependencies.push(child.id)
    }
    return entry
  }

  private async changes(
    cwd: string,
    project: DetectionResult,
    prior: Dependency[],
    next: Dependency[],
  ): Promise<FileChange[]> {
    const buildPath = project.inspected.gradleFiles.includes('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle'
    const build = await readText(cwd, buildPath)
    const expected =
      project.loader === 'fabric'
        ? /(?:fabric-loom|net\.fabricmc\.fabric-loom-remap)/u
        : /net\.neoforged\.gradle\.userdev/u
    if (!expected.test(build.text) || /\b(?:subprojects|allprojects|buildscript)\s*\{/u.test(build.text))
      throw new Error('此 Gradle 布局不能自动修改；请让助手按项目实际配置接入依赖。')
    const importLine = buildPath.endsWith('.kts')
      ? 'apply(from = ".dsh/dependencies.gradle")'
      : 'apply from: ".dsh/dependencies.gradle"'
    const changes: FileChange[] = []
    if (!build.text.includes(importLine))
      changes.push({
        path: buildPath,
        before: build.text,
        after: `${build.text.trimEnd()}\n\n${importLine}\n`,
      })
    const lines = ['// Generated from .dsh/dependencies.json. Change dependencies in the workbench.', 'dependencies {']
    const runtime = new Set<string>()
    const required = new Set<string>()
    const compilation = new Set<string>()
    const add = (entry: Dependency, target: Set<string>): void => {
      if (target.has(entry.id)) return
      target.add(entry.id)
      for (const id of entry.dependencies) {
        const child = next.find(row => row.id === id)
        if (child) add(child, target)
      }
    }
    for (const row of next.filter(row => !row.automatic)) {
      if (row.role === 'required') add(row, required)
      if (row.role !== 'test') add(row, compilation)
      if (row.role !== 'optional' || row.enabled) add(row, runtime)
    }
    for (const row of next) {
      const compile = compilation.has(row.id)
      const isRequired = required.has(row.id)
      const configurations =
        project.loader === 'fabric'
          ? [
            ...(compile ? [isRequired ? 'modImplementation' : 'modCompileOnly'] : []),
            ...(!isRequired && runtime.has(row.id) ? ['modLocalRuntime'] : []),
          ]
          : [
            ...(compile ? [isRequired ? 'implementation' : 'compileOnly'] : []),
            ...(!isRequired && runtime.has(row.id) ? ['runtimeOnly'] : []),
          ]
      for (const config of configurations) lines.push(`    ${config} files(rootProject.file('${row.file}'))`)
    }
    lines.push('}', '')
    const beforeGradle = await readText(cwd, GRADLE)
      .then(file => file.text)
      .catch(() => null)
    changes.push({ path: GRADLE, before: beforeGradle, after: lines.join('\n') })
    const metadataPath = project.inspected.metadataFiles.find(path =>
      project.loader === 'fabric' ? path.endsWith('fabric.mod.json') : /(?:neoforge\.)?mods\.toml$/u.test(path),
    )
    if (!metadataPath) throw new Error('找不到当前模组的依赖声明文件。')
    const metadata = await readText(cwd, metadataPath)
    const ownId = project.modIdCandidates.find(row => row.confidence === 'high')?.id
    if (!ownId) throw new Error('无法确定当前项目 mod ID。')
    let after: string
    if (project.loader === 'fabric') {
      const data = JSON.parse(metadata.text) as Record<string, unknown>
      for (const row of next)
        if (
          row.modId &&
          !prior.some(old => old.modId === row.modId) &&
          ['depends', 'suggests'].some(key => row.modId !== undefined && Object.hasOwn(data[key] ?? {}, row.modId))
        )
          throw new Error(`${row.modId} 已有手写依赖声明，请先让助手核对并迁移，避免覆盖现有约束。`)
      for (const key of ['depends', 'suggests']) {
        const previousIds = new Set(prior.map(row => row.modId))
        const values = Object.fromEntries(
          Object.entries((data[key] ?? {}) as Record<string, unknown>).filter(([id]) => !previousIds.has(id)),
        )
        for (const row of next)
          if (row.modId && (key === 'depends' ? required.has(row.id) : row.role === 'optional' && !row.automatic))
            values[row.modId] = row.version === '未知' ? '*' : row.version
        data[key] = values
      }
      after = JSON.stringify(data, null, 2) + '\n'
    } else {
      const data = parseToml(metadata.text)
      const all = (data.dependencies ?? {}) as Record<string, unknown>
      for (const row of next)
        if (
          row.modId &&
          !prior.some(old => old.modId === row.modId) &&
          Array.isArray(all[ownId]) &&
          (all[ownId] as Record<string, unknown>[]).some(old => old.modId === row.modId)
        )
          throw new Error(`${row.modId} 已有手写依赖声明，不能自动覆盖。`)
      const previousIds = new Set(prior.flatMap(row => (row.modId ? [row.modId] : [])))
      const rows = (Array.isArray(all[ownId]) ? (all[ownId] as Record<string, unknown>[]) : []).filter(
        row => !previousIds.has(String(row.modId)),
      )
      for (const row of next)
        if (row.modId && (required.has(row.id) || (row.role === 'optional' && !row.automatic)))
          rows.push({
            modId: row.modId,
            ...(metadataPath.endsWith('neoforge.mods.toml')
              ? { type: required.has(row.id) ? 'required' : 'optional' }
              : { mandatory: required.has(row.id) }),
            versionRange: row.version === '未知' ? '[0,)' : `[${row.version}]`,
            ordering: 'NONE',
            side: 'BOTH',
          })
      all[ownId] = rows
      data.dependencies = all as NonNullable<typeof data.dependencies>
      after = stringifyToml(data)
    }
    changes.push({ path: metadataPath, before: metadata.text, after })
    changes.push({
      path: MANIFEST,
      before: await readText(cwd, MANIFEST)
        .then(file => file.text)
        .catch(() => null),
      after: JSON.stringify({ format: 1, dependencies: next }, null, 2) + '\n',
    })
    return changes
  }

  /**
   * Apply an inspected preview only while every original file still matches.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   * @returns Apply an inspected preview only while every original file still matches.
   */
  async apply(cwd: string, id: string): Promise<DependencyManifest> {
    return this.checkpoints.mutate(cwd, () => this.commit(cwd, id))
  }

  private async commit(cwd: string, id: string): Promise<DependencyManifest> {
    const pending = this.plans.get(id)
    if (!pending || pending.cwd !== cwd) throw new Error('依赖预览已过期，请重新预览。')
    if (this.busy.has(cwd)) throw new Error('此项目正在修改依赖。')
    this.busy.add(cwd)
    const written: FileChange[] = []
    const read = async (path: string): Promise<string | null> =>
      readFile(await projectPath(cwd, path, true), 'utf8').catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
        throw error
      })
    try {
      await this.checkpoints.create(cwd, 'transaction', `依赖事务 ${id}`)
      for (const change of pending.plan.changes)
        if ((await read(change.path)) !== change.before) throw new Error(`${change.path} 已变化，请重新预览。`)
      for (const [path, bytes] of pending.artifacts) {
        const target = await projectPath(cwd, path, true)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, bytes)
      }
      const journal = await projectPath(cwd, '.dsh/dependency-transaction.json', true)
      await mkdir(dirname(journal), { recursive: true })
      await writeFile(journal, JSON.stringify(pending.plan.changes))
      for (const change of pending.plan.changes) {
        if ((await read(change.path)) !== change.before) throw new Error(`${change.path} 已变化，正在回滚。`)
        const target = await projectPath(cwd, change.path, true)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target + '.craftcode-tmp', change.after ?? '')
        await rename(target + '.craftcode-tmp', target)
        written.push(change)
      }
      await unlink(journal)
      this.plans.delete(id)
      const retainedFiles = new Set(
        pending.plan.dependencies.flatMap(row => [row.file, ...(row.sourcesFile ? [row.sourcesFile] : [])]),
      )
      const priorManifest = pending.plan.changes.find(change => change.path === MANIFEST)?.before
      if (priorManifest)
        for (const row of (JSON.parse(priorManifest) as DependencyManifest).dependencies)
          for (const path of [row.file, ...(row.sourcesFile ? [row.sourcesFile] : [])]) {
            if (
              !retainedFiles.has(path) &&
              /^\.dsh\/(?:dependencies|dependency-sources)\/[a-f\d]{64}\.jar$/u.test(path)
            )
              await unlink(await projectPath(cwd, path, true)).catch(() => {})
          }
      return { format: 1, dependencies: pending.plan.dependencies }
    } catch (error) {
      for (const change of written.reverse()) {
        if ((await read(change.path)) !== change.after) continue
        const target = await projectPath(cwd, change.path)
        if (change.before === null) await unlink(target)
        else await writeFile(target, change.before)
      }
      throw error
    } finally {
      this.busy.delete(cwd)
    }
  }
}
