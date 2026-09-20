import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { inspectMinecraftProject } from '@deepseek-ai/dsh-tool-mc-project'
import { projectInputs } from '../src/project-inputs.ts'
import { hash } from '../src/files.ts'
import { queryMinecraftApi, recordApiClasspath } from '../src/api-query.ts'
import { previewResource } from '../src/resource-preview.ts'
import { CurseForge } from '../src/curseforge.ts'
import { MinecraftDependencies } from '../src/dependencies.ts'
import { zipSync, strToU8 } from 'fflate'
import { createHash, randomUUID } from 'node:crypto'

let root: string
let ctx: Context
const signal = new AbortController().signal
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-devtools-'))
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await mkdir(join(root, 'src/main/resources/assets/example/models/item'), { recursive: true })
  await writeFile(
    join(root, 'build.gradle'),
    'plugins { id "fabric-loom" version "1.8.12" }\ndependencies { minecraft "com.mojang:minecraft:1.21.1"; mappings "net.fabricmc:yarn:1.21.1+build.3:v2" }\n',
  )
  await writeFile(join(root, 'settings.gradle'), 'rootProject.name="example"\n')
  await writeFile(
    join(root, 'src/main/resources/fabric.mod.json'),
    JSON.stringify({ schemaVersion: 1, id: 'example', version: '1.0.0', depends: { minecraft: '1.21.1' } }),
  )
  await mkdir(join(root, '.dsh/api-cache'), { recursive: true })
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

it('requires exact API versions and reuses offline results without upgrading external evidence', async () => {
  const jar = join(root, '.dsh/library.jar')
  await writeFile(jar, 'classpath')
  const data = {
    format: 1,
    fingerprint: (await projectInputs(root)).fingerprint,
    minecraft: '1.21.1',
    namespace: 'yarn',
    java: 21,
    files: [{ path: jar, sha256: hash('classpath') }],
  }
  await writeFile(join(root, '.dsh/api-classpath.json'), JSON.stringify(data))
  const symbol = 'net.minecraft.world.World'
  const key = hash(JSON.stringify({ data, symbol, external: true }))
  await writeFile(
    join(root, '.dsh/api-cache', `${key}.json`),
    JSON.stringify({
      symbol,
      version: '1.21.1',
      namespace: 'mappings.dev',
      verified: false,
      source: 'https://mappings.dev/1.21.1/',
      cached: false,
      text: 'external evidence',
    }),
  )
  const network = vi.fn(() => {
    throw new Error('offline')
  })
  vi.stubGlobal('fetch', network)
  await expect(queryMinecraftApi(ctx, root, { symbol, version: '1.20.1' }, signal)).rejects.toThrow('不一致')
  await expect(queryMinecraftApi(ctx, root, { symbol, external: true }, signal)).resolves.toMatchObject({
    cached: true,
    verified: false,
  })
  expect(network).not.toHaveBeenCalled()
  await writeFile(jar, 'changed')
  await expect(queryMinecraftApi(ctx, root, { symbol, external: true }, signal)).rejects.toThrow('classpath 已变化')
})

it('resolves model inheritance and reports unsaved drafts, missing textures and unsupported animation', async () => {
  const path = 'src/main/resources/assets/example/models/item/test.json'
  const parent = { parent: 'minecraft:item/generated', textures: { layer0: 'example:item/test' } }
  await writeFile(join(root, 'src/main/resources/assets/example/models/item/base.json'), JSON.stringify(parent))
  await writeFile(join(root, path), JSON.stringify({ parent: 'example:item/base' }))
  await mkdir(join(root, 'src/main/resources/assets/example/textures/item'), { recursive: true })
  const texture = join(root, 'src/main/resources/assets/example/textures/item/test.png')
  await writeFile(
    texture,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  expect(await previewResource(ctx, root, { path }, signal)).toMatchObject({
    kind: 'generated',
    draft: false,
    missing: [],
  })
  expect(await previewResource(ctx, root, { path, draft: JSON.stringify({ elements: [{
    from: [0, 0, 0], to: [16, 16, 16], faces: { south: { texture: 'example:item/test' } },
  }] }) }, signal)).toMatchObject({ kind: 'model', draft: true, missing: [] })
  const draft = JSON.stringify({ parent: 'item/generated', textures: { layer0: 'example:missing' } })
  expect(await previewResource(ctx, root, { path, draft }, signal)).toMatchObject({
    kind: 'unsupported',
    draft: true,
    missing: ['example:missing'],
  })
  expect(await readFile(join(root, path), 'utf8')).not.toBe(draft)
  await writeFile(texture + '.mcmeta', '{"animation":{}}')
  expect(await previewResource(ctx, root, { path }, signal)).toMatchObject({
    kind: 'unsupported',
    unsupported: [expect.stringContaining('动画')],
  })
})

it('records exact classpath evidence while retaining an unknown mapping namespace', async () => {
  const project = await inspectMinecraftProject(ctx, root)
  project.mappings = { status: 'unknown', candidates: [] }
  const jar = join(root, '.dsh/library.jar')
  await writeFile(jar, 'exact binary')
  await recordApiClasspath(root, { classpath: [jar], modules: [], artifacts: [] }, project,
    (await projectInputs(root)).fingerprint, 21)
  const value: unknown = JSON.parse(await readFile(join(root, '.dsh/api-classpath.json'), 'utf8'))
  expect(value).toMatchObject({ minecraft: '1.21.1', namespace: 'unknown', files: [{ sha256: hash('exact binary') }] })
})

it('does not request CurseForge without credentials or guess a restricted file URL', async () => {
  const project = await inspectMinecraftProject(ctx, root)
  const fetch = vi.fn(
    async (input: string | URL) =>
      new Response(
        JSON.stringify(
          String(input).endsWith('/files/2')
            ? {
              data: {
                id: 2,
                modId: 1,
                displayName: 'mod',
                fileName: 'mod.jar',
                downloadUrl: null,
                gameVersions: ['1.21.1', 'Fabric'],
                hashes: [],
                dependencies: [],
                isAvailable: true,
              },
            }
            : { data: { links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/example' } } },
        ),
      ),
  )
  vi.stubGlobal('fetch', fetch)
  const service = new CurseForge(ctx)
  await expect(service.search(project, 'example')).rejects.toThrow('未配置')
  expect(fetch).not.toHaveBeenCalled()
  ctx.provide('credentials', { resolve: async () => ({ value: 'test-only-key' }) })
  await expect(service.file(project, 1, 2)).rejects.toThrow('https://www.curseforge.com/minecraft/mc-mods/example')
  expect(fetch.mock.calls.every(([url]) => String(url).startsWith('https://api.curseforge.com/v1/mods/1'))).toBe(true)
})

it.each([false, true])('rejects CurseForge incompatible siblings regardless of traversal order (%s)', async (reverse) => {
  const project = await inspectMinecraftProject(ctx, root)
  const children = [{ modId: 2, relationType: 3 }, { modId: 3, relationType: 3 }]
  if (reverse) children.reverse()
  const archives = new Map([1, 2, 3].map(id => [id, zipSync({
    'fabric.mod.json': strToU8(JSON.stringify({ schemaVersion: 1, id: `fixture_${id}`, version: '1.0.0', name: randomUUID() })),
  })]))
  ctx.provide('credentials', { resolve: async () => ({ value: 'test-only-key' }) })
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(input)
    const id = Number(url.hostname === 'fixture.invalid' ? url.pathname.slice(1) : url.pathname.split('/')[3])
    const archive = archives.get(id)!
    if (url.hostname === 'fixture.invalid') return new Response(Buffer.from(archive))
    const file = { id: id * 10, modId: id, displayName: `fixture_${id}`, fileName: `fixture_${id}.jar`,
      downloadUrl: `https://fixture.invalid/${id}`, gameVersions: ['1.21.1', 'Fabric'],
      hashes: [{ algo: 1, value: createHash('sha1').update(archive).digest('hex') }],
      dependencies: id === 1 ? children : id === 2 ? [{ modId: 3, relationType: 5 }] : [], isAvailable: true }
    return new Response(JSON.stringify({ data: url.pathname.endsWith('/files') ? [file] : file }))
  }))
  const service = new MinecraftDependencies(new CurseForge(ctx))
  await expect(service.preview(root, project, { source: { kind: 'curseforge', projectId: 1, fileId: 10 } })).rejects.toThrow('不兼容')
  expect((await service.read(root)).dependencies).toEqual([])
})
