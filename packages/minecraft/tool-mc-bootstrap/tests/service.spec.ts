import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  applyBootstrapService,
  fabricEntry,
  neoForgeEntry,
  type CatalogEntry,
  type CatalogSnapshot,
  type OperationSnapshot,
  type BootstrapStartRequest,
} from '../src/index.ts'
import { MinecraftBootstrapService } from '../src/service.ts'
import type { MinecraftCatalogResolver } from '../src/catalog.ts'

const ENTRY: CatalogEntry = {
  ...fabricEntry('1.21.1', '0.16.5', 'intermediary', '1.21.1+build.3', '0.102.0+1.21.1'),
  // Test wrapper bytes are intentionally synthetic, so their checksum replaces
  // the production wrapper checksum at this isolated download seam.
  wrapperSha256: '76a9a94853752c446a2963e5f3e03ca951a1ca3029138fc1b284d2f09116b700',
}

interface TestContext {
  readonly ctx: Context
  readonly snapshots: OperationSnapshot[]
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-service-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function context(): TestContext {
  const snapshots: OperationSnapshot[] = []
  const ctx = {
    get: () => undefined,
    emit(event: string, snapshot: unknown): void {
      if (event === 'minecraft-bootstrap/progress') snapshots.push(snapshot as OperationSnapshot)
    },
  } as unknown as Context
  return { ctx, snapshots }
}

function catalog(entries: readonly CatalogEntry[] = [ENTRY]): MinecraftCatalogResolver {
  const snapshot: CatalogSnapshot = {
    entries,
    cached: false,
    stale: false,
    java: { available: true, version: 21, executable: process.execPath },
  }
  return { load: async () => snapshot } as unknown as MinecraftCatalogResolver
}

function request(parentDirectory = root, overrides: Partial<BootstrapStartRequest> = {}): BootstrapStartRequest {
  return {
    entryId: ENTRY.entryId,
    parentDirectory,
    directoryName: 'copper-tools',
    modName: 'Copper Tools',
    modId: 'copper_tools',
    packageName: 'com.example.copper_tools',
    ...overrides,
  }
}

function wrapperJar() {
  return async (
    _version: string,
    destination: string,
    _signal: AbortSignal,
    append: (text: string) => Promise<void>,
  ): Promise<void> => {
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, Buffer.from('deterministic wrapper jar'))
    await append('fake wrapper ready\n')
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

async function readdirSafe(path: string): Promise<string[]> {
  return readdir(path).catch(() => [])
}

async function waitFor(
  service: MinecraftBootstrapService,
  operationId: string,
  predicate: (snapshot: OperationSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<OperationSnapshot> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = service.status(operationId)
    if (snapshot !== undefined && predicate(snapshot)) return snapshot
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`operation ${operationId} did not reach the expected state: ${JSON.stringify(service.status(operationId))}`)
}

describe('Minecraft bootstrap host service', () => {
  it.each(['recognized', 'unexpected', 'symlink'] as const)('checks NeoGradle JUnit output on commit and resume (%s)', async (kind) => {
    const { ctx } = context()
    const entry = { ...neoForgeEntry('1.21.1', '21.1.235'), wrapperSha256: ENTRY.wrapperSha256 }
    let builds = 0
    const build = async (path: string): Promise<void> => {
      builds++
      if (kind === 'symlink') {
        const external = join(root, 'external-junit')
        await mkdir(external)
        await mkdir(join(path, 'runs'))
        await symlink(external, join(path, 'runs/junit'), process.platform === 'win32' ? 'junction' : 'dir')
      } else {
        await mkdir(join(path, 'runs/junit'), { recursive: true })
        await writeFile(join(path, 'runs/junit/junit_jvm_args.txt'), '-Xmx1G\n')
        await writeFile(join(path, 'runs/junit/junit_test_args.txt'), '--launchTarget junit\n')
        if (kind === 'unexpected') await writeFile(join(path, 'runs/junit/user.java'), '// user file\n')
      }
      if (builds === 1) throw new Error('interrupted after JUnit preparation')
    }
    const service = new MinecraftBootstrapService(ctx, { catalog: catalog([entry]), wrapperJar: wrapperJar(), build })
    try {
      const input = request(root, { entryId: entry.entryId })
      const first = await service.start(input)
      await waitFor(service, first.operationId, snapshot => snapshot.status === 'failed')
      const retry = await service.start(input)
      const result = await waitFor(service, retry.operationId, snapshot => snapshot.status === 'ready' || snapshot.status === 'failed')
      if (kind === 'recognized') {
        expect(result.status).toBe('ready')
        expect(builds).toBe(2)
        expect(await readFile(join(result.projectPath!, 'runs/junit/junit_jvm_args.txt'), 'utf8')).toBe('-Xmx1G\n')
      } else {
        expect(result.failureCode).toBe('staging-modified')
        expect(builds).toBe(1)
      }
    } finally { await service.dispose() }
  })

  it.each([false, true])('preserves an older template and checks user edits before retry (edited=%s)', async (edited) => {
    const { ctx } = context()
    const build = vi.fn(async () => { throw new Error('network unavailable') })
    const service = new MinecraftBootstrapService(ctx, { catalog: catalog(), wrapperJar: wrapperJar(), build })
    try {
      const first = await service.start(request())
      const failed = await waitFor(service, first.operationId, snapshot => snapshot.status === 'failed')
      const oldPath = failed.projectPath!
      const marker = join(oldPath, '.dsh/bootstrap-state.json')
      const state = JSON.parse(await readFile(marker, 'utf8')) as { generatedHashes: Record<string, string> }
      const oldSource = '// Previous generated template\n'
      state.generatedHashes['src/main/java/com/example/copper_tools/Mod.java'] = createHash('sha256').update(oldSource).digest('hex')
      await writeFile(marker, JSON.stringify(state))
      const source = join(oldPath, 'src/main/java/com/example/copper_tools/Mod.java')
      await writeFile(source, edited ? '// User edit\n' : oldSource)
      const retry = await service.start(request())
      const retried = await waitFor(service, retry.operationId, snapshot => snapshot.status === 'failed')
      expect(await readFile(source, 'utf8')).toBe(edited ? '// User edit\n' : oldSource)
      expect(await readFile(marker, 'utf8')).toBe(JSON.stringify(state))
      if (edited) {
        expect(retried.failureCode).toBe('staging-modified')
        expect(build).toHaveBeenCalledTimes(1)
      } else {
        expect(retried.projectPath).not.toBe(oldPath)
        expect(build).toHaveBeenCalledTimes(2)
        const again = await service.start(request())
        const resumed = await waitFor(service, again.operationId, snapshot => snapshot.status === 'failed')
        expect(resumed.projectPath).toBe(retried.projectPath)
      }
    } finally {
      await service.dispose()
    }
  })

  it('generates, builds, and atomically commits a project only after build success', async () => {
    const { ctx, snapshots } = context()
    const build = vi.fn(async (
      projectPath: string,
      _entry: CatalogEntry,
      _signal: AbortSignal,
      append: (text: string) => Promise<void>,
      javaExecutable: string,
    ) => {
      expect(javaExecutable).toBe(process.execPath)
      expect(await exists(join(projectPath, 'src/main/resources/fabric.mod.json'))).toBe(true)
      await append('build succeeded\n')
    })
    const service = new MinecraftBootstrapService(ctx, {
      catalog: catalog(),
      wrapperJar: wrapperJar(),
      build,
    })

    const { operationId } = await service.start(request())
    const ready = await waitFor(service, operationId, snapshot => snapshot.status === 'ready')
    expect(ready.projectPath).toBe(join(root, 'copper-tools'))
    expect(build).toHaveBeenCalledTimes(1)
    expect(await exists(join(root, 'copper-tools/gradlew'))).toBe(true)
    expect(await exists(join(root, 'copper-tools/.dsh/bootstrap-state.json'))).toBe(true)
    expect(await readFile(join(root, 'copper-tools/src/main/resources/fabric.mod.json'), 'utf8')).toContain('copper_tools')
    expect(await readFile(join(root, 'copper-tools/.dsh/bootstrap.log'), 'utf8')).toContain('build succeeded')
    expect(snapshots.some(snapshot => snapshot.status === 'running' && snapshot.stage === 'build')).toBe(true)
    expect(snapshots.at(-1)?.status).toBe('ready')
    await service.dispose()
  })

  it('rejects malformed requests before creating an operation and rejects non-empty targets', async () => {
    const { ctx } = context()
    const service = new MinecraftBootstrapService(ctx, { catalog: catalog(), wrapperJar: wrapperJar() })
    await expect(service.start(request(root, { modId: 'Unsafe-ID' }))).rejects.toThrow('modId')
    expect(service.status('never-created')).toBeUndefined()

    const target = join(root, 'existing')
    await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'player data')
    const { operationId } = await service.start(request(root, { directoryName: 'existing' }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('target-nonempty')
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('player data')
    await service.dispose()
  })

  it('fails the JDK gate before writing a staging tree', async () => {
    const { ctx } = context()
    const wrongJava: CatalogSnapshot = {
      entries: [ENTRY], cached: false, stale: false,
      java: { available: true, version: 17, executable: process.execPath },
    }
    const service = new MinecraftBootstrapService(ctx, {
      catalog: { load: async () => wrongJava } as unknown as MinecraftCatalogResolver,
      wrapperJar: wrapperJar(),
    })
    const { operationId } = await service.start(request(root, { directoryName: 'jdk-failure' }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('jdk-mismatch')
    const children = await readdirSafe(root)
    expect(children.some(name => name.startsWith('jdk-failure.dsh-staging-'))).toBe(false)
    await service.dispose()
  })

  it('rejects a non-absolute catalog Java command before writing a staging tree', async () => {
    const { ctx } = context()
    const unsafeJava: CatalogSnapshot = {
      entries: [ENTRY], cached: false, stale: false,
      java: { available: true, version: 21, executable: 'java' },
    }
    const service = new MinecraftBootstrapService(ctx, {
      catalog: { load: async () => unsafeJava } as unknown as MinecraftCatalogResolver,
      wrapperJar: wrapperJar(),
    })
    const { operationId } = await service.start(request(root, { directoryName: 'relative-java' }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('jdk-mismatch')
    expect((await readdirSafe(root)).some(name => name.startsWith('relative-java.dsh-staging-'))).toBe(false)
    await service.dispose()
  })

  it('rejects a downloaded wrapper whose SHA-256 does not match the catalog', async () => {
    const { ctx } = context()
    const checksummedEntry = { ...ENTRY, wrapperSha256: 'a'.repeat(64) }
    const service = new MinecraftBootstrapService(ctx, {
      catalog: catalog([checksummedEntry]),
      wrapperJar: wrapperJar(),
    })
    const { operationId } = await service.start(request(root, {
      entryId: checksummedEntry.entryId,
      directoryName: 'checksum-failure',
    }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('checksum-mismatch')
    expect(failed.projectPath).toContain('.dsh-staging-')
    await service.dispose()
  })

  it('rejects an application cache that overlaps the final project path', async () => {
    const { ctx } = context()
    const service = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), cacheDirectory: join(root, 'cache-project'), build: vi.fn(),
    })
    const { operationId } = await service.start(request(root, { directoryName: 'cache-project' }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('cache-overlap')
    expect(await exists(join(root, 'cache-project'))).toBe(false)
    await service.dispose()
  })

  it('rejects a symlinked application cache without writing through it', async () => {
    const { ctx } = context()
    const realCache = join(root, 'real-cache')
    const linkedCache = join(root, 'linked-cache')
    await mkdir(realCache)
    await writeFile(join(realCache, 'sentinel.txt'), 'keep\n')
    await symlink(realCache, linkedCache, process.platform === 'win32' ? 'junction' : 'dir')
    const service = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), cacheDirectory: linkedCache, build: vi.fn(),
    })
    const { operationId } = await service.start(request(root, { directoryName: 'cache-symlink' }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('cache-symlink')
    expect(await readFile(join(realCache, 'sentinel.txt'), 'utf8')).toBe('keep\n')
    expect(await readdir(realCache)).toEqual(['sentinel.txt'])
    await service.dispose()
  })

  it('registers exactly one loopback RPC channel and never exposes a LAN authority', () => {
    const registrations: Array<{ channel: string; authority: string }> = []
    const fakeContext = {
      get: (): undefined => undefined,
      emit: (): void => {},
      provide: (): void => {},
      effect: (factory: () => unknown): void => { void factory() },
      connection: {
        rpc: {
          handle: (channel: string, _handler: unknown, options: { authority: string }): (() => Promise<void>) => {
            registrations.push({ channel, authority: options.authority })
            return async (): Promise<void> => {}
          },
        },
      },
    } as unknown as Context
    applyBootstrapService(fakeContext, { catalog: catalog() })
    expect(registrations).toEqual([{ channel: '/mc-bootstrap', authority: 'loopback' }])
  })

  it('serializes operations and exposes bounded log tails', async () => {
    const { ctx } = context()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const huge = '日志输出'.repeat(20_000)
    const build = vi.fn(async (
      _projectPath: string,
      _entry: CatalogEntry,
      signal: AbortSignal,
      append: (text: string) => Promise<void>,
    ) => {
      await append(huge)
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => {
          reject(new DOMException('aborted', 'AbortError'))
        }
        signal.addEventListener('abort', abort, { once: true })
        void gate.then(() => {
          signal.removeEventListener('abort', abort)
          resolve()
        })
      })
    })
    const service = new MinecraftBootstrapService(ctx, { catalog: catalog(), wrapperJar: wrapperJar(), build })
    const first = await service.start(request(root, { directoryName: 'first' }))
    await waitFor(service, first.operationId, snapshot => snapshot.stage === 'build')
    await expect(service.start(request(root, { directoryName: 'second' }))).rejects.toThrow('already being built')
    if (release === undefined) throw new Error('build gate was not initialized')
    release()
    const ready = await waitFor(service, first.operationId, snapshot => snapshot.status === 'ready')
    expect(Buffer.byteLength(ready.logTail, 'utf8')).toBeLessThanOrEqual(32 * 1024)
    expect(ready.logTail).toContain('日志输出')
    await service.dispose()
  })

  it('cancels a running process, retaining marked staging files for inspection', async () => {
    const { ctx } = context()
    const build = async (_projectPath: string, _entry: CatalogEntry, signal: AbortSignal): Promise<void> => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    }
    const service = new MinecraftBootstrapService(ctx, { catalog: catalog(), wrapperJar: wrapperJar(), build })
    const { operationId } = await service.start(request())
    await waitFor(service, operationId, snapshot => snapshot.stage === 'build')
    expect(service.cancel(operationId)).toBe(true)
    const cancelled = await waitFor(service, operationId, snapshot => snapshot.status === 'cancelled' && snapshot.projectPath !== undefined)
    expect(cancelled.projectPath).toMatch(/\.dsh-staging-/u)
    expect(await exists(join(cancelled.projectPath ?? '', '.dsh/bootstrap-state.json'))).toBe(true)
    expect(await exists(join(cancelled.projectPath ?? '', '.dsh/bootstrap.log'))).toBe(true)
    expect(service.cancel(operationId)).toBe(false)
    await service.dispose()
  })

  it('does not resume a staging tree after a generated file was modified', async () => {
    const { ctx } = context()
    const failingBuild = async (): Promise<void> => { throw new Error('compile failed') }
    const firstService = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(), build: failingBuild,
    })
    const first = await firstService.start(request())
    const failed = await waitFor(firstService, first.operationId, snapshot => snapshot.status === 'failed')
    const staging = failed.projectPath
    expect(staging).toBeDefined()
    await writeFile(join(staging ?? '', 'build.gradle'), 'tampered by user\n', 'utf8')
    await firstService.dispose()

    const secondService = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(), build: vi.fn(),
    })
    const second = await secondService.start(request())
    const resumed = await waitFor(secondService, second.operationId, snapshot => snapshot.status === 'failed')
    expect(resumed.failureCode).toBe('staging-modified')
    expect(resumed.projectPath).toBe(staging)
    await secondService.dispose()
  })

  it('does not resume a staging tree containing an extra source file', async () => {
    const { ctx } = context()
    const firstService = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(),
      build: async (): Promise<void> => { throw new Error('compile failed') },
    })
    const first = await firstService.start(request(root, { directoryName: 'extra-source' }))
    const failed = await waitFor(firstService, first.operationId, snapshot => snapshot.status === 'failed')
    const staging = failed.projectPath
    expect(staging).toBeDefined()
    const extra = join(staging ?? '', 'src/main/java/com/example/copper_tools/Injected.java')
    await writeFile(extra, 'package com.example.copper_tools;\nclass Injected {}\n', 'utf8')
    await firstService.dispose()

    const secondService = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(), build: vi.fn(),
    })
    const second = await secondService.start(request(root, { directoryName: 'extra-source' }))
    const resumed = await waitFor(secondService, second.operationId, snapshot => snapshot.status === 'failed')
    expect(resumed.failureCode).toBe('staging-modified')
    expect(resumed.projectPath).toBe(staging)
    await secondService.dispose()
  })

  it('does not reuse a staging tree when the requested project identity changes', async () => {
    const { ctx } = context()
    const firstService = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(),
      build: async (): Promise<void> => { throw new Error('compile failed') },
    })
    const first = await firstService.start(request(root, { directoryName: 'changed-request' }))
    const failed = await waitFor(firstService, first.operationId, snapshot => snapshot.status === 'failed')
    await firstService.dispose()

    const secondService = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(), build: vi.fn(),
    })
    const second = await secondService.start(request(root, {
      directoryName: 'changed-request', modName: 'A Different Mod',
    }))
    const refused = await waitFor(secondService, second.operationId, snapshot => snapshot.status === 'failed')
    expect(refused.failureCode).toBe('staging-modified')
    expect(refused.projectPath).toBe(failed.projectPath)
    await secondService.dispose()
  })

  it('revalidates deterministic inputs before committing a successful build', async () => {
    const { ctx } = context()
    const service = new MinecraftBootstrapService(ctx, {
      catalog: catalog(), wrapperJar: wrapperJar(),
      build: async (projectPath): Promise<void> => {
        await writeFile(join(projectPath, 'unexpected.gradle'), 'malicious build input\n', 'utf8')
      },
    })
    const { operationId } = await service.start(request(root, { directoryName: 'final-recheck' }))
    const failed = await waitFor(service, operationId, snapshot => snapshot.status === 'failed')
    expect(failed.failureCode).toBe('staging-modified')
    expect(await exists(join(root, 'final-recheck'))).toBe(false)
    expect(failed.projectPath).toContain('.dsh-staging-')
    await service.dispose()
  })

  it('keeps the RPC surface narrow and rejects unknown or malformed endpoints', async () => {
    const { ctx } = context()
    const service = new MinecraftBootstrapService(ctx, { catalog: catalog(), wrapperJar: wrapperJar() })
    const signal = new AbortController().signal
    expect((await service.handleRpc('unknown', {}, signal)).ok).toBe(false)
    expect((await service.handleRpc('start', { entryId: ENTRY.entryId }, signal)).ok).toBe(false)
    const unknownStatus = await service.handleRpc('status', { operationId: 'missing' }, signal)
    expect(unknownStatus).toMatchObject({ ok: false })
    const catalogResult = await service.handleRpc('catalog', {}, signal)
    expect(catalogResult).toMatchObject({ ok: true, value: { entries: [ENTRY] } })
    await service.dispose()
  })
})
