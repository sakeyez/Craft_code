import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable mod id used by the keyless Fabric fixture. */
const MOD_ID = 'minimalmod'
/** Stable registry id used by both keyless fixtures. */
const ITEM_ID = 'codex_gear'
/** Stable mod id used by the keyless NeoForge fixture. */
const NEO_MOD_ID = 'minimalneo'

/** A real one-pixel PNG used by wiring and resource-validation tests. */
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const scriptedLlmPath = fileURLToPath(new URL('./fixtures/mcmod-scripted-llm.ts', import.meta.url))

async function writeFixtureFile(root: string, path: string, content: string | Uint8Array): Promise<void> {
  const full = join(root, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

/** Create a minimal Fabric project with a local wiring-check wrapper. */
export async function createMinimalFabricFixture(root: string): Promise<void> {
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
  await writeFixtureFile(root, 'src/main/resources/assets/minimalmod/textures/item/codex_gear.png', VALID_PNG)
  await writeFixtureFile(root, 'mcmod-wiring-check.mjs', [
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
    'console.log("MCMOD_WIRING_FIXTURE_OK");',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'gradlew', '#!/bin/sh\n# Keyless wiring fixture only: this is not a Gradle implementation.\nexec node mcmod-wiring-check.mjs "$@"\n')
  await chmod(join(root, 'gradlew'), 0o755)
  await writeFixtureFile(root, 'gradlew.bat', '@echo off\r\nrem Keyless wiring fixture only; not a Gradle implementation.\r\nnode mcmod-wiring-check.mjs %*\r\n')
}

/** Create a minimal NeoForge project with a local wiring-check wrapper. */
export async function createMinimalNeoForgeFixture(root: string): Promise<void> {
  await writeFixtureFile(root, 'settings.gradle', 'rootProject.name = "minimal-neoforge-fixture"\n')
  await writeFixtureFile(root, 'build.gradle', [
    'plugins {',
    '  id "net.neoforged.moddev" version "2.0.107"',
    '}',
    '',
    'neoForge {',
    '  version = project.neoforge_version',
    '}',
    '',
    'tasks.register("runData") {}',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'gradle.properties', [
    'minecraft_version=1.21.1',
    'neoforge_version=21.1.77',
    'mappings_channel=official',
    'mappings_version=1.21.1',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'src/main/resources/META-INF/neoforge.mods.toml', [
    'modLoader="javafml"',
    'loaderVersion="[4,)"',
    'license="MIT"',
    '',
    '[[mods]]',
    `modId="${NEO_MOD_ID}"`,
    'version="1.0.0"',
    'displayName="Minimal NeoForge"',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'src/main/java/com/example/minimal/MinimalMod.java', [
    'package com.example.minimal;',
    '',
    'import net.neoforged.bus.api.IEventBus;',
    'import net.neoforged.fml.common.Mod;',
    '',
    `@Mod("${NEO_MOD_ID}")`,
    'public final class MinimalMod {',
    '  public MinimalMod(IEventBus modEventBus) {',
    '    ModItems.ITEMS.register(modEventBus);',
    '  }',
    '}',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'src/main/resources/assets/minimalneo/textures/item/codex_gear.png', VALID_PNG)
  await writeFixtureFile(root, 'mcmod-wiring-check.mjs', [
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    '',
    'const root = process.cwd();',
    'const fail = message => { console.error(message); process.exit(1); };',
    'if (!process.argv.slice(2).includes("runData")) fail("expected runData task");',
    '',
    'const metadataPath = join(root, "src/main/resources/META-INF/neoforge.mods.toml");',
    'const metadata = readFileSync(metadataPath, "utf8");',
    'for (const text of ["modLoader=\\"javafml\\"", "modId=\\"minimalneo\\""]) {',
    '  if (!metadata.includes(text)) fail(`metadata missing ${text}`);',
    '}',
    '',
    'const main = readFileSync(join(root, "src/main/java/com/example/minimal/MinimalMod.java"), "utf8");',
    'const items = readFileSync(join(root, "src/main/java/com/example/minimal/ModItems.java"), "utf8");',
    'for (const text of ["@Mod(\\"minimalneo\\")", "IEventBus", "DeferredRegister", "register(modEventBus)"]) {',
    '  if (!main.includes(text) && !items.includes(text)) fail(`NeoForge wiring missing ${text}`);',
    '}',
    'for (const forbidden of ["net.fabricmc", "net.minecraftforge"]) {',
    '  if (main.includes(forbidden) || items.includes(forbidden)) fail(`forbidden API ${forbidden}`);',
    '}',
    '',
    'const lang = JSON.parse(readFileSync(join(root, "src/main/resources/assets/minimalneo/lang/en_us.json"), "utf8"));',
    'if (lang["item.minimalneo.codex_gear"] !== "Codex Gear") fail("bad lang entry");',
    'const model = JSON.parse(readFileSync(join(root, "src/main/resources/assets/minimalneo/models/item/codex_gear.json"), "utf8"));',
    'if (model.parent !== "minecraft:item/generated") fail("bad model parent");',
    'if (model.textures?.layer0 !== "minimalneo:item/codex_gear") fail("bad item texture reference");',
    'if (!existsSync(join(root, "src/main/resources/assets/minimalneo/textures/item/codex_gear.png"))) fail("missing texture");',
    'console.log("MCMOD_NEOFORGE_WIRING_FIXTURE_OK");',
    '',
  ].join('\n'))
  await writeFixtureFile(root, 'gradlew', '#!/bin/sh\n# Keyless wiring fixture only: this is not a Gradle implementation.\nexec node mcmod-wiring-check.mjs "$@"\n')
  await chmod(join(root, 'gradlew'), 0o755)
  await writeFixtureFile(root, 'gradlew.bat', '@echo off\r\nrem Keyless wiring fixture only; not a Gradle implementation.\r\nnode mcmod-wiring-check.mjs %*\r\n')
}

/** Install the deterministic model adapter in a temporary mcmod profile. */
export async function prepareScriptedProfile(root: string): Promise<void> {
  const fixtureDir = join(root, '.dsh', 'profiles', 'mcmod', 'snapshot-fixtures')
  await mkdir(fixtureDir, { recursive: true })
  await Promise.all([
    copyFile(scriptedLlmPath, join(fixtureDir, 'mcmod-scripted-llm.ts')),
    writeFile(join(fixtureDir, 'package.json'), '{"type":"module"}\n'),
  ])
}

function requireText(text: string, expected: string, path: string): void {
  if (!text.includes(expected)) throw new Error(`${path} does not contain ${JSON.stringify(expected)}`)
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must contain a JSON object`)
  return value as Record<string, unknown>
}

function runWiringCheck(root: string, task: string, expectedOutput: string): void {
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', `gradlew.bat ${task}`], { cwd: root, encoding: 'utf8' })
    : spawnSync(join(root, 'gradlew'), [task], { cwd: root, encoding: 'utf8' })
  requireEqual(result.status, 0, `${task} wrapper exit code`)
  requireText(result.stdout, expectedOutput, `${task} wrapper stdout`)
}

/** Verify the Fabric fixture's files, PNG signature, and wiring wrapper. */
export async function assertFabricFixture(root: string): Promise<void> {
  const javaPath = join(root, 'src/main/java/com/example/minimal/ModItems.java')
  const java = await readFile(javaPath, 'utf8')
  for (const text of [ITEM_ID, 'Registry.register', 'Item']) requireText(java, text, javaPath)
  const lang = await readJson(join(root, `src/main/resources/assets/${MOD_ID}/lang/en_us.json`))
  requireEqual(lang[`item.${MOD_ID}.${ITEM_ID}`], 'Codex Gear', 'Fabric language key')
  const model = await readJson(join(root, `src/main/resources/assets/${MOD_ID}/models/item/${ITEM_ID}.json`))
  requireEqual(model.parent, 'minecraft:item/generated', 'Fabric item model parent')
  const textures = model.textures
  if (textures === null || typeof textures !== 'object' || Array.isArray(textures)) throw new Error('Fabric item model has no texture map')
  requireEqual((textures as Record<string, unknown>).layer0, `${MOD_ID}:item/${ITEM_ID}`, 'Fabric item texture')
  const texture = await readFile(join(root, `src/main/resources/assets/${MOD_ID}/textures/item/${ITEM_ID}.png`))
  requireEqual(texture.subarray(0, 8).toString('hex'), VALID_PNG.subarray(0, 8).toString('hex'), 'Fabric PNG signature')
  runWiringCheck(root, 'build', 'MCMOD_WIRING_FIXTURE_OK')
}

/** Verify the NeoForge fixture's files, PNG signature, and wiring wrapper. */
export async function assertNeoForgeFixture(root: string): Promise<void> {
  const metadataPath = join(root, 'src/main/resources/META-INF/neoforge.mods.toml')
  requireText(await readFile(metadataPath, 'utf8'), `modId="${NEO_MOD_ID}"`, metadataPath)
  const mainPath = join(root, 'src/main/java/com/example/minimal/MinimalMod.java')
  const main = await readFile(mainPath, 'utf8')
  requireText(main, `@Mod("${NEO_MOD_ID}")`, mainPath)
  requireText(main, 'IEventBus', mainPath)
  const itemsPath = join(root, 'src/main/java/com/example/minimal/ModItems.java')
  const items = await readFile(itemsPath, 'utf8')
  for (const text of ['DeferredRegister', ITEM_ID]) requireText(items, text, itemsPath)
  for (const forbidden of ['net.fabricmc', 'net.minecraftforge']) {
    if (main.includes(forbidden) || items.includes(forbidden)) throw new Error(`NeoForge fixture contains forbidden API ${forbidden}`)
  }
  const lang = await readJson(join(root, `src/main/resources/assets/${NEO_MOD_ID}/lang/en_us.json`))
  requireEqual(lang[`item.${NEO_MOD_ID}.${ITEM_ID}`], 'Codex Gear', 'NeoForge language key')
  const model = await readJson(join(root, `src/main/resources/assets/${NEO_MOD_ID}/models/item/${ITEM_ID}.json`))
  requireEqual(model.parent, 'minecraft:item/generated', 'NeoForge item model parent')
  const textures = model.textures
  if (textures === null || typeof textures !== 'object' || Array.isArray(textures)) throw new Error('NeoForge item model has no texture map')
  requireEqual((textures as Record<string, unknown>).layer0, `${NEO_MOD_ID}:item/${ITEM_ID}`, 'NeoForge item texture')
  const texture = await readFile(join(root, `src/main/resources/assets/${NEO_MOD_ID}/textures/item/${ITEM_ID}.png`))
  requireEqual(texture.subarray(0, 8).toString('hex'), VALID_PNG.subarray(0, 8).toString('hex'), 'NeoForge PNG signature')
  runWiringCheck(root, 'runData', 'MCMOD_NEOFORGE_WIRING_FIXTURE_OK')
}
