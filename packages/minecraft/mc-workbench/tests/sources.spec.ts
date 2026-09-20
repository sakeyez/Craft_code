import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MinecraftSources } from '../src/sources.ts'
import { hash } from '../src/files.ts'
import type { Dependency } from '../src/types.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-sources-'))
  vi.stubEnv('DSH_HOME', root)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

it('reuses verified associated sources after restart and keeps reads immutable', async () => {
  const bytes = zipSync({ 'fabric.mod.json': strToU8('{"id":"target","version":"1.0.0"}') })
  const sha256 = hash(bytes)
  const file = `.dsh/dependencies/${sha256}.jar`
  await mkdir(join(root, '.dsh/dependencies'), { recursive: true })
  await writeFile(join(root, file), bytes)
  const archive = join(root, 'sources.jar')
  await writeFile(archive, zipSync({ 'example/Target.java': strToU8('package example; public class Target {}') }))
  const dependency: Dependency = {
    id: 'local:target',
    name: 'Target',
    version: '1.0.0',
    role: 'required',
    enabled: true,
    source: { kind: 'local', path: file },
    sha256,
    file,
    dependencies: [],
    automatic: false,
    compatibility: 'unknown',
    warnings: [],
  }
  const first = new MinecraftSources({} as Context)
  const started = await first.start(root, dependency, archive)
  await expect.poll(() => first.status(root, started.id).status).toBe('ready')
  expect(await first.read(root, started.id, 'example/Target.java')).toMatchObject({
    readonly: true,
    text: 'package example; public class Target {}',
  })
  await expect(first.read(root, started.id, '../../outside')).rejects.toThrow('超出')
  const cache = join(root, 'cache/minecraft-workbench/sources')
  const before = await readdir(cache)
  await first.dispose()
  const second = new MinecraftSources({} as Context)
  const resumed = await second.start(root, dependency, archive)
  await expect.poll(() => second.status(root, resumed.id).status).toBe('ready')
  expect(await readdir(cache)).toEqual(before)
  const index = before.find(name => name.endsWith('.json'))!
  const cached = JSON.parse(await readFile(join(cache, index), 'utf8')) as { directory: string }
  await writeFile(join(cache, cached.directory, 'example/Target.java'), 'corrupted')
  const repaired = await second.start(root, dependency, archive)
  await expect.poll(() => second.status(root, repaired.id).status).toBe('ready')
  expect((await second.read(root, repaired.id, 'example/Target.java')).text).toContain('public class Target')
  await second.dispose()
})
