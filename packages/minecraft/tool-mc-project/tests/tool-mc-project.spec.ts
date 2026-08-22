import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMcProject from '@deepseek-ai/dsh-tool-mc-project'

interface DetectionResult {
  workspace: string
  loader: string
  minecraftVersion: string | null
  mappings: { type: string; version: string | null; evidence: string[] }
  modIdCandidates: Array<{ id: string; source: string; confidence: string }>
  languages: { java: boolean; kotlin: boolean }
  mainSourceSets: Array<{ name: string; java: string[]; kotlin: string[]; resources: string[] }>
  resourceRoots: string[]
  mixinConfigs: Array<{ path: string; source: string }>
  datagenClues: Array<{ kind: string; source: string; detail: string }>
  recommendedValidationCommands: string[]
  inspected: { gradleFiles: string[]; metadataFiles: string[]; sourceRoots: string[]; resourceRoots: string[] }
  warnings: string[]
}

interface ResourceIssue {
  code: string
  path: string
  message: string
  reference: string | null
  expectedPath: string | null
}

interface ResourceValidationResult {
  errors: ResourceIssue[]
  warnings: ResourceIssue[]
  checkedFiles: string[]
  detectedModId: string | null
}

interface CheckResult {
  commands: string[]
  exitCode: number | null
  steps: Array<{
    step: string
    command?: string
    status: string
    exitCode: number | null
    stdout: { text: string; truncated: boolean; spillPath?: string }
    stderr: { text: string; truncated: boolean; spillPath?: string }
    timedOut: boolean
    aborted: boolean
    signal: string | null
    sandbox?: { mode: string; denied: boolean; enforcement?: string; runnerFailed?: boolean }
    message?: string
  }>
  failedStep: string | null
  suggestedNextAction: string | null
}

class RecordingShellExecutor extends ShellExecutor {
  readonly commands: string[] = []
  readonly timeoutMs: Array<number | undefined> = []
  readonly results = new Map<string, ShellRunResult>()

  resolve(request: ShellExecRequest): ShellExecSpec {
    this.timeoutMs.push(request.timeoutMs)
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 1_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      ...request.signal !== undefined ? { signal: request.signal } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.commands.push(spec.command)
    return Promise.resolve(this.results.get(spec.command) ?? okResult(`ran ${spec.command}\n`))
  }

  start(): ShellProcess {
    throw new Error('run_mc_check tests do not start background processes')
  }
}

function okResult(stdout: string): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: stdout, truncated: false },
    stderr: { text: '', truncated: false },
  }
}

function failedResult(exitCode: number, stderr: string): ShellRunResult {
  return {
    exitCode,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: '', truncated: false },
    stderr: { text: stderr, truncated: false },
  }
}

function timeoutResult(): ShellRunResult {
  return {
    exitCode: null,
    signal: 'SIGTERM',
    timedOut: true,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: 'partial output', truncated: false },
    stderr: { text: '', truncated: false },
  }
}

function sandboxDeniedResult(): ShellRunResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: '', truncated: false },
    stderr: { text: 'Permission denied', truncated: false },
    sandbox: { mode: 'read-only', denied: true, enforcement: 'full' },
  }
}

let dir: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function write(path: string, content: string): Promise<void> {
  if (dir === undefined) throw new Error('test dir not initialized')
  const full = join(dir, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

async function bootDirect(workspace: string): Promise<Context> {
  const context = new Context()
  ctx = context
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(LocalFileSystem, { cwd: workspace })
  await context.plugin(ToolMcProject)
  return context
}

async function bootWithShell(
  workspace: string,
  config?: ToolMcProject.Config,
): Promise<{ context: Context; shell: RecordingShellExecutor }> {
  const context = new Context()
  ctx = context
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(LocalFileSystem, { cwd: workspace })
  await context.plugin(RecordingShellExecutor)
  const shell = context.shell as RecordingShellExecutor
  await context.plugin(ToolMcProject, config)
  return { context, shell }
}

async function callDetect(context: Context, workspace: string): Promise<DetectionResult> {
  const result = await context.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`detect-${Date.now()}`),
    name: ToolMcProject.DETECT_MC_PROJECT,
    arguments: {},
    agent: { session: { header: { cwd: workspace } } } as never,
  })
  expect(result.isError).toBe(false)
  return result.value as unknown as DetectionResult
}

async function callValidate(context: Context, workspace: string): Promise<ResourceValidationResult> {
  const result = await context.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`validate-${Date.now()}`),
    name: ToolMcProject.VALIDATE_MC_RESOURCES,
    arguments: {},
    agent: { session: { header: { cwd: workspace } } } as never,
  })
  expect(result.isError).toBe(false)
  return result.value as unknown as ResourceValidationResult
}

async function callRunCheck(context: Context, workspace: string, args: { target: string; timeoutMs?: number }): Promise<CheckResult> {
  const result = await context.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`run-check-${Date.now()}`),
    name: ToolMcProject.RUN_MC_CHECK,
    arguments: args,
    agent: { session: { header: { cwd: workspace } } } as never,
  })
  expect(result.isError).toBe(false)
  return result.value as unknown as CheckResult
}

async function createFabricProject(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-fabric-'))
  await write('settings.gradle', 'pluginManagement { repositories { maven { url = "https://maven.fabricmc.net/" } } }\nrootProject.name = "ExampleMod"\n')
  await write('build.gradle', [
    'plugins {',
    '  id "fabric-loom" version "1.8-SNAPSHOT"',
    '  id "maven-publish"',
    '}',
    'dependencies {',
    '  minecraft "com.mojang:minecraft:${project.minecraft_version}"',
    '  mappings "net.fabricmc:yarn:${project.yarn_mappings}:v2"',
    '  modImplementation "net.fabricmc:fabric-loader:${project.loader_version}"',
    '}',
    'tasks.register("runDatagen") {}',
    '',
  ].join('\n'))
  await write('gradle.properties', [
    'minecraft_version=1.21.1',
    'yarn_mappings=1.21.1+build.3',
    'loader_version=0.16.9',
    'mod_id=examplemod',
    '',
  ].join('\n'))
  await write('gradle/libs.versions.toml', '[versions]\nminecraft = "1.21.1"\n')
  await write('gradlew', '#!/bin/sh\n')
  await write('gradlew.bat', '@echo off\r\n')
  await write('src/main/resources/fabric.mod.json', JSON.stringify({
    schemaVersion: 1,
    id: 'examplemod',
    version: '1.0.0',
    entrypoints: {
      main: ['com.example.ExampleMod'],
      'fabric-datagen': ['com.example.ExampleDataGenerator'],
    },
    mixins: ['examplemod.mixins.json'],
    depends: { minecraft: '>=1.21.1' },
  }, null, 2))
  await write('src/main/resources/examplemod.mixins.json', '{"required": true}\n')
  await write('src/main/java/com/example/ExampleMod.java', 'package com.example;\npublic final class ExampleMod {}\n')
  await write('src/main/java/com/example/ExampleDataGenerator.java', 'package com.example;\nimport net.fabricmc.fabric.api.datagen.v1.DataGeneratorEntrypoint;\npublic final class ExampleDataGenerator implements DataGeneratorEntrypoint {}\n')
  return dir
}

async function createForgeProject(loader: 'forge' | 'neoforge' = 'forge'): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), `dsh-mc-project-${loader}-`))
  await write('settings.gradle', 'rootProject.name = "ForgeExample"\n')
  await write('build.gradle', [
    'plugins {',
    loader === 'forge'
      ? '  id "net.minecraftforge.gradle" version "6.0.0"'
      : '  id "net.neoforged.moddev" version "2.0.0"',
    '}',
    'minecraftVersion = "1.21.1"',
    'tasks.register("runData") {}',
    '',
  ].join('\n'))
  await write('gradlew', '#!/bin/sh\n')
  await write('gradlew.bat', '@echo off\r\n')
  await write(`src/main/resources/META-INF/${loader === 'neoforge' ? 'neoforge.mods.toml' : 'mods.toml'}`, [
    'modLoader="javafml"',
    'loaderVersion="[1,)"',
    '[[mods]]',
    'modId="forgeexample"',
    '',
  ].join('\n'))
  await write('src/main/java/com/example/ForgeData.java', 'package com.example;\nimport net.minecraftforge.data.event.GatherDataEvent;\nfinal class ForgeData { GatherDataEvent event; }\n')
  return dir
}

function expectedGradle(task: string): string {
  return `${process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew'} ${task}`
}

async function addValidResources(namespace = 'examplemod'): Promise<void> {
  await write(`src/main/resources/assets/${namespace}/lang/en_us.json`, JSON.stringify({
    [`item.${namespace}.example_item`]: 'Example Item',
    [`block.${namespace}.example_block`]: 'Example Block',
  }, null, 2))
  await write(`src/main/resources/assets/${namespace}/textures/item/example_item.png`, 'png')
  await write(`src/main/resources/assets/${namespace}/textures/block/example_block.png`, 'png')
  await write(`src/main/resources/assets/${namespace}/models/item/example_item.json`, JSON.stringify({
    parent: 'minecraft:item/generated',
    textures: { layer0: `${namespace}:item/example_item` },
  }, null, 2))
  await write(`src/main/resources/assets/${namespace}/models/block/example_block.json`, JSON.stringify({
    parent: 'minecraft:block/cube_all',
    textures: { all: `${namespace}:block/example_block` },
  }, null, 2))
  await write(`src/main/resources/assets/${namespace}/blockstates/example_block.json`, JSON.stringify({
    variants: { '': { model: `${namespace}:block/example_block` } },
  }, null, 2))
  await write(`src/main/resources/data/${namespace}/recipes/example_item.json`, JSON.stringify({
    type: 'minecraft:crafting_shaped',
    pattern: ['#'],
    key: { '#': { item: `${namespace}:example_block` } },
    result: { id: `${namespace}:example_item` },
  }, null, 2))
  await write(`src/main/resources/data/${namespace}/tags/block/example_blocks.json`, JSON.stringify({
    values: [`${namespace}:example_block`],
  }, null, 2))
}

describe('detect_mc_project', () => {
  it('returns structured Fabric project facts without running Gradle', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.workspace).toContain('dsh-mc-project-fabric-')
    expect(detected.loader).toBe('fabric')
    expect(detected.minecraftVersion).toBe('1.21.1')
    expect(detected.mappings).toMatchObject({ type: 'yarn', version: '1.21.1+build.3' })
    expect(detected.modIdCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'examplemod', confidence: 'high' }),
    ]))
    expect(detected.languages).toEqual({ java: true, kotlin: false })
    expect(detected.mainSourceSets).toEqual(expect.arrayContaining([
      {
        name: 'main',
        java: ['src/main/java'],
        kotlin: [],
        resources: ['src/main/resources'],
      },
    ]))
    expect(detected.resourceRoots).toEqual(['src/main/resources'])
    expect(detected.mixinConfigs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'examplemod.mixins.json' }),
      expect.objectContaining({ path: 'src/main/resources/examplemod.mixins.json' }),
    ]))
    expect(detected.datagenClues.map(clue => clue.kind)).toEqual(expect.arrayContaining([
      'fabric-datagen-entrypoint',
      'fabric-datagen-source',
      'gradle',
    ]))
    expect(detected.recommendedValidationCommands).toEqual(['./gradlew build', './gradlew runDatagen'])
    expect(detected.inspected.gradleFiles).toEqual(expect.arrayContaining(['build.gradle', 'gradle.properties', 'gradle/libs.versions.toml']))
    expect(detected.inspected.metadataFiles).toEqual(['src/main/resources/fabric.mod.json'])
  })

  it('returns unknown fields and warnings for a non-Minecraft project', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-unknown-'))
    await write('README.md', '# Plain project\n')
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.loader).toBe('unknown')
    expect(detected.minecraftVersion).toBeNull()
    expect(detected.mappings).toEqual({ type: 'unknown', version: null, evidence: [] })
    expect(detected.modIdCandidates).toEqual([])
    expect(detected.recommendedValidationCommands).toEqual([])
    expect(detected.warnings).toEqual(expect.arrayContaining([
      'no root Gradle files were found',
      'loader could not be identified from Gradle files or mod metadata',
      'Minecraft version could not be identified',
    ]))
  })

  it('owns call and result presentation', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const def = context.tools.get(ToolMcProject.DETECT_MC_PROJECT)
    const detected = await callDetect(context, workspace)
    const content = [{ type: 'text' as const, text: JSON.stringify(detected, null, 2) }]

    expect(def?.presentCall?.({})).toEqual({ card: 'generic', title: 'Detect Minecraft project', kind: 'read' })
    expect(def?.presentResult?.({}, { content, isError: false })).toEqual({
      card: 'generic',
      title: 'Minecraft project facts',
      content,
    })
    const validation = await callValidate(context, workspace)
    const validationContent = [{ type: 'text' as const, text: JSON.stringify(validation, null, 2) }]
    const validationDef = context.tools.get(ToolMcProject.VALIDATE_MC_RESOURCES)

    expect(validationDef?.presentCall?.({})).toEqual({ card: 'generic', title: 'Validate Minecraft resources', kind: 'read' })
    expect(validationDef?.presentResult?.({}, { content: validationContent, isError: false })).toEqual({
      card: 'generic',
      title: 'Minecraft resource validation',
      content: validationContent,
    })
  })

  it('registers and executes through a real Loader composition', async () => {
    const workspace = await createFabricProject()
    const configPath = join(workspace, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: ${JSON.stringify(workspace)}`,
      "- name: '@deepseek-ai/dsh-tool-mc-project'",
      '',
    ].join('\n'))

    const context = new Context()
    ctx = context
    context.baseUrl = pathToFileURL(workspace).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
      ['@deepseek-ai/dsh-tool-mc-project', ToolMcProject],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const module = modules.get(specifier)
        if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return module
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.tools.schemas().map(schema => schema.name)).toEqual(expect.arrayContaining([
      ToolMcProject.DETECT_MC_PROJECT,
      ToolMcProject.VALIDATE_MC_RESOURCES,
    ]))
    expect((await callDetect(context, workspace)).loader).toBe('fabric')
  })
})

describe('validate_mc_resources', () => {
  it('accepts a valid Fabric resource set', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.detectedModId).toBe('examplemod')
    expect(validation.errors).toEqual([])
    expect(validation.warnings).toEqual([])
    expect(validation.checkedFiles).toEqual(expect.arrayContaining([
      'src/main/resources/fabric.mod.json',
      'src/main/resources/assets/examplemod/lang/en_us.json',
      'src/main/resources/assets/examplemod/models/item/example_item.json',
      'src/main/resources/assets/examplemod/models/block/example_block.json',
      'src/main/resources/assets/examplemod/blockstates/example_block.json',
      'src/main/resources/data/examplemod/recipes/example_item.json',
      'src/main/resources/data/examplemod/tags/block/example_blocks.json',
    ]))
  })

  it('reports model textures missing from local resource roots', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await rm(join(workspace, 'src/main/resources/assets/examplemod/textures/item/example_item.png'), { force: true })
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing_texture',
        path: 'src/main/resources/assets/examplemod/models/item/example_item.json',
        reference: 'examplemod:item/example_item',
        expectedPath: 'src/main/resources/assets/examplemod/textures/item/example_item.png',
      }),
    ]))
  })

  it('reports malformed resource JSON', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/lang/en_us.json', '{ bad json')
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'invalid_json',
        path: 'src/main/resources/assets/examplemod/lang/en_us.json',
      }),
    ]))
  })

  it('reports asset namespaces that do not match metadata mod id', async () => {
    const workspace = await createFabricProject()
    await addValidResources('wrongmod')
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.detectedModId).toBe('examplemod')
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'modid_mismatch',
        path: 'src/main/resources/assets/wrongmod',
        reference: 'wrongmod',
      }),
    ]))
  })
})

describe('run_mc_check', () => {
  it('is registered only when a shell executor is mounted', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)

    expect(context.tools.schemas().map(schema => schema.name)).not.toContain(ToolMcProject.RUN_MC_CHECK)
  })

  it('selects Fabric wrapper commands for build, test, datagen, resources, and all', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const { context, shell } = await bootWithShell(workspace)

    const build = await callRunCheck(context, workspace, { target: 'build', timeoutMs: 1234 })
    const test = await callRunCheck(context, workspace, { target: 'test' })
    const datagen = await callRunCheck(context, workspace, { target: 'datagen' })
    const resources = await callRunCheck(context, workspace, { target: 'resources' })
    const all = await callRunCheck(context, workspace, { target: 'all' })

    expect(build.commands).toEqual([expectedGradle('build')])
    expect(build.steps.map(step => step.step)).toEqual(['build'])
    expect(build.failedStep).toBeNull()
    expect(test.commands).toEqual([expectedGradle('test')])
    expect(datagen.commands).toEqual([expectedGradle('runDatagen')])
    expect(resources.commands).toEqual([expectedGradle('processResources')])
    expect(resources.steps.map(step => step.step)).toEqual(['resources:static', 'resources:gradle'])
    expect(all.commands).toEqual([
      expectedGradle('runDatagen'),
      expectedGradle('processResources'),
      expectedGradle('test'),
      expectedGradle('build'),
    ])
    expect(all.steps.map(step => step.step)).toEqual(['datagen', 'resources:static', 'resources:gradle', 'test', 'build'])
    expect(shell.commands).toEqual([
      expectedGradle('build'),
      expectedGradle('test'),
      expectedGradle('runDatagen'),
      expectedGradle('processResources'),
      expectedGradle('runDatagen'),
      expectedGradle('processResources'),
      expectedGradle('test'),
      expectedGradle('build'),
    ])
    expect(shell.timeoutMs[0]).toBe(1234)
  })

  it('selects runData for Forge and NeoForge datagen', async () => {
    const forge = await createForgeProject('forge')
    const forgeHarness = await bootWithShell(forge)
    const forgeResult = await callRunCheck(forgeHarness.context, forge, { target: 'datagen' })
    await forgeHarness.context.fiber.dispose()
    await rm(forge, { recursive: true, force: true })

    const neoforge = await createForgeProject('neoforge')
    const neoHarness = await bootWithShell(neoforge)
    const neoResult = await callRunCheck(neoHarness.context, neoforge, { target: 'datagen' })

    expect(forgeResult.commands).toEqual([expectedGradle('runData')])
    expect(neoResult.commands).toEqual([expectedGradle('runData')])
  })

  it('fails datagen when loader detection is unknown', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-unknown-loader-'))
    await write('build.gradle', 'tasks.register("runDatagen") {}\n')
    const { context, shell } = await bootWithShell(dir)
    const result = await callRunCheck(context, dir, { target: 'datagen' })

    expect(result.commands).toEqual([])
    expect(result.exitCode).toBeNull()
    expect(result.failedStep).toBe('datagen')
    expect(result.suggestedNextAction).toContain('loader evidence')
    expect(shell.commands).toEqual([])
  })

  it('fails before Gradle when static resource validation reports errors', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await rm(join(workspace, 'src/main/resources/assets/examplemod/textures/item/example_item.png'), { force: true })
    const { context, shell } = await bootWithShell(workspace)
    const result = await callRunCheck(context, workspace, { target: 'resources' })

    expect(result.commands).toEqual([expectedGradle('processResources')])
    expect(result.exitCode).toBeNull()
    expect(result.failedStep).toBe('resources:static')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({
      step: 'resources:static',
      status: 'failed',
      exitCode: null,
    })
    expect(result.steps[0]?.stdout.text).toContain('missing_texture')
    expect(shell.commands).toEqual([])
  })

  it('stops all at the first failed Gradle step', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const { context, shell } = await bootWithShell(workspace)
    shell.results.set(expectedGradle('processResources'), failedResult(7, 'resources failed\n'))
    const result = await callRunCheck(context, workspace, { target: 'all' })

    expect(result.commands).toEqual([
      expectedGradle('runDatagen'),
      expectedGradle('processResources'),
      expectedGradle('test'),
      expectedGradle('build'),
    ])
    expect(result.exitCode).toBe(7)
    expect(result.failedStep).toBe('resources:gradle')
    expect(result.steps.map(step => step.step)).toEqual(['datagen', 'resources:static', 'resources:gradle'])
    expect(shell.commands).toEqual([expectedGradle('runDatagen'), expectedGradle('processResources')])
    expect(result.suggestedNextAction).toContain('resources:gradle')
  })

  it('reports missing Gradle files without running shell', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-no-gradle-'))
    await write('src/main/resources/fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'nogradle' }))
    const { context, shell } = await bootWithShell(dir)
    const result = await callRunCheck(context, dir, { target: 'build' })

    expect(result.commands).toEqual([])
    expect(result.exitCode).toBeNull()
    expect(result.failedStep).toBe('gradle')
    expect(result.suggestedNextAction).toContain('Gradle wrapper')
    expect(shell.commands).toEqual([])
  })

  it('summarizes timeout and sandbox-denial failures', async () => {
    const workspace = await createFabricProject()
    const { context, shell } = await bootWithShell(workspace)
    shell.results.set(expectedGradle('test'), timeoutResult())
    shell.results.set(expectedGradle('build'), sandboxDeniedResult())

    const timedOut = await callRunCheck(context, workspace, { target: 'test' })
    const denied = await callRunCheck(context, workspace, { target: 'build' })

    expect(timedOut.failedStep).toBe('test')
    expect(timedOut.steps[0]).toMatchObject({ timedOut: true, signal: 'SIGTERM' })
    expect(timedOut.suggestedNextAction).toContain('timed out')
    expect(denied.failedStep).toBe('build')
    expect(denied.steps[0]?.sandbox).toEqual({ mode: 'read-only', denied: true, enforcement: 'full' })
    expect(denied.suggestedNextAction).toContain('sandbox denied')
  })

  it('caps inline command output summaries', async () => {
    const workspace = await createFabricProject()
    const { context, shell } = await bootWithShell(workspace, { maxOutputSummaryBytes: 10 })
    shell.results.set(expectedGradle('build'), {
      ...okResult('0123456789abcdefghijklmnopqrstuvwxyz'),
      stdout: { text: '0123456789abcdefghijklmnopqrstuvwxyz', truncated: false, spillPath: 'full.log' },
    })
    const result = await callRunCheck(context, workspace, { target: 'build' })

    expect(result.steps[0]?.stdout).toEqual({
      text: 'qrstuvwxyz',
      truncated: true,
      spillPath: 'full.log',
    })
  })
})
