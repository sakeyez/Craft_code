import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import {
  assertFabricFixture,
  assertNeoForgeFixture,
  createMinimalFabricFixture,
  createMinimalNeoForgeFixture,
  prepareScriptedProfile,
} from './mcmod-harness.ts'

const dshBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const lspPatchPath = fileURLToPath(new URL('./fixtures/mcmod-e2e-lsp.cordis.yml', import.meta.url))
const scriptedPatchPath = fileURLToPath(new URL('./fixtures/mcmod-scripted-profile.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

const KEYLESS_TASK = [
  'Add a simple item named codex_gear to this minimal Fabric project.',
  'Create the Java item registration in src/main/java/com/example/minimal/ModItems.java.',
  'Add the matching lang and item model, and verify the existing binary texture fixture is valid.',
  'Then run detect_mc_project, validate_mc_resources, and run_mc_check with target build.',
].join(' ')

const REAL_MODEL_TASK = [
  'In this minimal Fabric project, add one simple item named codex_gear.',
  'Inspect the project first and choose the owning Java registration and matching resource files yourself.',
  'Keep the mod namespace, registry id, language key, item model, and a valid small PNG texture consistent.',
  'Use the Minecraft project tools to detect the project, validate resources, and run the focused build check.',
  'Do not assume a loader-specific API without confirming the project facts, and report only a brief result.',
].join(' ')

const NEOFORGE_KEYLESS_TASK = [
  'Add a simple item named codex_gear to this minimal NeoForge project.',
  'Use the existing @Mod and DeferredRegister/event-bus wiring and keep all APIs NeoForge-only.',
  'Add matching lang and item model files, then verify the existing binary texture fixture.',
  'Run detect_mc_project, validate_mc_resources, and run_mc_check with target datagen.',
].join(' ')

interface JsonObject {
  [key: string]: unknown
}

async function readPersistedLog(path: string): Promise<string> {
  const content = await readFile(path)
  if (!path.endsWith('.zstd')) return content.toString('utf8')
  const scan = scanZstdFrames(content)
  if (scan.tornStart !== undefined) throw new Error(`persisted mcmod e2e log has a torn Zstandard frame: ${path}`)
  const decoded: Buffer[] = []
  for (const frame of scan.frames) {
    decoded.push(await decompressZstdFrame(content.subarray(frame.start, frame.end)))
  }
  return Buffer.concat(decoded).toString('utf8')
}

function parseJsonl(content: string): JsonObject[] {
  return content.split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

async function sessionRows(root: string): Promise<JsonObject[]> {
  const sessionsRoot = join(root, '.dsh', 'sessions')
  const files = (await readdir(sessionsRoot, { recursive: true }))
    .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
  const logs = await Promise.all(files.map(file => readPersistedLog(join(sessionsRoot, file))))
  return logs.flatMap(parseJsonl)
}

function toolCallNames(rows: readonly JsonObject[]): string[] {
  return rows.flatMap((row) => {
    if (row.type !== 'tool/call') return []
    const data = row.data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return []
    const name = (data as JsonObject).name
    return typeof name === 'string' ? [name] : []
  })
}

describe('mcmod headless agent e2e', () => {
  it('edits a minimal Fabric fixture and verifies it through Minecraft project tools keylessly', async () => {
    let calls: string[] = []
    const result = await runLoaderSmoke({
      label: 'mcmod headless keyless e2e',
      tempDirPrefix: 'dsh-mcmod-keyless-',
      binScript: dshBinScript,
      configPath: scriptedPatchPath,
      binArgs: ['--profile', 'mcmod', '--patch', lspPatchPath, '--patch', scriptedPatchPath, KEYLESS_TASK],
      tsconfigPath,
      processTimeoutMs: 75_000,
      env: {
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: async (cwd) => {
        await createMinimalFabricFixture(cwd)
        await prepareScriptedProfile(cwd)
      },
      inspect: async (cwd) => {
        await assertFabricFixture(cwd)
        calls = toolCallNames(await sessionRows(cwd))
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('MCMOD_E2E_OK')
    expect(calls).toEqual([
      'write',
      'write',
      'write',
      'detect_mc_project',
      'validate_mc_resources',
      'run_mc_check',
    ])
  }, 90_000)

  it('edits a minimal NeoForge fixture, chooses runData, and keeps Fabric and Forge APIs out', async () => {
    let calls: string[] = []
    const result = await runLoaderSmoke({
      label: 'mcmod headless NeoForge keyless e2e',
      tempDirPrefix: 'dsh-mcmod-neoforge-keyless-',
      binScript: dshBinScript,
      configPath: scriptedPatchPath,
      binArgs: ['--profile', 'mcmod', '--patch', lspPatchPath, '--patch', scriptedPatchPath, NEOFORGE_KEYLESS_TASK],
      tsconfigPath,
      processTimeoutMs: 75_000,
      env: {
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: async (cwd) => {
        await createMinimalNeoForgeFixture(cwd)
        await prepareScriptedProfile(cwd)
      },
      inspect: async (cwd) => {
        await assertNeoForgeFixture(cwd)
        calls = toolCallNames(await sessionRows(cwd))
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('MCMOD_E2E_OK')
    expect(calls).toEqual([
      'write',
      'write',
      'write',
      'detect_mc_project',
      'validate_mc_resources',
      'run_mc_check',
    ])
  }, 90_000)
})

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('mcmod headless agent with real model', () => {
  it('adds the same item fixture and passes the offline build gate', async () => {
    let calls: string[] = []
    const result = await runLoaderSmoke({
      label: 'mcmod headless real model e2e',
      tempDirPrefix: 'dsh-mcmod-real-',
      binScript: dshBinScript,
      configPath: scriptedPatchPath,
      binArgs: ['--profile', 'mcmod', '--patch', lspPatchPath, REAL_MODEL_TASK],
      tsconfigPath,
      processTimeoutMs: 180_000,
      env: {
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
      },
      prepare: createMinimalFabricFixture,
      inspect: async (cwd) => {
        await assertFabricFixture(cwd)
        calls = toolCallNames(await sessionRows(cwd))
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout.trim().length).toBeGreaterThan(0)
    expect(calls).toEqual(expect.arrayContaining([
      'detect_mc_project',
      'validate_mc_resources',
      'run_mc_check',
    ]))
  }, 210_000)
})
