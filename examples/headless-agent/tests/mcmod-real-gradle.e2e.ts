import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const enabled = process.env.DSH_MCMOD_REAL_GRADLE === '1'

function commandInvocation(command: string, args: readonly string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args: [...args] }
  const quoteWindowsArg = (value: string): string => /[\s"&|<>^]/u.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value
  const commandLine = [command, ...args].map(quoteWindowsArg).join(' ')
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
  }
}

const gradleAvailable = (() => {
  try {
    const invocation = commandInvocation(process.platform === 'win32' ? 'gradle.bat' : 'gradle', ['--version'])
    execFileSync(invocation.command, invocation.args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const skipReason = !enabled
  ? 'set DSH_MCMOD_REAL_GRADLE=1 to opt into dependency-backed Gradle validation'
  : !gradleAvailable
    ? 'gradle is not available on PATH'
    : undefined

if (skipReason !== undefined) console.info(`[mcmod real Gradle] skipped: ${skipReason}`)

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function write(root: string, path: string, content: string | Uint8Array): Promise<void> {
  const full = join(root, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

async function createFabricFixture(root: string): Promise<void> {
  await write(root, 'settings.gradle', [
    'pluginManagement { repositories { maven { url = "https://maven.fabricmc.net/" }; gradlePluginPortal(); mavenCentral() } }',
    'rootProject.name = "real-fabric-fixture"',
    '',
  ].join('\n'))
  await write(root, 'build.gradle', [
    'plugins { id "fabric-loom" version "1.8.12" }',
    'repositories { maven { url = "https://maven.fabricmc.net/" } }',
    'dependencies {',
    '  minecraft "com.mojang:minecraft:1.21.1"',
    '  mappings "net.fabricmc:yarn:1.21.1+build.3:v2"',
    '  modImplementation "net.fabricmc:fabric-loader:0.16.9"',
    '  modImplementation "net.fabricmc.fabric-api:fabric-api:0.102.0+1.21.1"',
    '}',
    'fabricApi { configureDataGeneration() }',
    'java { withSourcesJar() }',
    '',
  ].join('\n'))
  await write(root, 'src/main/resources/fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'realfabric', version: '1.0.0', entrypoints: { main: ['com.example.real.MinimalMod'], 'fabric-datagen': ['com.example.real.FabricData'] }, depends: { 'fabricloader': '>=0.16.9', minecraft: '1.21.1', 'fabric-api': '*' } }, null, 2) + '\n')
  await write(root, 'src/main/java/com/example/real/MinimalMod.java', [
    'package com.example.real;',
    '',
    'import net.fabricmc.api.ModInitializer;',
    '',
    'public final class MinimalMod implements ModInitializer {',
    '  public static final String MOD_ID = "realfabric";',
    '',
    '  @Override',
    '  public void onInitialize() {',
    '    ModItems.register();',
    '  }',
    '}',
    '',
  ].join('\n'))
  await write(root, 'src/main/java/com/example/real/ModItems.java', [
    'package com.example.real;',
    '',
    'import net.minecraft.item.Item;',
    'import net.minecraft.registry.Registries;',
    'import net.minecraft.registry.Registry;',
    'import net.minecraft.util.Identifier;',
    '',
    'public final class ModItems {',
    '  public static final Item CODEX_GEAR = Registry.register(',
    '    Registries.ITEM,',
    '    Identifier.of(MinimalMod.MOD_ID, "codex_gear"),',
    '    new Item(new Item.Settings())',
    '  );',
    '',
    '  private ModItems() {',
    '  }',
    '',
    '  public static void register() {',
    '  }',
    '}',
    '',
  ].join('\n'))
  await write(root, 'src/main/java/com/example/real/FabricData.java', [
    'package com.example.real;',
    '',
    'import net.fabricmc.fabric.api.datagen.v1.DataGeneratorEntrypoint;',
    'import net.fabricmc.fabric.api.datagen.v1.FabricDataGenerator;',
    '',
    'public final class FabricData implements DataGeneratorEntrypoint {',
    '  @Override',
    '  public void onInitializeDataGenerator(FabricDataGenerator fabricDataGenerator) {',
    '  }',
    '}',
    '',
  ].join('\n'))
  await write(root, 'src/main/resources/assets/realfabric/lang/en_us.json', '{"item.realfabric.codex_gear":"Codex Gear"}\n')
  await write(root, 'src/main/resources/assets/realfabric/models/item/codex_gear.json', '{"parent":"minecraft:item/generated","textures":{"layer0":"realfabric:item/codex_gear"}}\n')
  await write(root, 'src/main/resources/assets/realfabric/textures/item/codex_gear.png', VALID_PNG)
}

async function createNeoForgeFixture(root: string): Promise<void> {
  await write(root, 'settings.gradle', 'rootProject.name = "real-neoforge-fixture"\n')
  await write(root, 'build.gradle', [
    'plugins { id "java-library"; id "net.neoforged.moddev" version "2.0.107" }',
    'neoForge {',
    '  version = "21.1.77"',
    '  runs {',
    '    configureEach { systemProperty "neoforge.enabledGameTestNamespaces", "realneo" }',
    '    data {',
    '      data()',
    '      programArguments.addAll "--mod", "realneo", "--all", "--output", file("src/generated/resources").absolutePath, "--existing", file("src/main/resources").absolutePath',
    '    }',
    '  }',
    '}',
    'sourceSets.main.resources { srcDir "src/generated/resources" }',
    '',
  ].join('\n'))
  await write(root, 'src/main/resources/META-INF/neoforge.mods.toml', 'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="realneo"\nversion="1.0.0"\n')
  await write(root, 'src/main/java/com/example/real/MinimalMod.java', [
    'package com.example.real;',
    '',
    'import net.neoforged.bus.api.IEventBus;',
    'import net.neoforged.fml.common.Mod;',
    '',
    '@Mod("realneo")',
    'public final class MinimalMod {',
    '  public MinimalMod(IEventBus modEventBus) {',
    '    ModItems.ITEMS.register(modEventBus);',
    '  }',
    '}',
    '',
  ].join('\n'))
  await write(root, 'src/main/java/com/example/real/ModItems.java', [
    'package com.example.real;',
    '',
    'import net.minecraft.world.item.Item;',
    'import net.neoforged.neoforge.registries.DeferredHolder;',
    'import net.neoforged.neoforge.registries.DeferredRegister;',
    '',
    'public final class ModItems {',
    '  public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems("realneo");',
    '  public static final DeferredHolder<Item, Item> CODEX_GEAR = ITEMS.registerSimpleItem("codex_gear");',
    '',
    '  private ModItems() {',
    '  }',
    '}',
    '',
  ].join('\n'))
  await write(root, 'src/main/resources/assets/realneo/lang/en_us.json', '{"item.realneo.codex_gear":"Codex Gear"}\n')
  await write(root, 'src/main/resources/assets/realneo/models/item/codex_gear.json', '{"parent":"minecraft:item/generated","textures":{"layer0":"realneo:item/codex_gear"}}\n')
  await write(root, 'src/main/resources/assets/realneo/textures/item/codex_gear.png', VALID_PNG)
}

function wrapperCommand(): { command: string; args: string[] } {
  return process.platform === 'win32'
    ? { command: 'gradlew.bat', args: [] }
    : { command: './gradlew', args: [] }
}

function dependencyUnavailable(result: ReturnType<typeof spawnSync>): string | undefined {
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const unavailablePattern = new RegExp([
    'could not resolve',
    'could not get resource',
    'unknown host',
    'connection timed out',
    'network is unreachable',
    'plugin .* could not be resolved',
  ].join('|'), 'iu')
  return unavailablePattern.test(text)
    ? 'Gradle plugin or dependency resolution is unavailable in this environment'
    : undefined
}

async function runFixture(
  create: (root: string) => Promise<void>,
  tasks: readonly string[],
): Promise<{ result: ReturnType<typeof spawnSync>; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcmod-real-gradle-'))
  await create(root)
  const gradleCommand = process.platform === 'win32' ? 'gradle.bat' : 'gradle'
  const wrapperInvocation = commandInvocation(gradleCommand, ['wrapper', '--gradle-version', '8.10.2'])
  const wrapper = spawnSync(wrapperInvocation.command, wrapperInvocation.args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  })
  if (wrapper.status !== 0) return { result: wrapper, root }
  const command = wrapperCommand()
  const resultInvocation = commandInvocation(command.command, [...command.args, ...tasks])
  const result = spawnSync(resultInvocation.command, resultInvocation.args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 300_000,
  })
  return { result, root }
}

describe.skipIf(skipReason !== undefined)('mcmod real Gradle fixtures', () => {
  it('builds the pinned Fabric fixture and runs its datagen task', async ({ skip }) => {
    const { result, root } = await runFixture(createFabricFixture, ['build', 'runDatagen'])
    try {
      const unavailable = dependencyUnavailable(result)
      if (unavailable !== undefined) skip(unavailable)
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 600_000)

  it('loads the pinned NeoForge ModDev fixture and runs runData without Fabric or Forge APIs', async ({ skip }) => {
    const { result, root } = await runFixture(createNeoForgeFixture, ['build', 'runData'])
    try {
      const unavailable = dependencyUnavailable(result)
      if (unavailable !== undefined) skip(unavailable)
      const source = await readFile(join(root, 'src/main/java/com/example/real/ModItems.java'), 'utf8')
      expect(source).toContain('DeferredRegister')
      expect(source).not.toContain('net.fabricmc')
      expect(source).not.toContain('net.minecraftforge')
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 600_000)
})
