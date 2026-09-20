/** Host-owned Minecraft workbench; browser consumers use a loopback-only RPC. */
import type { Context } from '@deepseek-ai/cordis'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {} from '@deepseek-ai/dsh-workspace'
import { z } from 'zod'
import { MinecraftNetwork } from './network.ts'
export {
  networkFetch,
  networkJavaEnvironment,
  networkGradleArguments,
  isMinecraftNetworkFailure,
  automaticMinecraftNetwork,
} from './network.ts'
import { MinecraftRuns } from './runtime.ts'
import { MinecraftDependencies } from './dependencies.ts'
import { MinecraftSources } from './sources.ts'
import { queryMinecraftApi, type ApiQueryResult } from './api-query.ts'
import { previewResource } from './resource-preview.ts'
import { MinecraftCheckpoints } from './checkpoints.ts'
import { CurseForge } from './curseforge.ts'
import { exportMod } from './export.ts'
import { listFiles, projectPath, projectRoot, readText, saveText, searchFiles } from './files.ts'
import { runProcess } from './process.ts'
export type * from './types.ts'
export { MinecraftRuns } from './runtime.ts'
export { ensureJava, findJava, requiredJava } from './environment.ts'
export { developmentEnvironment, saveDevelopmentEnvironment } from './development-environment.ts'

export const name = 'mc-workbench'
export const inject = ['fs', 'subprocess']
const text = z.string().max(4096)
const base = z.object({ cwd: text.min(1) })
const role = z.enum(['required', 'optional', 'test'])
const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('modrinth'), projectId: text, versionId: text }),
  z.object({
    kind: z.literal('curseforge'),
    projectId: z.number().int().positive(),
    fileId: z.number().int().positive(),
  }),
  z.object({ kind: z.literal('maven'), repository: text, coordinate: text }),
  z.object({ kind: z.literal('local'), path: text }),
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    minecraftWorkbench: MinecraftWorkbench
  }
}

/**
 * Service definition shared by UI RPC and trusted model consumers.
 */
export class MinecraftWorkbench {
  /**
   * Shared owner of development process lifecycle and retained output.
   */
  readonly runs: MinecraftRuns
  /** Shared download and build network settings. */
  readonly network: MinecraftNetwork
  /**
   * Shared owner of dependency previews and durable transactions.
   */
  readonly dependencies: MinecraftDependencies
  private readonly curseforge: CurseForge
  /**
   * Shared owner of read-only source operations.
   */
  readonly sources: MinecraftSources
  /** Content-addressed project recovery independent of session-log persistence. */
  readonly checkpoints: MinecraftCheckpoints = new MinecraftCheckpoints()
  constructor(private readonly ctx: Context) {
    this.network = new MinecraftNetwork(ctx)
    this.curseforge = new CurseForge(ctx)
    this.dependencies = new MinecraftDependencies(this.curseforge)
    this.runs = new MinecraftRuns(ctx)
    this.sources = new MinecraftSources(ctx)
  }
  /**
   * Read exact-version class and method evidence for UI and explicit model queries.
   * @param cwd - Absolute project root.
   * @param input - Untrusted query or preview payload.
   * @param signal - Caller cancellation signal.
   * @returns Versioned API evidence with source and verification status.
   */
  queryApi(cwd: string, input: unknown, signal: AbortSignal): Promise<ApiQueryResult> {
    return this.network.run(() => queryMinecraftApi(this.ctx, cwd, input, signal))
  }

  /**
   * Validate a loopback request and dispatch it within its registered project.
   */
  readonly handleRpc: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>> = async (
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<RpcResult<unknown>> => {
    try {
      if (endpoint === 'network-get') return { ok: true, value: this.network.read() }
      if (endpoint === 'network-save') return { ok: true, value: await this.network.save(payload) }
      if (endpoint === 'network-check') return { ok: true, value: await this.network.check(signal) }
      const input = base.parse(payload)
      const cwd = await projectRoot(input.cwd)
      const registry = this.ctx.get('workspaceRegistry')
      if (registry && !registry.list().some(workspace => workspace.path === cwd))
        throw new Error('请先在应用中打开此项目。')
      return { ok: true, value: await this.network.run(() => this.dispatch(cwd, endpoint, payload, signal)) }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }

  private async dispatch(cwd: string, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
    switch (endpoint) {
      case 'api-query':
        return this.queryApi(cwd, payload, signal)
      case 'resource-preview':
        return previewResource(this.ctx, cwd, payload, signal)
      case 'checkpoints':
        return this.checkpoints.list(cwd)
      case 'checkpoint-create':
        return this.runs.whileIdle(cwd, () => this.checkpoints.create(cwd, 'manual', '手动恢复点', signal))
      case 'checkpoint-preview':
        return this.checkpoints.preview(cwd, base.extend({ id: z.uuid() }).parse(payload).id)
      case 'checkpoint-restore': {
        const p = base.extend({ id: z.uuid(), fingerprint: z.string().regex(/^[a-f\d]{64}$/u) }).parse(payload)
        await this.runs.whileIdle(cwd, () => this.checkpoints.restore(cwd, p.id, p.fingerprint))
        return null
      }
      case 'checkpoint-delete':
        await this.checkpoints.remove(cwd, base.extend({ id: z.uuid() }).parse(payload).id)
        return null
      case 'export':
        return this.runs.whileIdle(cwd, async () => exportMod(cwd, await this.runs.history(cwd)))
      case 'snapshot':
        return {
          facts: await this.runs.inspect(cwd, signal),
          runs: await this.runs.history(cwd),
          dependencies: await this.dependencies.read(cwd),
        }
      case 'runs':
        return this.runs.history(cwd)
      case 'retry':
        return this.runs.retry(cwd, base.extend({ id: z.uuid() }).parse(payload).id)
      case 'start': {
        const p = base
          .extend({
            action: z.enum(['prepare', 'build', 'client', 'server']),
            offline: z.boolean().default(false),
            mode: z.enum(['development', 'artifact']).default('development'),
            dependencies: z.enum(['required', 'selected']).default('selected'),
          })
          .parse(payload)
        return this.runs.start(cwd, p.action, undefined, p)
      }
      case 'stop':
        await this.runs.stop(cwd, base.extend({ id: z.uuid() }).parse(payload).id)
        return null
      case 'logs': {
        const p = base.extend({ id: z.uuid(), cursor: z.number().int().nonnegative() }).parse(payload)
        return this.runs.logs(cwd, p.id, p.cursor)
      }
      case 'native-state':
        return this.runs.nativeState(cwd) ?? null
      case 'eula':
        await this.runs.acceptEula(cwd, base.extend({ path: text }).parse(payload).path)
        return null
      case 'files':
        return listFiles(cwd, base.extend({ path: text.default('') }).parse(payload).path)
      case 'read':
        return readText(cwd, base.extend({ path: text }).parse(payload).path)
      case 'save': {
        const p = base
          .extend({
            path: text,
            text: z.string().max(2 * 1024 * 1024),
            revision: z.string().regex(/^[a-f\d]{64}$/u),
          })
          .parse(payload)
        return this.checkpoints.mutate(cwd, () => saveText(cwd, p.path, p.text, p.revision))
      }
      case 'search':
        return searchFiles(cwd, base.extend({ query: text }).parse(payload).query)
      case 'head': {
        const path = base.extend({ path: text }).parse(payload).path
        await projectPath(cwd, path)
        const result = await runProcess(this.ctx, {
          cwd,
          argv: ['git', 'show', `HEAD:./${path.replaceAll('\\', '/')}`],
          signal,
          maxBytes: 2 * 1024 * 1024,
        })
        if (result.exitCode !== 0 || result.truncated) throw new Error('Git HEAD 中没有可读取的完整文件版本。')
        return result.text
      }
      case 'mod-search': {
        const input = base
          .extend({ query: text, provider: z.enum(['modrinth', 'curseforge']).default('modrinth') })
          .parse(payload)
        if (input.provider === 'curseforge')
          return this.curseforge.search((await this.runs.inspect(cwd, signal)).project, input.query, signal)
        return this.dependencies.search(
          (await this.runs.inspect(cwd, signal)).project,
          base.extend({ query: text }).parse(payload).query,
          signal,
        )
      }
      case 'mod-versions': {
        const input = base
          .extend({ id: text, provider: z.enum(['modrinth', 'curseforge']).default('modrinth') })
          .parse(payload)
        if (input.provider === 'curseforge')
          return (
            await this.curseforge.files(
              (await this.runs.inspect(cwd, signal)).project,
              z.coerce.number().int().positive().parse(input.id),
              signal,
            )
          ).map(row => ({ id: String(row.id), name: row.displayName, version: row.displayName }))
        return this.dependencies.versions(
          (await this.runs.inspect(cwd, signal)).project,
          base.extend({ id: text }).parse(payload).id,
          signal,
        )
      }
      case 'dependency-preview': {
        const p = base
          .extend({
            source: source.optional(),
            role: role.optional(),
            removeId: text.optional(),
            updateId: text.optional(),
            enabled: z.boolean().optional(),
          })
          .parse(payload)
        return this.dependencies.preview(cwd, (await this.runs.inspect(cwd, signal)).project, p, signal)
      }
      case 'dependency-apply': {
        const id = base.extend({ id: z.uuid() }).parse(payload).id
        return this.runs.whileIdle(cwd, async () => {
          return this.dependencies.apply(cwd, id)
        })
      }
      case 'source-start': {
        const p = base.extend({ dependencyId: text, archive: text.optional() }).parse(payload)
        const dependency = (await this.dependencies.read(cwd)).dependencies.find(row => row.id === p.dependencyId)
        if (!dependency) throw new Error('依赖不存在。')
        return this.sources.start(cwd, dependency, p.archive)
      }
      case 'source-status':
        return this.sources.status(cwd, base.extend({ id: z.uuid() }).parse(payload).id)
      case 'source-cancel':
        await this.sources.cancel(cwd, base.extend({ id: z.uuid() }).parse(payload).id)
        return null
      case 'source-files': {
        const p = base.extend({ id: z.uuid(), path: text.default('') }).parse(payload)
        return this.sources.files(cwd, p.id, p.path)
      }
      case 'source-read': {
        const p = base.extend({ id: z.uuid(), path: text }).parse(payload)
        return this.sources.read(cwd, p.id, p.path)
      }
      case 'source-search': {
        const p = base.extend({ id: z.uuid(), query: text }).parse(payload)
        return this.sources.search(cwd, p.id, p.query)
      }
      default:
        throw new Error(`未知工作台操作：${endpoint}`)
    }
  }
  /**
   * Settle process and source owners during plugin teardown.
   */
  async dispose(): Promise<void> {
    await Promise.allSettled([this.runs.dispose(), this.sources.dispose()])
  }
}

export function apply(ctx: Context): void {
  const service = new MinecraftWorkbench(ctx)
  ctx.provide('minecraftWorkbench', service)
  ctx.provide('minecraftRuntime', service.runs)
  ctx.effect(() => () => service.dispose(), 'mc-workbench: processes')
  ctx.inject(['connection'], (host) => {
    const connection = host.get('connection') as unknown as {
      rpc: {
        handle(
          channel: string,
          handler: MinecraftWorkbench['handleRpc'],
          options: { authority: 'loopback' },
        ): () => Promise<void>
      }
    }
    host.effect(
      () => connection.rpc.handle('/mc-workbench', service.handleRpc, { authority: 'loopback' }),
      'mc-workbench: rpc',
    )
  })
}
