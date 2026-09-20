import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MinecraftCatalogResolver,
  normalizeCatalogEntries,
  parseFabricApiVersion,
  parseFabricGameVersions,
  parseFabricLoaderVersions,
  parseFabricYarnVersions,
  parseJavaMajor,
  parseNeoForgeDirectoryIndex,
  parseNeoForgeMdkLoader,
  parseNeoForgeMdkRecipe,
  parseNeoForgeMdkRepositories,
  parseNeoForgeMetadata,
} from '../src/catalog.ts'
import { fabricEntry, neoForgeEntry } from '../src/catalog.ts'
import type { CatalogEntry } from '../src/types.ts'
import { isCatalogEntry, isSupportedNeoForgeMinecraftVersion } from '../src/validation.ts'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function response(value: unknown, status = 200): Response {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'content-type': typeof value === 'string' ? 'application/xml' : 'application/json' },
  })
}

function neoForgeMdkResponse(url: string): Response | undefined {
  if (!url.includes('raw.githubusercontent.com/NeoForgeMDKs/')) return undefined
  const legacy = url.includes('MDK-1.20.2-')
  if (url.endsWith('/build.gradle')) {
    return response(`id 'net.neoforged.gradle.userdev' version '${legacy ? '7.0.116' : '7.1.38'}'`)
  }
  if (url.endsWith('/gradle/wrapper/gradle-wrapper.properties')) {
    return response(`distributionUrl=https\\://services.gradle.org/distributions/gradle-${legacy ? '8.14.5' : '9.2.1'}-bin.zip`)
  }
  if (url.endsWith('/gradle.properties')) {
    const version = /MDK-(1\.\d+(?:\.\d+)?)-NeoGradle/u.exec(url)?.[1] ?? '1.21.1'
    const loaders: Readonly<Record<string, string>> = {
      '1.20.2': '20.2.93',
      '1.20.4': '20.4.237',
      '1.21.1': '21.1.176',
      '1.21.11': '21.11.45',
    }
    return response(`neo_version=${loaders[version] ?? '0.0.0'}`)
  }
  if (url.includes('/src/main/resources/META-INF/')) return response('[[mods]]')
  return undefined
}

describe('Minecraft catalog parsing', () => {
  it('filters unstable, unsupported, and 26.x game versions and sorts newest first', () => {
    expect(parseFabricGameVersions([
      { version: '1.20.1', stable: true },
      { version: '1.21.10', stable: true },
      { version: '1.21.11-pre1', stable: false },
      { version: '26.1.0', stable: true },
      { version: '1.19.4', stable: true },
      { version: '1.21.10', stable: true },
      { version: 42, stable: true },
    ])).toEqual(['1.21.10', '1.20.1'])
  })

  it('parses only stable Fabric loader rows with resolved intermediary mappings', () => {
    expect(parseFabricLoaderVersions([
      { loader: { version: '0.16.5', stable: true }, intermediary: { version: '1.21.1' }, yarn: { version: '1.21.1+build.3' } },
      { loader: { version: '0.17.0-beta', stable: false }, intermediary: { version: 'x' } },
      { loader: { version: '0.16.4', stable: true }, intermediary: { version: 'intermediary-1' } },
      { loader: { version: 1, stable: true } },
    ])).toEqual([
      { loader: '0.16.5', intermediary: '1.21.1' },
      { loader: '0.16.4', intermediary: 'intermediary-1' },
    ])
    expect(parseFabricLoaderVersions([{ loader: { version: '0.16.5', stable: true } }])).toEqual([])
  })

  it('selects the newest API publication for the requested game version', () => {
    const xml = '<metadata><versioning><versions>'
      + '<version>0.101.2+1.21.1</version><version>0.102.0+1.21.1</version>'
      + '<version>0.103.0+1.21.2</version><version>0.102.0-beta+1.21.1</version>'
      + '</versions></versioning></metadata>'
    expect(parseFabricApiVersion(xml, '1.21.1')).toBe('0.102.0+1.21.1')
    expect(parseFabricApiVersion(xml, '1.20.1')).toBeUndefined()
  })

  it('selects a real Yarn coordinate instead of synthesizing one', () => {
    expect(parseFabricYarnVersions([
      { gameVersion: '1.21.1', version: '1.21.1+build.2', build: 2, stable: false },
      { gameVersion: '1.21.1', version: '1.21.1+build.3', build: 3, stable: false },
      { gameVersion: '1.21.1', version: '1.21.1-pre+build.1', build: 1, stable: false },
      { gameVersion: '1.20.1', version: '1.20.1+build.10', build: 10, stable: false },
    ], '1.21.1')).toEqual(['1.21.1+build.3', '1.21.1+build.2'])
    expect(parseFabricYarnVersions([{ gameVersion: '1.21.1', version: 'not-a-yarn-coordinate' }], '1.21.1')).toEqual([])
  })

  it('maps NeoForge metadata to real 1.20.x/1.21.x lines only', () => {
    const xml = '<metadata><versioning><versions>'
      + '<version>20.4.237</version><version>20.1.99</version>'
      + '<version>21.0.80</version>'
      + '<version>21.1.176</version><version>21.1.177-rc1</version>'
      + '<version>21.2.0-beta</version><version>garbage</version>'
      + '</versions></versioning></metadata>'
    expect(parseNeoForgeMetadata(xml)).toEqual([
      { minecraftVersion: '1.21.1', loaderVersion: '21.1.176' },
      { minecraftVersion: '1.21', loaderVersion: '21.0.80' },
      { minecraftVersion: '1.20.4', loaderVersion: '20.4.237' },
    ])
  })

  it('falls back to the official NeoForge directory index format', () => {
    const html = '<li class="directory"><a href="./20.2.93/">20.2.93/</a></li>'
      + '<li class="directory"><a href="./21.11.45/">21.11.45/</a></li>'
      + '<li class="directory"><a href="./21.11.46-beta/">21.11.46-beta/</a></li>'
      + '<li class="directory"><a href="../">parent</a></li>'
    expect(parseNeoForgeDirectoryIndex(html)).toEqual([
      { minecraftVersion: '1.21.11', loaderVersion: '21.11.45' },
      { minecraftVersion: '1.20.2', loaderVersion: '20.2.93' },
    ])
  })

  it('accepts only a complete supported NeoForge MDK recipe', () => {
    expect(parseNeoForgeMdkRecipe(
      "id 'net.neoforged.gradle.userdev' version '7.1.38'",
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.2.1-bin.zip',
    )).toEqual({ pluginVersion: '7.1.38', gradleVersion: '9.2.1' })
    expect(parseNeoForgeMdkRecipe(
      "id 'net.neoforged.gradle.userdev' version '7.1.38'",
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-99.0-bin.zip',
    )).toBeUndefined()
    expect(parseNeoForgeMdkLoader('neo_version=21.11.45', '1.21.11')).toBe('21.11.45')
    expect(parseNeoForgeMdkLoader('neo_version=21.10.64', '1.21.11')).toBeUndefined()
    expect(parseNeoForgeMdkRepositories([
      { name: 'MDK-1.21.11-NeoGradle' },
      { name: 'MDK-1.20.2-NeoGradle' },
      { name: 'MDK-1.20.1-NeoGradle' },
      { name: 'MDK-26.1.2-NeoGradle' },
      { name: 'MDK-1.21.11-ModDevGradle' },
    ])).toEqual(['1.21.11', '1.20.2'])
  })

  it('rejects NeoForge entries outside the centralized supported lines', () => {
    expect(isSupportedNeoForgeMinecraftVersion('1.20.1')).toBe(false)
    expect(isSupportedNeoForgeMinecraftVersion(' 1.20.2 ')).toBe(true)
    expect(() => neoForgeEntry('1.20.1', '20.1.99')).toThrow(/unsupported NeoForge Minecraft version/u)
  })

  it('keeps the newest stable entry per loader and game line', () => {
    const older = fabricEntry('1.21.1', '0.16.4', 'intermediary', '1.21.1+build.2', '0.101.0+1.21.1')
    const newer = fabricEntry('1.21.1', '0.16.5', 'intermediary', '1.21.1+build.3', '0.102.0+1.21.1')
    const neo = neoForgeEntry('1.21.1', '21.1.176')
    const unstable = { ...neo, stable: false } as unknown as CatalogEntry
    expect(normalizeCatalogEntries([older, newer, neo, unstable])).toEqual([newer, neo])
  })

  it('applies the trusted recipe policy while normalizing online entries', () => {
    const trusted = neoForgeEntry('1.21.1', '21.1.176')
    const untrusted = neoForgeEntry('1.21.1', '21.1.177', {
      pluginVersion: '7.1.39', gradleVersion: '9.2.1',
    })
    expect(normalizeCatalogEntries([untrusted, trusted])).toEqual([trusted])
  })

  it('loads online data with mirror-first game metadata and caches the result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-catalog-'))
    tempDirectories.push(root)
    const cachePath = join(root, 'catalog.json')
    const calls: string[] = []
    const fetch = async (url: string): Promise<Response> => {
      calls.push(url)
      const mdk = neoForgeMdkResponse(url)
      if (mdk !== undefined) return mdk
      if (url.includes('bmclapi')) return response([{ version: '1.21.1', stable: true }])
      if (url.includes('/versions/loader/')) return response([{
        loader: { version: '0.16.5', stable: true },
        intermediary: { version: '1.21.1' },
      }])
      if (url.includes('/versions/yarn/')) return response([{
        gameVersion: '1.21.1', version: '1.21.1+build.3', build: 3,
      }])
      if (url.includes('fabric-api')) return response('<version>0.102.0+1.21.1</version>')
      if (url.includes('neoforged')) return response('<version>21.1.176</version>')
      throw new Error(`unexpected URL ${url}`)
    }
    const resolver = new MinecraftCatalogResolver({
      cachePath,
      fetch,
      probeJava: async () => ({ available: true, version: 21, executable: 'java' }),
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    })
    const snapshot = await resolver.load()
    expect(snapshot.cached).toBe(false)
    expect(snapshot.stale).toBe(false)
    expect(snapshot.java.version).toBe(21)
    expect(snapshot.entries.map(entry => `${entry.loader}:${entry.minecraftVersion}`)).toEqual([
      'fabric:1.21.1', 'neoforge:1.21.1',
    ])
    expect(snapshot.entries.find(entry => entry.loader === 'fabric')?.mappingsVersion).toBe('1.21.1+build.3')
    expect(calls[0]).toContain('bmclapi')
    expect(await readFile(cachePath, 'utf8')).toContain('1.21.1')
  })

  it('falls back to a cached catalog when network resolution fails and marks stale data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-cache-'))
    tempDirectories.push(root)
    const cachePath = join(root, 'catalog.json')
    const cached = fabricEntry('1.20.1', '0.15.11', 'intermediary', '1.20.1+build.10', '0.92.0+1.20.1')
    await mkdir(root, { recursive: true })
    await writeFile(cachePath, JSON.stringify({
      format: 1,
      fetchedAt: '2026-09-13T00:00:00.000Z',
      entries: [cached],
    }))
    const resolver = new MinecraftCatalogResolver({
      cachePath,
      fetch: async () => { throw new Error('offline') },
      probeJava: async () => ({ available: false, message: 'not installed' }),
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    })
    const snapshot = await resolver.load()
    expect(snapshot.cached).toBe(true)
    expect(snapshot.stale).toBe(true)
    expect(snapshot.entries).toEqual([cached])
    expect(snapshot.error).toContain('offline')
    expect(snapshot.java.available).toBe(false)
  })

  it('falls back from BMCLAPI to the official Fabric Meta game list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-fallback-'))
    tempDirectories.push(root)
    const calls: string[] = []
    const fetch = async (url: string): Promise<Response> => {
      calls.push(url)
      const mdk = neoForgeMdkResponse(url)
      if (mdk !== undefined) return mdk
      if (url.includes('bmclapi')) throw new Error('mirror unavailable')
      if (url.endsWith('/versions/game')) return response([{ version: '1.20.1', stable: true }])
      if (url.includes('/versions/loader/')) return response([{
        loader: { version: '0.15.11', stable: true },
        intermediary: { version: '1.20.1' },
      }])
      if (url.includes('/versions/yarn/')) return response([{
        gameVersion: '1.20.1', version: '1.20.1+build.10', build: 10,
      }])
      if (url.includes('fabric-api')) return response('<version>0.92.0+1.20.1</version>')
      if (url.includes('neoforged')) return response('<version>20.4.237</version>')
      throw new Error(`unexpected URL ${url}`)
    }
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(root, 'catalog.json'),
      fetch,
      probeJava: async () => ({ available: true, version: 17, executable: 'java' }),
    })
    const snapshot = await resolver.load()
    expect(snapshot.cached).toBe(false)
    expect(snapshot.entries.some(entry => entry.loader === 'fabric' && entry.minecraftVersion === '1.20.1')).toBe(true)
    expect(calls[0]).toContain('bmclapi')
    expect(calls.some(url => url.includes('meta.fabricmc.net/v2/versions/game'))).toBe(true)
  })

  it('keeps NeoForge entries available when Fabric resolution fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-loader-isolation-'))
    tempDirectories.push(root)
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(root, 'catalog.json'),
      fetch: async (url) => {
        const mdk = neoForgeMdkResponse(url)
        if (mdk !== undefined) return mdk
        if (url.includes('neoforged')) return response('<version>21.1.176</version>')
        throw new Error('Fabric unavailable')
      },
      probeJava: async () => ({ available: true, version: 21, executable: 'java' }),
    })
    const snapshot = await resolver.load()
    expect(snapshot.cached).toBe(false)
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0]).toMatchObject({ loader: 'neoforge', minecraftVersion: '1.21.1' })
  })

  it('persists a successful loader refresh alongside the other loader cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-cache-merge-'))
    tempDirectories.push(root)
    const cachePath = join(root, 'catalog.json')
    const fabric = fabricEntry('1.20.1', '0.15.11', 'intermediary', '1.20.1+build.10', '0.92.0+1.20.1')
    await writeFile(cachePath, JSON.stringify({ format: 1, fetchedAt: '2026-09-01T00:00:00Z', entries: [fabric] }))
    const resolver = new MinecraftCatalogResolver({
      cachePath,
      fetch: (url) => {
        const mdk = neoForgeMdkResponse(url)
        if (mdk !== undefined) return Promise.resolve(mdk)
        if (url.includes('neoforged')) return Promise.resolve(response('<version>21.1.176</version>'))
        return Promise.reject(new Error('Fabric unavailable'))
      },
      probeJava: () => Promise.resolve({ available: true, version: 21, executable: 'java' }),
    })
    const refreshed = await resolver.load()
    expect(refreshed.entries.map(entry => entry.loader).sort()).toEqual(['fabric', 'neoforge'])
    expect(refreshed.fetchedAt).toBe('2026-09-01T00:00:00Z')
    expect((await resolver.cached())?.entries).toEqual(refreshed.entries)
  })

  it('falls back from an empty Maven mirror metadata response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-api-fallback-'))
    tempDirectories.push(root)
    const calls: string[] = []
    const fetch = async (url: string): Promise<Response> => {
      calls.push(url)
      const mdk = neoForgeMdkResponse(url)
      if (mdk !== undefined) return mdk
      if (url.includes('bmclapi')) return response([{ version: '1.20.1', stable: true }])
      if (url.endsWith('/versions/loader/1.20.1')) return response([{
        loader: { version: '0.15.11', stable: true }, intermediary: { version: '1.20.1' },
      }])
      if (url.endsWith('/versions/yarn/1.20.1')) return response([{
        gameVersion: '1.20.1', version: '1.20.1+build.10', build: 10,
      }])
      if (url.includes('maven.aliyun.com') && url.includes('fabric-api')) return response('<metadata/>')
      if (url.includes('maven.fabricmc.net') && url.includes('fabric-api')) return response('<version>0.92.0+1.20.1</version>')
      if (url.includes('neoforged')) return response('<version>20.2.93</version>')
      throw new Error(`unexpected URL ${url}`)
    }
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(root, 'catalog.json'), fetch,
      probeJava: async () => ({ available: true, version: 17, executable: 'java' }),
    })
    const snapshot = await resolver.load()
    expect(snapshot.entries.some(entry => entry.loader === 'fabric' && entry.apiVersion === '0.92.0+1.20.1')).toBe(true)
    expect(calls.some(url => url.includes('maven.fabricmc.net') && url.includes('fabric-api'))).toBe(true)
  })

  it('discovers NeoForge versions from the official MDK organization when Maven is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-mdk-fallback-'))
    tempDirectories.push(root)
    const calls: string[] = []
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(root, 'catalog.json'),
      fetch: async (url) => {
        calls.push(url)
        const mdk = neoForgeMdkResponse(url)
        if (mdk !== undefined) return mdk
        if (url.includes('maven.neoforged.net')) throw new Error('Maven unavailable')
        if (url.includes('api.github.com/orgs/NeoForgeMDKs/repos')) {
          return response([
            { name: 'MDK-1.21.11-NeoGradle' },
            { name: 'MDK-26.1-NeoGradle' },
            { name: 'MDK-1.21.11-ModDevGradle' },
          ])
        }
        throw new Error('Fabric unavailable')
      },
      probeJava: async () => ({ available: true, version: 21, executable: 'java' }),
    })

    const snapshot = await resolver.load()
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0]).toMatchObject({
      loader: 'neoforge', minecraftVersion: '1.21.11', loaderVersion: '21.11.45',
      pluginVersion: '7.1.38', gradleVersion: '9.2.1',
    })
    expect(calls.some(url => url.includes('api.github.com/orgs/NeoForgeMDKs/repos'))).toBe(true)
    expect(calls.some(url => url.includes('raw.githubusercontent.com/NeoForgeMDKs/MDK-1.21.11-NeoGradle'))).toBe(true)
  })

  it('uses bounded GitHub fallback pagination when the first page is full', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-mdk-pages-'))
    tempDirectories.push(root)
    const calls: string[] = []
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ name: `not-an-mdk-${String(index)}` }))
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(root, 'catalog.json'),
      fetch: async (url) => {
        calls.push(url)
        const mdk = neoForgeMdkResponse(url)
        if (mdk !== undefined) return mdk
        if (url.includes('maven.neoforged.net')) throw new Error('Maven unavailable')
        if (url.includes('api.github.com/orgs/NeoForgeMDKs/repos')) {
          return url.includes('&page=2')
            ? response([{ name: 'MDK-1.21.11-NeoGradle' }])
            : response(firstPage)
        }
        throw new Error('Fabric unavailable')
      },
      probeJava: async () => ({ available: true, version: 21, executable: 'java' }),
    })

    const snapshot = await resolver.load()
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0]).toMatchObject({ loader: 'neoforge', minecraftVersion: '1.21.11' })
    expect(calls.some(url => url.includes('api.github.com/orgs/NeoForgeMDKs/repos') && url.includes('&page=2'))).toBe(true)
  })

  it('rejects cached entries without both official checksums', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-invalid-cache-'))
    tempDirectories.push(root)
    const cachePath = join(root, 'catalog.json')
    const entry = fabricEntry('1.20.1', '0.15.11', 'intermediary', '1.20.1+build.10', '0.92.0+1.20.1')
    const { wrapperSha256: _missing, ...missingChecksum } = entry
    const tamperedRecipe = { ...entry, pluginVersion: '9.9.9' }
    await writeFile(cachePath, JSON.stringify({
      format: 1, fetchedAt: '2026-09-15T00:00:00.000Z', entries: [missingChecksum, tamperedRecipe],
    }))
    const resolver = new MinecraftCatalogResolver({
      cachePath,
      fetch: async () => { throw new Error('offline') },
      probeJava: async () => ({ available: false, message: 'not installed' }),
    })

    const snapshot = await resolver.load()
    expect(snapshot.entries).toEqual([])
    expect(snapshot.cached).toBe(false)
    expect(snapshot.error).toContain('offline')
  })

  it('rejects an inferred NeoForge 1.20.1 row from the cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-neoforge-cache-'))
    tempDirectories.push(root)
    const cachePath = join(root, 'catalog.json')
    const valid = neoForgeEntry('1.20.2', '20.2.93')
    const inferred = {
      ...valid,
      minecraftVersion: '1.20.1',
      entryId: 'neoforge:1.20.1:20.2.93',
    }
    expect(isCatalogEntry(inferred)).toBe(false)
    await writeFile(cachePath, JSON.stringify({
      format: 1, fetchedAt: '2026-09-15T00:00:00.000Z', entries: [inferred],
    }))
    const resolver = new MinecraftCatalogResolver({
      cachePath,
      fetch: async () => { throw new Error('offline') },
      probeJava: async () => ({ available: false, message: 'not installed' }),
    })

    const snapshot = await resolver.load()
    expect(snapshot.entries).toEqual([])
    expect(snapshot.cached).toBe(false)
    expect(snapshot.error).toContain('offline')
  })

  it('does not read through a symlinked catalog cache directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-cache-link-'))
    tempDirectories.push(root)
    const realCache = join(root, 'real-cache')
    const linkedCache = join(root, 'linked-cache')
    await mkdir(realCache)
    await writeFile(join(realCache, 'sentinel.txt'), 'keep\n')
    await symlink(realCache, linkedCache, process.platform === 'win32' ? 'junction' : 'dir')
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(linkedCache, 'catalog.json'),
      fetch: async () => { throw new Error('offline') },
      probeJava: async () => ({ available: false, message: 'not installed' }),
    })

    const snapshot = await resolver.load()
    expect(snapshot.entries).toEqual([])
    expect(await readFile(join(realCache, 'sentinel.txt'), 'utf8')).toBe('keep\n')
    expect(await readdirSafe(realCache)).toEqual(['sentinel.txt'])
  })

  it('bounds the complete online refresh even when an injected fetch ignores cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mc-bootstrap-refresh-budget-'))
    tempDirectories.push(root)
    const resolver = new MinecraftCatalogResolver({
      cachePath: join(root, 'catalog.json'),
      fetch: async () => await new Promise<Response>(() => {}),
      probeJava: async () => ({ available: true, version: 21, executable: 'java' }),
      refreshTimeoutMs: 10,
    })

    const snapshot = await resolver.load()
    expect(snapshot.entries).toEqual([])
    expect(snapshot.cached).toBe(false)
    expect(snapshot.error).toContain('timed out')
  })
})

async function readdirSafe(path: string): Promise<string[]> {
  return readdir(path).catch(() => [])
}

describe('Java version parsing', () => {
  it('handles modern and legacy java -version output', () => {
    expect(parseJavaMajor('openjdk version "21.0.4" 2024-07-16')).toBe(21)
    expect(parseJavaMajor('java version "1.8.0_402"')).toBe(8)
    expect(parseJavaMajor('not java output')).toBeUndefined()
  })
})
