import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { inspectMinecraftProject } from '@deepseek-ai/dsh-tool-mc-project'
import { MinecraftDependencies } from '../src/dependencies.ts'

let root: string
let ctx: Context
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-dependencies-'))
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await mkdir(join(root, 'src/main/resources'), { recursive: true })
  await writeFile(
    join(root, 'build.gradle'),
    'plugins { id "fabric-loom" version "1.7.4" }\ndependencies { minecraft "com.mojang:minecraft:1.21.1" }\n',
  )
  await writeFile(join(root, 'settings.gradle'), 'rootProject.name = "example"\n')
  await writeFile(
    join(root, 'src/main/resources/fabric.mod.json'),
    JSON.stringify({ schemaVersion: 1, id: 'example', version: '1.0.0', depends: { minecraft: '1.21.1' } }, null, 2) +
      '\n',
  )
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})
async function jar(id: string): Promise<string> {
  const path = join(root, `${id}.jar`)
  await writeFile(
    path,
    zipSync({ 'fabric.mod.json': strToU8(JSON.stringify({ schemaVersion: 1, id, name: id, version: '1.0.0' })) }),
  )
  return path
}
describe('dependency transactions', () => {
  it('applies incompatibility ranges to the actual installed version', async () => {
    const service = new MinecraftDependencies()
    const project = await inspectMinecraftProject(ctx, root)
    const base = await service.preview(root, project, { source: { kind: 'local', path: await jar('base') } })
    await service.apply(root, base.id)
    const target = join(root, 'target.jar')
    for (const [range, rejected] of [['>=2.0.0', false], ['<2.0.0', true]] as const) {
      await writeFile(target, zipSync({ 'fabric.mod.json': strToU8(JSON.stringify({
        schemaVersion: 1, id: 'target', version: '1.0.0', breaks: { base: range },
      })) }))
      const plan = service.preview(root, project, { source: { kind: 'local', path: target } })
      if (rejected) await expect(plan).rejects.toThrow('不兼容')
      else expect((await plan).dependencies).toHaveLength(2)
    }
  })
  it('resolves recursive test predecessors without adding product or compilation dependencies', async () => {
    const releases = new Map<string, object>()
    const archives = new Map<string, Uint8Array>()
    for (const [id, child] of [
      ['target', 'middle'],
      ['middle', 'base'],
      ['base', undefined],
    ] as const) {
      const archive = zipSync({
        'fabric.mod.json': strToU8(JSON.stringify({ schemaVersion: 1, id, version: '1.0.0' })),
      })
      archives.set(id, archive)
      releases.set(id, {
        id,
        project_id: id,
        name: id,
        version_number: '1.0.0',
        game_versions: ['1.21.1'],
        loaders: ['fabric'],
        files: [
          {
            filename: `${id}.jar`,
            url: `https://cdn.modrinth.com/${id}`,
            hashes: { sha512: createHash('sha512').update(archive).digest('hex') },
          },
        ],
        dependencies: child ? [{ project_id: child, version_id: child, dependency_type: 'required' }] : [],
      })
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        const url = new URL(input)
        const id = url.pathname.split('/').at(-1)!
        return new Response(
          url.hostname === 'cdn.modrinth.com' ? Buffer.from(archives.get(id)!) : JSON.stringify(releases.get(id)),
        )
      }),
    )
    const service = new MinecraftDependencies()
    const project = await inspectMinecraftProject(ctx, root)
    const plan = await service.preview(root, project, {
      source: { kind: 'modrinth', projectId: 'target', versionId: 'target' },
      role: 'test',
    })
    expect(plan.dependencies).toHaveLength(3)
    const gradle = plan.changes.find(row => row.path === '.dsh/dependencies.gradle')!.after!
    expect(gradle.match(/modLocalRuntime/gu)).toHaveLength(3)
    expect(gradle).not.toContain('modImplementation')
    const metadata = JSON.parse(plan.changes.find(row => row.path.endsWith('fabric.mod.json'))!.after!) as {
      depends: Record<string, string>
    }
    expect(metadata.depends).toEqual({ minecraft: '1.21.1' })
    await service.apply(root, plan.id)
    const remove = await service.preview(root, project, { removeId: 'modrinth:target' })
    expect(remove.dependencies).toHaveLength(0)
  })
  it('rejects incompatible required versions before changing project files', async () => {
    const service = new MinecraftDependencies()
    const project = await inspectMinecraftProject(ctx, root)
    const base = await service.preview(root, project, {
      source: { kind: 'local', path: await jar('base') },
      role: 'required',
    })
    await service.apply(root, base.id)
    const target = join(root, 'target.jar')
    await writeFile(
      target,
      zipSync({
        'fabric.mod.json': strToU8(
          JSON.stringify({ schemaVersion: 1, id: 'target', version: '1.0.0', depends: { base: '>=2.0.0' } }),
        ),
      }),
    )
    const before = await readFile(join(root, '.dsh/dependencies.json'), 'utf8')
    await expect(
      service.preview(root, project, { source: { kind: 'local', path: target }, role: 'required' }),
    ).rejects.toThrow('当前为 1.0.0')
    expect(await readFile(join(root, '.dsh/dependencies.json'), 'utf8')).toBe(before)
  })
  it('previews optional compile/runtime wiring and removes only managed dependencies', async () => {
    const service = new MinecraftDependencies()
    const source = { kind: 'local' as const, path: await jar('target_mod') }
    const project = await inspectMinecraftProject(ctx, root)
    const plan = await service.preview(root, project, { source, role: 'optional' })
    expect(plan.changes.find(row => row.path === '.dsh/dependencies.gradle')?.after).toContain('modCompileOnly')
    expect(plan.changes.find(row => row.path === '.dsh/dependencies.gradle')?.after).toContain('modLocalRuntime')
    expect(plan.changes.find(row => row.path.endsWith('fabric.mod.json'))?.after).toContain('"suggests"')
    await service.apply(root, plan.id)
    const entry = (await service.read(root)).dependencies[0]!
    const disabled = await service.preview(root, project, { updateId: entry.id, enabled: false })
    expect(disabled.changes.find(row => row.path === '.dsh/dependencies.gradle')?.after).not.toContain(
      'modLocalRuntime',
    )
    await service.apply(root, disabled.id)
    const removed = await service.preview(root, project, { removeId: entry.id })
    await service.apply(root, removed.id)
    expect((await service.read(root)).dependencies).toEqual([])
    expect(
      (
        JSON.parse(await readFile(join(root, 'src/main/resources/fabric.mod.json'), 'utf8')) as {
          depends: { minecraft: string }
        }
      ).depends.minecraft,
    ).toBe('1.21.1')
    expect(await readFile(source.path)).toBeTruthy()
  })
  it('refuses to apply a preview after an external edit', async () => {
    const service = new MinecraftDependencies()
    const project = await inspectMinecraftProject(ctx, root)
    const plan = await service.preview(root, project, {
      source: { kind: 'local', path: await jar('target') },
      role: 'test',
    })
    const changed = '// user changed build\n'
    await writeFile(join(root, 'build.gradle'), changed)
    await expect(service.apply(root, plan.id)).rejects.toThrow('已变化')
    expect(await readFile(join(root, 'build.gradle'), 'utf8')).toBe(changed)
    expect((await service.read(root)).dependencies).toHaveLength(0)
  })
  it('recovers an interrupted transaction and preserves unrelated metadata', async () => {
    const before = await readFile(join(root, 'build.gradle'), 'utf8')
    const after = before + '\n// partial write\n'
    await mkdir(join(root, '.dsh'))
    await writeFile(
      join(root, '.dsh/dependency-transaction.json'),
      JSON.stringify([{ path: 'build.gradle', before, after }]),
    )
    await writeFile(join(root, 'build.gradle'), after)
    await new MinecraftDependencies().read(root)
    expect(await readFile(join(root, 'build.gradle'), 'utf8')).toBe(before)
  })
})
