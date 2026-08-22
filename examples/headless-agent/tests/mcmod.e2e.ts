import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import {
  decompressZstdFrame,
  scanZstdFrames,
} from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'

const dshBinScript = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const lspPatchPath = fileURLToPath(new URL('./fixtures/mcmod-e2e-lsp.cordis.yml', import.meta.url))
const scriptedPatchPath = fileURLToPath(new URL('./fixtures/mcmod-scripted-profile.cordis.yml', import.meta.url))
const scriptedLlmPath = fileURLToPath(new URL('./fixtures/mcmod-scripted-llm.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const MOD_ID = 'minimalmod'
const ITEM_ID = 'codex_gear'

const KEYLESS_TASK = [
  'Add a simple item named codex_gear to this minimal Fabric project.',
  'Create the Java item registration in src/main/java/com/example/minimal/ModItems.java.',
  'Add the matching lang, item model, and a tiny placeholder texture under src/main/resources.',
  'Then run detect_mc_project, validate_mc_resources, and run_mc_check with target build.',
].join(' ')

const REAL_MODEL_TASK = [
  'In this minimal Fabric project, add one simple item with id codex_gear.',
  'Use mod id minimalmod. Put Java item registration in src/main/java/com/example/minimal/ModItems.java.',
  'Create assets/minimalmod/lang/en_us.json with item.minimalmod.codex_gear set exactly to Codex Gear,',
  'assets/minimalmod/models/item/codex_gear.json pointing to minimalmod:item/codex_gear,',
  'and assets/minimalmod/textures/item/codex_gear.png as a tiny text placeholder.',
  'After editing, call detect_mc_project, validate_mc_resources, and run_mc_check with target build.',
  'Report only a brief result.',
].join(' ')

interface JsonObject {
  [key: string]: unknown
}

async function writeFixtureFile(root: string, path: string, content: string): Promise<void> {
  const full = join(root, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

async function createMinimalFabricFixture(root: string): Promise<void> {
  await writeFixtureFile(root, 'settings.gradle', 'rootProject.name = "minimal-mcmod-fixture"\n')
  await writeFixtureFile(root, 'build.gradle', [
    'plugins {',
    '  id "fabric-loom" version "1.8-SNAPSHOT"',
    '}',
    '',
    'dependencies {',
    '  minecraft "com.mojang:minecraft:${project.minecraft_version}"',
    '  mappings "net.fabricmc:yarn:${project.yarn_mappings}:v2"',
    '  modImplementation "net.fabricmc:fabric-loader:${project.loader_version}"',
    '}',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'gradle.properties', [
    'minecraft_version=1.21.1',
    'yarn_mappings=1.21.1+build.3',
    'loader_version=0.16.9',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'src/main/resources/fabric.mod.json', `${JSON.stringify({
    schemaVersion: 1,
    id: MOD_ID,
    version: '1.0.0',
    entrypoints: { main: ['com.example.minimal.MinimalMod'] },
    depends: { minecraft: '>=1.21.1', fabricloader: '>=0.16.9' },
  }, null, 2)}
`)
  await writeFixtureFile(root, 'src/main/java/com/example/minimal/MinimalMod.java', [
    'package com.example.minimal;',
    '',
    'public final class MinimalMod {',
    `  public static final String MOD_ID = "${MOD_ID}";`,
    '',
    '  private MinimalMod() {',
    '  }',
    '',
    '  public static void onInitialize() {',
    '  }',
    '}',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'gradle-fixture-check.mjs', [
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    '',
    'const root = process.cwd();',
    'const fail = message => { console.error(message); process.exit(1); };',
    'if (!process.argv.slice(2).includes("build")) fail("expected build task");',
    '',
    'const javaPath = join(root, "src/main/java/com/example/minimal/ModItems.java");',
    'if (!existsSync(javaPath)) fail("missing ModItems.java");',
    'const java = readFileSync(javaPath, "utf8");',
    'for (const text of ["codex_gear", "Registry.register", "Item"]) {',
    '  if (!java.includes(text)) fail(`ModItems.java missing ${text}`);',
    '}',
    '',
    'const lang = JSON.parse(readFileSync(join(root, "src/main/resources/assets/minimalmod/lang/en_us.json"), "utf8"));',
    'if (lang["item.minimalmod.codex_gear"] !== "Codex Gear") fail("bad lang entry");',
    '',
    'const model = JSON.parse(readFileSync(join(root, "src/main/resources/assets/minimalmod/models/item/codex_gear.json"), "utf8"));',
    'if (model.parent !== "minecraft:item/generated") fail("bad model parent");',
    'if (model.textures?.layer0 !== "minimalmod:item/codex_gear") fail("bad item texture reference");',
    '',
    'if (!existsSync(join(root, "src/main/resources/assets/minimalmod/textures/item/codex_gear.png"))) fail("missing texture");',
    'console.log("MCMOD_FIXTURE_BUILD_OK");',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'gradlew', '#!/bin/sh\nexec node gradle-fixture-check.mjs "$@"\n')
  await chmod(join(root, 'gradlew'), 0o755)
  await writeFixtureFile(root, 'gradlew.bat', '@echo off\r\nnode gradle-fixture-check.mjs %*\r\n')
}

async function prepareScriptedProfile(root: string): Promise<void> {
  const fixtureDir = join(root, '.dsh', 'profiles', 'mcmod', 'snapshot-fixtures')
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    copyFile(scriptedLlmPath, join(fixtureDir, 'mcmod-scripted-llm.ts')),
    writeFile(join(fixtureDir, 'package.json'), '{"type":"module"}\n'),
  ])
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

async function verifyMcmodFixture(root: string): Promise<void> {
  const modItems = await readFile(join(root, 'src/main/java/com/example/minimal/ModItems.java'), 'utf8')
  expect(modItems).toContain(ITEM_ID)
  expect(modItems).toContain('Registry.register')
  expect(modItems).toContain('Item')

  const lang = JSON.parse(await readFile(join(root, 'src/main/resources/assets/minimalmod/lang/en_us.json'), 'utf8')) as Record<string, unknown>
  expect(lang[`item.${MOD_ID}.${ITEM_ID}`]).toBe('Codex Gear')

  const model = JSON.parse(await readFile(join(root, 'src/main/resources/assets/minimalmod/models/item/codex_gear.json'), 'utf8')) as {
    parent?: unknown
    textures?: { layer0?: unknown }
  }
  expect(model.parent).toBe('minecraft:item/generated')
  expect(model.textures?.layer0).toBe(`${MOD_ID}:item/${ITEM_ID}`)
  await expect(readFile(join(root, 'src/main/resources/assets/minimalmod/textures/item/codex_gear.png'), 'utf8'))
    .resolves.toContain('placeholder')

  const check = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'gradlew.bat build'], { cwd: root, encoding: 'utf8' })
    : spawnSync(join(root, 'gradlew'), ['build'], { cwd: root, encoding: 'utf8' })
  expect(check.status, `${check.error?.message ?? ''}\n${check.stdout}\n${check.stderr}`).toBe(0)
  expect(check.stdout).toContain('MCMOD_FIXTURE_BUILD_OK')
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
        await verifyMcmodFixture(cwd)
        calls = toolCallNames(await sessionRows(cwd))
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('MCMOD_E2E_OK')
    expect(calls).toEqual([
      'write',
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
        await verifyMcmodFixture(cwd)
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
