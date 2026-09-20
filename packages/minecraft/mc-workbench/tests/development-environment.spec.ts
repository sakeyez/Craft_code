import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { developmentEnvironment, saveDevelopmentEnvironment } from '../src/development-environment.ts'
import { repairLoomManifest } from '../src/loom-cache.ts'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'craftcode-environment-')) })
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

it('keeps the bootstrap cache and JDK paths across subsequent development operations', async () => {
  const cache = join(root, 'bootstrap-cache')
  const binding = await developmentEnvironment(root, [], cache)
  await saveDevelopmentEnvironment(root, binding, [{ major: 21, executable: join(root, 'jdk/bin/java'), managed: true, available: true }])
  vi.stubEnv('GRADLE_USER_HOME', join(root, 'other-cache'))
  const reused = await developmentEnvironment(root, [])
  expect(reused.gradleUserHome).toBe(cache)
  expect(reused.jdks).toEqual([{ major: 21, executable: join(root, 'jdk/bin/java'), managed: true }])
  expect(reused.fingerprint).toBe(binding.fingerprint)
})

it('invalidates JDK selection after build input changes without moving or erasing caches', async () => {
  await writeFile(join(root, 'build.gradle'), 'version = "1"')
  const binding = await developmentEnvironment(root, ['build.gradle'], join(root, 'cache'))
  await saveDevelopmentEnvironment(root, binding, [{ major: 21, executable: '/jdk/bin/java', managed: false, available: true }])
  await writeFile(join(root, 'build.gradle'), 'version = "2"')
  const changed = await developmentEnvironment(root, ['build.gradle'])
  expect(changed.fingerprint).not.toBe(binding.fingerprint)
  expect(changed.jdks).toEqual([])
  expect(changed.gradleUserHome).toBe(binding.gradleUserHome)
})

it('blocks malformed environment records instead of silently choosing a different cache', async () => {
  await mkdir(join(root, '.dsh'))
  await writeFile(join(root, '.dsh/environment.json'), '{')
  await expect(developmentEnvironment(root, [])).rejects.toThrow()
})

it('repairs a truncated Loom manifest from valid local metadata and leaves locks intact', async () => {
  const cache = join(root, 'caches/fabric-loom')
  await mkdir(cache, { recursive: true })
  const valid = JSON.stringify({ versions: [{ id: '1.21.1', url: 'https://piston-meta.mojang.com/v1/packages/version.json', sha1: 'a'.repeat(40) }] })
  await writeFile(join(cache, 'versions_manifest.json'), valid)
  await writeFile(join(cache, 'mojang_versions_manifest.json'), '{"versions":[')
  await writeFile(join(cache, '.lock'), 'another owner')
  expect(await repairLoomManifest(root)).toBe(true)
  expect(await readFile(join(cache, 'mojang_versions_manifest.json'), 'utf8')).toBe(valid)
  expect(await readFile(join(cache, '.lock'), 'utf8')).toBe('another owner')
  expect(await repairLoomManifest(root)).toBe(false)
})

it('does not repair metadata from an untrusted or also malformed local alternative', async () => {
  const cache = join(root, 'caches/fabric-loom')
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, 'mojang_versions_manifest.json'), '{')
  await writeFile(join(cache, 'versions_manifest.json'), JSON.stringify({ versions: [{ id: '1.21.1', url: 'https://example.com/version.json', sha1: 'a'.repeat(40) }] }))
  expect(await repairLoomManifest(root)).toBe(false)
  expect(await readFile(join(cache, 'mojang_versions_manifest.json'), 'utf8')).toBe('{')
})
