// @vitest-environment node

import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { MinecraftCatalogResolver, probeJava } from '../src/catalog.ts'
import { MinecraftBootstrapService } from '../src/service.ts'
import type { BootstrapStartRequest, CatalogEntry, OperationSnapshot } from '../src/types.ts'

/** Opt-in because these cases download Gradle, mappings, and loader artifacts. */
const enabled = process.env.DSH_MCMOD_BOOTSTRAP_REAL === '1'

function fixtureContext(): Context {
  return { emit: (): void => {}, get: () => undefined } as unknown as Context
}

function fixtureCatalog(entry: CatalogEntry, executable: string): MinecraftCatalogResolver {
  return {
    load: async () => ({
      entries: [entry], cached: false, stale: false,
      java: { available: true, version: entry.requiredJdk, executable },
    }),
  } as unknown as MinecraftCatalogResolver
}

function request(root: string, entry: CatalogEntry): BootstrapStartRequest {
  return {
    entryId: entry.entryId,
    parentDirectory: root,
    directoryName: `${entry.loader}-real-${entry.minecraftVersion.replaceAll('.', '_')}`,
    modName: 'Real Bootstrap Fixture',
    modId: `real_${entry.loader}`,
    packageName: `com.example.real_${entry.loader}`,
  }
}

async function waitFor(service: MinecraftBootstrapService, operationId: string): Promise<OperationSnapshot> {
  const deadline = Date.now() + 30 * 60 * 1_000
  while (Date.now() < deadline) {
    const snapshot = service.status(operationId)
    if (snapshot !== undefined && ['ready', 'failed', 'cancelled'].includes(snapshot.status)) return snapshot
    await new Promise((resolve) => { setTimeout(resolve, 500) })
  }
  throw new Error(`bootstrap operation timed out: ${operationId}`)
}

async function command(executable: string, args: readonly string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.once('error', (error) => { resolve({ code: -1, output: `${output}\n${error.message}` }) })
    child.once('close', (code) => { resolve({ code: code ?? -1, output }) })
  })
}

async function assertBuild(entry: CatalogEntry): Promise<{ root: string; snapshot: OperationSnapshot }> {
  const root = await mkdtemp(join(tmpdir(), `dsh-mc-bootstrap-${entry.loader}-`))
  const java = await probeJava()
  if (!java.available || java.version !== entry.requiredJdk || java.executable === undefined) {
    throw new Error(`real bootstrap Java probe mismatch: expected JDK ${entry.requiredJdk}`)
  }
  const service = new MinecraftBootstrapService(fixtureContext(), {
    catalog: fixtureCatalog(entry, java.executable),
    cacheDirectory: join(root, '.cache'),
  })
  try {
    const started = await service.start(request(root, entry))
    const snapshot = await waitFor(service, started.operationId)
    if (snapshot.status !== 'ready' || snapshot.projectPath === undefined) {
      throw new Error(`${entry.loader} bootstrap failed: ${snapshot.failureCode ?? 'unknown'} ${snapshot.message ?? ''}\n${snapshot.logTail}`)
    }
    const project = snapshot.projectPath
    await access(join(project, 'gradlew.bat'))
    const jars = (await readdir(join(project, 'build/libs'))).filter(file => file.endsWith('.jar'))
    expect(jars.length).toBeGreaterThan(0)
    const metadata = entry.loader === 'fabric'
      ? 'src/main/resources/fabric.mod.json'
      : `src/main/resources/META-INF/${entry.minecraftVersion === '1.20.2' || entry.minecraftVersion === '1.20.4' ? 'mods.toml' : 'neoforge.mods.toml'}`
    expect(await readFile(join(project, metadata), 'utf8')).toContain(`real_${entry.loader}`)
    const listing = await command('jar.exe', ['tf', join(project, 'build/libs', jars[0]!)], project)
    expect(listing.code, listing.output).toBe(0)
    expect(listing.output).toContain(`com/example/real_${entry.loader}/Mod.class`)
    return { root, snapshot }
  } finally {
    await service.dispose()
  }
}

async function withRequiredJava<T>(entry: CatalogEntry, action: () => Promise<T>): Promise<T> {
  const envName = entry.requiredJdk === 17 ? 'DSH_MCMOD_JDK17_HOME' : 'DSH_MCMOD_JDK21_HOME'
  const configuredHome = process.env[envName]
  const current = await probeJava()
  if (configuredHome === undefined && current.version !== entry.requiredJdk) {
    throw new Error(`real bootstrap gate requires JDK ${entry.requiredJdk}; set ${envName}`)
  }
  const executable = configuredHome === undefined
    ? undefined
    : join(configuredHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (executable !== undefined) await access(executable)
  const previousHome = process.env.JAVA_HOME
  const previousPath = process.env.PATH
  if (configuredHome !== undefined) {
    process.env.JAVA_HOME = configuredHome
    process.env.PATH = `${join(configuredHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${previousPath ?? ''}`
  }
  try { return await action() }
  finally {
    if (previousHome === undefined) delete process.env.JAVA_HOME
    else process.env.JAVA_HOME = previousHome
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
  }
}

function pick(entries: readonly CatalogEntry[], loader: CatalogEntry['loader'], version: '1.20.1' | 'earliest-1.20' | 'highest-1.21'): CatalogEntry {
  const candidates = entries.filter(entry => entry.loader === loader)
  const selected = version === '1.20.1'
    ? candidates.find(entry => entry.minecraftVersion === '1.20.1')
    : version === 'earliest-1.20'
      ? candidates.filter(entry => entry.minecraftVersion.startsWith('1.20.')).at(-1)
      : candidates.find(entry => entry.minecraftVersion === '1.21' || entry.minecraftVersion.startsWith('1.21.'))
  if (selected === undefined) throw new Error(`real catalog has no ${loader} ${version} entry`)
  return selected
}

describe.skipIf(!enabled)('real host Minecraft bootstrap builds', { concurrent: false }, () => {
  let entries: readonly CatalogEntry[] = []

  beforeAll(async () => {
    const snapshot = await new MinecraftCatalogResolver().load()
    if (snapshot.entries.length === 0) throw new Error(snapshot.error ?? 'real catalog is empty')
    entries = snapshot.entries
  }, 90_000)

  it('builds Fabric 1.20.1 with the host wrapper', async () => {
    const entry = pick(entries, 'fabric', '1.20.1')
    const result = await withRequiredJava(entry, () => assertBuild(entry))
    await rm(result.root, { recursive: true, force: true })
  }, 35 * 60 * 1_000)

  it('builds the highest stable Fabric 1.21.x with the host wrapper', async () => {
    const entry = pick(entries, 'fabric', 'highest-1.21')
    const result = await withRequiredJava(entry, () => assertBuild(entry))
    await rm(result.root, { recursive: true, force: true })
  }, 35 * 60 * 1_000)

  it('builds the earliest stable NeoForge 1.20.x with the host wrapper', async () => {
    const entry = pick(entries, 'neoforge', 'earliest-1.20')
    const result = await withRequiredJava(entry, () => assertBuild(entry))
    await rm(result.root, { recursive: true, force: true })
  }, 35 * 60 * 1_000)

  it('builds the highest stable NeoForge 1.21.x with the host wrapper', async () => {
    const entry = pick(entries, 'neoforge', 'highest-1.21')
    const result = await withRequiredJava(entry, () => assertBuild(entry))
    await rm(result.root, { recursive: true, force: true })
  }, 35 * 60 * 1_000)
})
