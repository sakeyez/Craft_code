import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { FsError } from '@deepseek-ai/dsh-fs'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMcProject from '@deepseek-ai/dsh-tool-mc-project'

interface DetectionResult {
  workspace: string
  loader: string
  loaderEvidence: Array<{ loader: string; evidence: string[] }>
  minecraftVersion: {
    status: 'determined' | 'unknown' | 'conflict'
    value?: string
    classification?: 'exact' | 'range'
    candidates: Array<{ value: string; classification: 'exact' | 'range'; source: string; evidence: string }>
  }
  mappings: {
    status: 'determined' | 'unknown' | 'conflict'
    type?: string
    version?: string | null
    candidates: Array<{ type: string; version: string | null; source: string; evidence: string }>
  }
  modIdCandidates: Array<{ id: string; source: string; confidence: string }>
  languages: { java: boolean; kotlin: boolean }
  mainSourceSets: Array<{ name: string; java: string[]; kotlin: string[]; resources: string[] }>
  resourceRoots: string[]
  mixinConfigs: Array<{ path: string; source: string }>
  datagenClues: Array<{ kind: string; source: string; detail: string }>
  gradleTaskCandidates: string[]
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

class RecordingApproval {
  readonly requests: ApprovalRequest[] = []
  outcome: ApprovalOutcome = 'allowed-once'

  request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    this.requests.push(request)
    return Promise.resolve(this.outcome)
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

async function write(path: string, content: string | Uint8Array): Promise<void> {
  if (dir === undefined) throw new Error('test dir not initialized')
  const full = join(dir, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content)
}

const VALID_PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

async function bootDirect(workspace: string, config?: ToolMcProject.Config): Promise<Context> {
  const context = new Context()
  ctx = context
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(LocalFileSystem, { cwd: workspace })
  await context.plugin(ToolMcProject, config)
  return context
}

async function bootWithShell(
  workspace: string,
  config?: ToolMcProject.Config,
): Promise<{ context: Context; shell: RecordingShellExecutor; approval: RecordingApproval }> {
  const context = new Context()
  ctx = context
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  await context.plugin(LocalFileSystem, { cwd: workspace })
  await context.plugin(RecordingShellExecutor)
  const shell = context.shell as RecordingShellExecutor
  const approval = new RecordingApproval()
  context.provide('approval', approval as never)
  await context.plugin(ToolMcProject, config)
  return { context, shell, approval }
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

async function callRunCheck(context: Context, workspace: string, args: { target: string; timeoutMs?: number; runtimeMode?: 'client' | 'server' }): Promise<CheckResult> {
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

async function executeTool(
  context: Context,
  name: string,
  workspace: string | undefined,
  arguments_: unknown = {},
): Promise<{ isError: boolean; error?: unknown; value?: unknown }> {
  return context.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`tool-${Date.now()}-${Math.random()}`),
    name,
    arguments: arguments_,
    ...workspace === undefined ? {} : { agent: { session: { header: { cwd: workspace } } } as never },
  })
}

function pngChunk(type: string, data: readonly number[]): Uint8Array {
  const body = Uint8Array.from(data)
  const chunk = new Uint8Array(12 + body.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, body.length, false)
  chunk.set(Buffer.from(type, 'ascii'), 4)
  chunk.set(body, 8)
  return chunk
}

const PNG_SIGNATURE = VALID_PNG.slice(0, 8)

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
  await write(`src/main/resources/assets/${namespace}/textures/item/example_item.png`, VALID_PNG)
  await write(`src/main/resources/assets/${namespace}/textures/block/example_block.png`, VALID_PNG)
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
  it('rejects non-positive scan and output limits at plugin load', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-config-'))
    await expect(bootDirect(dir, { maxEntries: 0 })).rejects.toThrow('maxEntries must be a positive integer')
    await expect(bootDirect(dir, { maxFileBytes: 0 })).rejects.toThrow('maxFileBytes must be a positive integer')
    await expect(bootDirect(dir, { maxOutputSummaryBytes: 0 })).rejects.toThrow('maxOutputSummaryBytes must be a positive integer')
    await expect(bootDirect(dir, { maxTaskDiscoveryBytes: 0 })).rejects.toThrow('maxTaskDiscoveryBytes must be a positive integer')
  })

  it('accepts an explicit empty config and treats nested missing errors as absent files', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace, {})
    const stat = context.fs.stat.bind(context.fs)
    context.fs.stat = async (target, signal) => {
      if (target.displayPath.endsWith('gradle.properties')) {
        const leaf = new FsError('missing', 'FS_NOT_FOUND')
        const middle = new FsError('wrapped', 'FS_IO_ERROR', { cause: leaf })
        return Promise.reject(new FsError('outer', 'FS_IO_ERROR', { cause: middle }))
      }
      return stat(target, signal)
    }
    const detected = await callDetect(context, workspace)

    expect(detected.inspected.gradleFiles).not.toContain('gradle.properties')
  })

  it('uses defaults for explicitly undefined optional limits', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace, {
      maxEntries: undefined,
      maxFileBytes: undefined,
      maxOutputSummaryBytes: undefined,
    } as unknown as ToolMcProject.Config)

    expect((await callDetect(context, workspace)).loader).toBe('fabric')
  })

  it('skips known oversized files and preserves non-Error read diagnostics', async () => {
    const workspace = await createFabricProject()
    await write('build.gradle', 'id "fabric-loom"\n')
    await write('gradle.properties', 'minecraft_version=1.21.1\n')
    const context = await bootDirect(workspace, { maxFileBytes: 24 })
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('build.gradle')) throw 'provider failed'
      return readBytes(target, signal, maxBytes)
    }
    const detected = await callDetect(context, workspace)

    expect(detected.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('build.gradle: could not read text (provider failed)'),
      expect.stringContaining('gradle.properties: skipped because file size'),
    ]))
  })

  it('handles metadata fields with unsupported value types and multiple source sets', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-metadata-types-'))
    await write('build.gradle', [
      'plugins { id "fabric-loom" version "1.8" }',
      'id "org.jetbrains.kotlin.jvm"',
      'minecraft_version = "${project.minecraft_version}"',
      'yarn_mappings = "${project.yarn_mappings}"',
      'org.parchmentmc.data:parchment-1.21:${project.parchment_version}',
      'officialMojangMappings()',
      'org.parchmentmc.data:parchment-1.21:2024.01.01',
      'archivesName = "archive-mod"',
      'mod_id = ""',
      'tasks.register("runDatagen") {}',
    ].join('\n'))
    await write('gradle/libs.versions.toml', '[libraries]\nfoo = "bar"\n')
    await write('src/main/resources/fabric.mod.json', JSON.stringify({
      id: 123,
      mixins: [{ config: 5 }, {}],
      entrypoints: { 'fabric-datagen': [] },
      depends: { minecraft: 42 },
    }))
    await write('src/main/resources/quilt.mod.json', JSON.stringify({ quilt_loader: { id: '', mixins: [5, {}] } }))
    await write('src/main/java/Main.java', 'class Main {}\n')
    await write('src/client/kotlin/Client.kt', 'class Client\n')
    await write('src/client/resources/lang/en_us.json', '{}')
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.mainSourceSets.map(sourceSet => sourceSet.name)).toEqual(['client', 'main'])
    expect(detected.mappings.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'official', version: null }),
      expect.objectContaining({ type: 'parchment', version: '2024.01.01' }),
    ]))
    expect(detected.modIdCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'archive-mod', confidence: 'low' }),
    ]))
  })

  it('keeps non-string version mapping entries and empty source sets out of facts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-empty-source-set-'))
    await write('gradle/libs.versions.toml', '[versions]\nyarn = 1\nminecraft = 1\nparchment = "2024.01"\n')
    await write('src/empty/README.md', 'no source roots\n')
    await write('src/main/resources/fabric.mod.json', JSON.stringify({ id: 'emptyset', mixins: [{ config: 'empty.mixins.json' }, {}, null] }))
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.mainSourceSets.map(sourceSet => sourceSet.name)).toEqual(['main'])
    expect(detected.mappings.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'parchment', version: '2024.01' }),
    ]))
  })

  it('uses the filesystem default cwd when the execution header omits cwd', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const result = await executeTool(context, ToolMcProject.DETECT_MC_PROJECT, undefined)

    expect(result.isError).toBe(false)
    expect((result.value as DetectionResult).loader).toBe('fabric')
  })

  it('warns when the workspace target is not a directory', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const stat = context.fs.stat.bind(context.fs)
    context.fs.stat = async (target, signal) => {
      if (target.displayPath === workspace) return { version: 'root' as never, type: 'file' }
      return stat(target, signal)
    }
    const detected = await callDetect(context, workspace)

    expect(detected.warnings).toContain('workspace root is not a directory')
  })

  it('treats a missing directory-list result as optional', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const listDir = context.fs.listDir.bind(context.fs)
    context.fs.listDir = async (target, signal) => {
      if (target.displayPath.replaceAll('\\', '/').endsWith('/src') || target.displayPath === 'src') {
        const missing = new FsError('missing', 'FS_NOT_FOUND')
        throw new FsError('wrapped missing', 'FS_IO_ERROR', { cause: missing })
      }
      return listDir(target, signal)
    }
    const detected = await callDetect(context, workspace)

    expect(detected.mainSourceSets).toEqual([])
  })

  it('returns structured Fabric project facts without running Gradle', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.workspace).toContain('dsh-mc-project-fabric-')
    expect(detected.loader).toBe('fabric')
    expect(detected.minecraftVersion).toMatchObject({ status: 'determined', value: '1.21.1', classification: 'exact' })
    expect(detected.minecraftVersion.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '1.21.1', classification: 'exact', source: 'gradle.properties' }),
      expect.objectContaining({ value: '>=1.21.1', classification: 'range', source: 'src/main/resources/fabric.mod.json' }),
    ]))
    expect(detected.mappings).toMatchObject({ status: 'determined', type: 'yarn', version: '1.21.1+build.3' })
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
    expect(detected.gradleTaskCandidates).toContain('runDatagen')
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
    expect(detected.minecraftVersion).toEqual({ status: 'unknown', candidates: [] })
    expect(detected.mappings).toEqual({ status: 'unknown', candidates: [] })
    expect(detected.modIdCandidates).toEqual([])
    expect(detected.recommendedValidationCommands).toEqual([])
    expect(detected.warnings).toEqual(expect.arrayContaining([
      'no root Gradle files were found',
      'loader could not be identified from Gradle files or mod metadata',
      'Minecraft version could not be identified',
    ]))
  })

  it('keeps exact and compatible range evidence while determining the exact version', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.minecraftVersion.status).toBe('determined')
    expect(detected.minecraftVersion.classification).toBe('exact')
    expect(detected.minecraftVersion.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '>=1.21.1', classification: 'range' }),
    ]))
  })

  it('reports two exact Minecraft versions as a conflict', async () => {
    const workspace = await createFabricProject()
    await write('gradle.properties', 'minecraft_version=1.20.1\nmod_id=examplemod\n')
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.minecraftVersion.status).toBe('conflict')
    expect(detected.minecraftVersion.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '1.20.1', classification: 'exact', source: 'gradle.properties' }),
      expect.objectContaining({ value: '1.21.1', classification: 'exact', source: 'gradle/libs.versions.toml' }),
    ]))
  })

  it('reports a range-only version without inventing an exact version', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-range-only-'))
    await write('build.gradle', 'plugins { id "fabric-loom" version "1.8-SNAPSHOT" }\n')
    await write('src/main/resources/fabric.mod.json', JSON.stringify({ id: 'rangemod', depends: { minecraft: '>=1.21 <1.22' } }))
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.minecraftVersion).toMatchObject({ status: 'determined', value: '>=1.21 <1.22', classification: 'range' })
  })

  it('reports an exact version that violates a range candidate as a conflict', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-version-range-conflict-'))
    await write('gradle.properties', 'minecraft_version=1.20.1\n')
    await write('src/main/resources/fabric.mod.json', JSON.stringify({ id: 'rangeconflict', depends: { minecraft: '>=1.21' } }))
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.minecraftVersion.status).toBe('conflict')
  })

  it('detects Quilt metadata, object-free mixins, and Kotlin source roots', async () => {
    const workspace = await createFabricProject()
    await rm(join(workspace, 'src/main/resources/fabric.mod.json'))
    await write('build.gradle', 'plugins { id "org.quiltmc.loom" version "1.6-SNAPSHOT" }\n')
    await write('src/main/resources/quilt.mod.json', JSON.stringify({
      quilt_loader: { id: 'quiltmod', mixins: ['quilt.mixins.json', { config: 'ignored' }] },
    }))
    await write('src/main/kotlin/com/example/Example.kt', 'class Example\n')
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.loader).toBe('quilt')
    expect(detected.languages).toEqual({ java: true, kotlin: true })
    expect(detected.mixinConfigs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'quilt.mixins.json' }),
    ]))
  })

  it('reports malformed metadata and version TOML as warnings', async () => {
    const workspace = await createFabricProject()
    await write('src/main/resources/fabric.mod.json', '{ bad json')
    await write('gradle/libs.versions.toml', '[versions\n')
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.loader).toBe('fabric')
    expect(detected.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('gradle/libs.versions.toml: could not parse TOML'),
      expect.stringContaining('fabric.mod.json: could not parse JSON'),
    ]))
  })

  it('reports malformed Quilt and Forge metadata JSON/TOML', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-malformed-metadata-'))
    await write('build.gradle', 'plugins { id "quilt-loom" version "1.0" }\n')
    await write('src/main/resources/quilt.mod.json', '{ bad json')
    await write('src/main/resources/META-INF/mods.toml', '[[mods]\nmodId = "broken"')
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('quilt.mod.json: could not parse JSON'),
      expect.stringContaining('mods.toml: could not parse TOML'),
    ]))
  })

  it('keeps valid primitive metadata documents loader-safe', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-primitive-metadata-'))
    await write('src/main/resources/fabric.mod.json', '42')
    await write('src/main/resources/quilt.mod.json', '42')
    await write('src/main/resources/META-INF/mods.toml', 'mods = [1]\n')
    await write('src/main/resources/META-INF/neoforge.mods.toml', 'modLoader = "javafml"\n')
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.loader).toBe('unknown')
    expect(detected.modIdCandidates).toEqual([])
  })

  it('handles binary, malformed, oversized, and generic text-read failures', async () => {
    const workspace = await createFabricProject()
    await write('gradle.properties', Uint8Array.from([0x6d, 0x6f, 0x64, 0x00, 0xff]))
    const context = await bootDirect(workspace, { maxFileBytes: 16 })
    const stat = context.fs.stat.bind(context.fs)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.stat = async (target, signal) => {
      const info = await stat(target, signal)
      if (target.displayPath.endsWith('settings.gradle') && info !== undefined) {
        return { version: info.version, type: info.type }
      }
      return info
    }
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('settings.gradle')) throw new Error('temporary read failure')
      return readBytes(target, signal, maxBytes)
    }
    const detected = await callDetect(context, workspace)

    expect(detected.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('settings.gradle: could not read text'),
      expect.stringContaining('gradle.properties: could not read text'),
    ]))
  })

  it('reports invalid UTF-8 text as a read warning', async () => {
    const workspace = await createFabricProject()
    await write('gradle.properties', Uint8Array.from([0xff, 0xfe]))
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('gradle.properties: could not read text'),
    ]))
  })

  it('stops a directory walk at maxEntries and preserves the scan warning', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace, { maxEntries: 1 })
    const detected = await callDetect(context, workspace)

    expect(detected.warnings).toContain('directory scan stopped after maxEntries 1')
  })

  it('does not repeat the scan warning across multiple resource roots', async () => {
    const workspace = await createFabricProject()
    await write('src/client/resources/lang/en_us.json', '{}')
    const context = await bootDirect(workspace, { maxEntries: 1 })
    const detected = await callDetect(context, workspace)

    expect(detected.warnings.filter(warning => warning.includes('directory scan stopped after maxEntries 1')).length).toBeGreaterThan(1)
  })

  it('reports conflicting Fabric and NeoForge loader evidence', async () => {
    const workspace = await createFabricProject()
    await write('src/main/resources/META-INF/neoforge.mods.toml', 'modLoader="javafml"\n[[mods]]\nmodId="examplemod"\n')
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.loader).toBe('unknown')
    expect(detected.loaderEvidence.map(item => item.loader)).toEqual(['fabric', 'neoforge'])
    expect(detected.warnings).toContain('conflicting loader evidence: fabric, neoforge')
  })

  it('reports mappings candidates instead of choosing a priority winner', async () => {
    const workspace = await createFabricProject()
    await write('gradle.properties', 'minecraft_version=1.21.1\nyarn_mappings=1.20.1+build.1\nmod_id=examplemod\n')
    await write('build.gradle', 'mappings "net.fabricmc:yarn:1.21.1+build.3:v2"\n')
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.mappings.status).toBe('conflict')
    expect(detected.mappings.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'yarn', version: '1.20.1+build.1' }),
      expect.objectContaining({ type: 'yarn', version: '1.21.1+build.3' }),
    ]))
  })

  it('propagates filesystem permission failures instead of reporting an absent project', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const stat = context.fs.stat.bind(context.fs)
    context.fs.stat = async (target, signal) => {
      if (target.displayPath.endsWith('build.gradle')) {
        throw new FsError('build.gradle is not readable', 'FS_PERMISSION_DENIED')
      }
      return stat(target, signal)
    }

    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('detect-permission-failure'),
      name: ToolMcProject.DETECT_MC_PROJECT,
      arguments: {},
      agent: { session: { header: { cwd: workspace } } } as never,
    })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_PERMISSION_DENIED' } })
  })

  it('propagates cancellation from bounded text reads', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('build.gradle')) {
        throw new FsError('read aborted', 'FS_ABORTED')
      }
      return readBytes(target, signal, maxBytes)
    }

    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('detect-read-aborted'),
      name: ToolMcProject.DETECT_MC_PROJECT,
      arguments: {},
      agent: { session: { header: { cwd: workspace } } } as never,
    })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_ABORTED' } })
  })

  it('does not treat an exhausted cause chain as a missing file', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const stat = context.fs.stat.bind(context.fs)
    context.fs.stat = async (target, signal) => {
      if (!target.displayPath.endsWith('gradle.properties')) return stat(target, signal)
      const fourth = { code: 'NOT_FOUND_BUT_NOT_CODED', cause: { code: 'DEEPER' } }
      const third = { code: 'FS_IO_ERROR', cause: fourth }
      const second = { code: 'FS_IO_ERROR', cause: third }
      const first = new FsError('outer', 'FS_IO_ERROR', { cause: second })
      throw first
    }
    const result = await executeTool(context, ToolMcProject.DETECT_MC_PROJECT, workspace)

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_IO_ERROR' } })
  })

  it('propagates errors whose provider code is not a string', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const stat = context.fs.stat.bind(context.fs)
    context.fs.stat = async (target, signal) => {
      if (target.displayPath.endsWith('gradle.properties')) throw { code: 42 }
      return stat(target, signal)
    }
    const result = await executeTool(context, ToolMcProject.DETECT_MC_PROJECT, workspace)

    expect(result.isError).toBe(true)
  })

  it('enforces maxFileBytes when the provider omits file sizes', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace, { maxFileBytes: 64 })
    const stat = context.fs.stat.bind(context.fs)
    const readBytes = context.fs.readBytes.bind(context.fs)
    const limits: number[] = []
    context.fs.stat = async (target, signal) => {
      const info = await stat(target, signal)
      if (info?.type !== 'file') return info
      return { version: info.version, type: info.type }
    }
    context.fs.readBytes = async (target, signal, maxBytes) => {
      limits.push(maxBytes)
      return readBytes(target, signal, maxBytes)
    }

    const detected = await callDetect(context, workspace)

    expect(limits).not.toEqual([])
    expect(new Set(limits)).toEqual(new Set([64]))
    expect(detected.inspected.gradleFiles).not.toContain('build.gradle')
    expect(detected.warnings).toContain('build.gradle: skipped because content exceeds maxFileBytes 64')
  })

  it.each(['forge', 'neoforge'] as const)('recommends runData for a detected %s project', async (loader) => {
    const workspace = await createForgeProject(loader)
    const context = await bootDirect(workspace)
    const detected = await callDetect(context, workspace)

    expect(detected.loader).toBe(loader)
    expect(detected.datagenClues).not.toEqual([])
    expect(detected.recommendedValidationCommands).toEqual(['./gradlew build', './gradlew runData'])
    expect(detected.recommendedValidationCommands).not.toContain('./gradlew runDatagen')
  })

  it('does not infer a datagen task when loader evidence is unknown', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-unknown-datagen-'))
    await write('build.gradle', 'tasks.register("runDatagen") {}\n')
    const context = await bootDirect(dir)
    const detected = await callDetect(context, dir)

    expect(detected.loader).toBe('unknown')
    expect(detected.datagenClues).not.toEqual([])
    expect(detected.recommendedValidationCommands).toEqual(['gradle build'])
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

  it('unregisters every tool when its plugin fiber is disposed', async () => {
    const workspace = await createFabricProject()
    const context = new Context()
    ctx = context
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    await context.plugin(LocalFileSystem, { cwd: workspace })
    await context.plugin(RecordingShellExecutor)
    const fiber = await context.plugin(ToolMcProject)

    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      ToolMcProject.DETECT_MC_PROJECT,
      ToolMcProject.VALIDATE_MC_RESOURCES,
      ToolMcProject.RUN_MC_CHECK,
    ])
    await fiber.dispose()
    expect(context.tools.schemas()).toEqual([])
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
  it('validates conventional top-level resource roots when no source-set root exists', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-top-level-resources-'))
    await write('assets/examplemod/lang/en_us.json', '{}')
    const context = await bootDirect(dir)
    const validation = await callValidate(context, dir)

    expect(validation.errors).toEqual([])
    expect(validation.warnings).toEqual([])
    expect(validation.checkedFiles).toContain('assets/examplemod/lang/en_us.json')
  })

  it('reports the absence of resource roots instead of inventing one', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-no-resource-root-'))
    await write('src/main/java/Example.java', 'final class Example {}\n')
    const context = await bootDirect(dir)
    const validation = await callValidate(context, dir)

    expect(validation.errors).toEqual([])
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'no_resource_roots' }),
    ]))
  })

  it('propagates a directory-list IO error from resource discovery', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const listDir = context.fs.listDir.bind(context.fs)
    context.fs.listDir = async (target, signal) => {
      if (target.displayPath.replaceAll('\\', '/').endsWith('src/main/resources')) throw new FsError('listing failed', 'FS_IO_ERROR')
      return listDir(target, signal)
    }

    const result = await executeTool(context, ToolMcProject.VALIDATE_MC_RESOURCES, workspace)

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_IO_ERROR' } })
  })

  it('keeps a non-directory src path out of fallback roots', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-src-file-'))
    await write('src', 'not a directory\n')
    const context = await bootDirect(dir)
    const validation = await callValidate(context, dir)

    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'no_resource_roots' }),
    ]))
  })

  it('accepts a valid Fabric resource set', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/README.txt', 'not a namespace directory\n')
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

  it('validates language entry values and structured data resource roots', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/lang/en_us.json', JSON.stringify({
      'item.examplemod.example_item': 42,
    }))
    await write('src/main/resources/data/examplemod/loot_tables/example.json', '[]')
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_lang_entry', reference: 'item.examplemod.example_item' }),
    ]))
    expect(validation.errors.some(issue => issue.code === 'invalid_resource_shape' && issue.path.includes('loot_tables/example.json'))).toBe(true)
  })

  it('bounds resource text reads when directory entries omit file sizes', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/lang/en_us.json', JSON.stringify({ key: 'x'.repeat(256) }))
    const context = await bootDirect(workspace, { maxFileBytes: 128 })
    const listDir = context.fs.listDir.bind(context.fs)
    const readBytes = context.fs.readBytes.bind(context.fs)
    const limits: number[] = []
    context.fs.listDir = async (target, signal) => (await listDir(target, signal)).map(entry => ({
      name: entry.name,
      type: entry.type,
      target: entry.target,
      ...entry.version === undefined ? {} : { version: entry.version },
    }))
    context.fs.readBytes = async (target, signal, maxBytes) => {
      limits.push(maxBytes)
      return readBytes(target, signal, maxBytes)
    }

    const validation = await callValidate(context, workspace)

    expect(new Set(limits)).toEqual(new Set([128]))
    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'file_too_large',
        path: 'src/main/resources/assets/examplemod/lang/en_us.json',
      }),
    ]))
    expect(validation.checkedFiles).not.toContain('src/main/resources/assets/examplemod/lang/en_us.json')
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

  it('rejects text and truncated PNG files', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/textures/item/example_item.png', 'placeholder texture')
    await write('src/main/resources/assets/examplemod/textures/block/example_block.png', VALID_PNG.slice(0, 8))
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_png', path: 'src/main/resources/assets/examplemod/textures/item/example_item.png' }),
      expect.objectContaining({ code: 'invalid_png', path: 'src/main/resources/assets/examplemod/textures/block/example_block.png' }),
    ]))
  })

  it('reports a valid PNG whose chunk checksum was corrupted', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const corrupted = Uint8Array.from(VALID_PNG)
    const last = corrupted.length - 1
    corrupted[last] = (corrupted[last] ?? 0) ^ 1
    await write('src/main/resources/assets/examplemod/textures/item/corrupt-crc.png', corrupted)
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors.some(issue => issue.code === 'invalid_png'
      && issue.path.includes('corrupt-crc.png')
      && issue.message.includes('CRC'))).toBe(true)
  })

  it('reports each malformed PNG structural case', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const ihdr = pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
    await write('src/main/resources/assets/examplemod/textures/empty.png', new Uint8Array())
    await write('src/main/resources/assets/examplemod/textures/no-header.png', PNG_SIGNATURE)
    await write('src/main/resources/assets/examplemod/textures/short-header.png', Uint8Array.from([...PNG_SIGNATURE, 0, 0, 0]))
    await write('src/main/resources/assets/examplemod/textures/not-ihdr.png', Uint8Array.from([...PNG_SIGNATURE, ...pngChunk('IEND', [])]))
    await write('src/main/resources/assets/examplemod/textures/bad-ihdr.png', Uint8Array.from([...PNG_SIGNATURE, ...pngChunk('IHDR', [])]))
    await write('src/main/resources/assets/examplemod/textures/zero-dimension.png', Uint8Array.from([...PNG_SIGNATURE, ...pngChunk('IHDR', [0, 0, 0, 0, 0, 0, 0, 1, 8, 6, 0, 0, 0])]))
    await write('src/main/resources/assets/examplemod/textures/no-end.png', Uint8Array.from([...PNG_SIGNATURE, ...ihdr]))
    await write('src/main/resources/assets/examplemod/textures/bad-end.png', Uint8Array.from([...PNG_SIGNATURE, ...ihdr, ...pngChunk('IEND', [1])]))
    await write('src/main/resources/assets/examplemod/textures/duplicate-header.png', Uint8Array.from([...PNG_SIGNATURE, ...ihdr, ...ihdr]))
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors.filter(issue => issue.code === 'invalid_png')).toHaveLength(9)
  })

  it('reports a PNG chunk whose declared payload is truncated', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const truncated = new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 100, ...Buffer.from('IHDR', 'ascii'), 0, 0, 0, 0])
    await write('src/main/resources/assets/examplemod/textures/item/truncated-data.png', truncated)
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors.some(issue => issue.code === 'invalid_png' && issue.path.includes('truncated-data.png'))).toBe(true)
  })

  it('reports bounded PNG read failures as warnings and propagates cancellation', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const context = await bootDirect(workspace)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('example_item.png')) throw new FsError('image too large', 'FS_TOO_LARGE')
      if (target.displayPath.endsWith('example_block.png')) throw new FsError('image aborted', 'FS_ABORTED')
      return readBytes(target, signal, maxBytes)
    }

    const result = await executeTool(context, ToolMcProject.VALIDATE_MC_RESOURCES, workspace)

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_ABORTED' } })
  })

  it('reports bounded PNG and text read limits without aborting validation', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const context = await bootDirect(workspace)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('example_item.png')) throw new FsError('image too large', 'FS_TOO_LARGE')
      if (target.displayPath.endsWith('en_us.json')) throw new FsError('text too large', 'FS_TOO_LARGE')
      return readBytes(target, signal, maxBytes)
    }
    const validation = await callValidate(context, workspace)

    expect(validation.warnings.filter(issue => issue.code === 'file_too_large')).not.toHaveLength(0)
  })

  it('reports a non-abort text read failure as a warning', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const context = await bootDirect(workspace)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('en_us.json')) throw 'text provider failed'
      return readBytes(target, signal, maxBytes)
    }
    const validation = await callValidate(context, workspace)

    expect(validation.warnings.some(issue => issue.code === 'read_failed' && issue.path.includes('en_us.json'))).toBe(true)
  })

  it('propagates cancellation while reading a JSON resource', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    const context = await bootDirect(workspace)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('en_us.json')) throw new FsError('resource aborted', 'FS_ABORTED')
      return readBytes(target, signal, maxBytes)
    }
    const result = await executeTool(context, ToolMcProject.VALIDATE_MC_RESOURCES, workspace)

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_ABORTED' } })
  })

  it('checks local model parents but ignores vanilla and dependency parents', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/models/block/local_child.json', JSON.stringify({
      parent: 'examplemod:block/missing_parent',
      textures: { all: 'examplemod:block/example_block' },
    }))
    await write('src/main/resources/assets/examplemod/models/block/vanilla_child.json', JSON.stringify({
      parent: 'minecraft:block/cube_all',
      textures: { all: 'examplemod:block/example_block' },
    }))
    await write('src/main/resources/assets/examplemod/models/block/dependency_child.json', JSON.stringify({
      parent: 'othermod:block/base',
      textures: { all: 'examplemod:block/example_block' },
    }))
    await write('src/main/resources/assets/examplemod/models/block/existing_parent.json', JSON.stringify({
      textures: { all: 'examplemod:block/example_block' },
    }))
    await write('src/main/resources/assets/examplemod/models/block/existing_child.json', JSON.stringify({
      parent: 'examplemod:block/existing_parent',
      textures: { all: 'examplemod:block/example_block' },
    }))
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing_model_parent',
        path: 'src/main/resources/assets/examplemod/models/block/local_child.json',
        reference: 'examplemod:block/missing_parent',
      }),
    ]))
    expect(validation.errors.some(issue =>
      issue.code === 'missing_model_parent'
      && (issue.path.endsWith('vanilla_child.json') || issue.path.endsWith('dependency_child.json')),
    )).toBe(false)
  })

  it('accepts default-namespace resource references', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/models/item/default-namespace.json', JSON.stringify({
      textures: { layer0: 'item/example_item' },
    }))
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors.some(issue => issue.path.endsWith('default-namespace.json'))).toBe(false)
  })

  it('checks nested blockstate models and ignores invalid or dependency references', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/blockstates/nested.json', JSON.stringify({
      variants: [{ model: 'examplemod:block/missing_nested' }, { model: '#multipart' }, { model: 'bad ref' }, { model: 'othermod:block/dependency' }],
    }))
    await write('src/main/resources/assets/examplemod/models/block/reference-cases.json', JSON.stringify({
      textures: { local: 'examplemod:block/missing_texture', dependency: 'othermod:block/texture', virtual: '#layer', malformed: 'bad ref' },
    }))
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_model', reference: 'examplemod:block/missing_nested' }),
      expect.objectContaining({ code: 'missing_texture', reference: 'examplemod:block/missing_texture' }),
    ]))
    expect(validation.errors.some(issue => issue.reference === 'othermod:block/dependency')).toBe(false)
  })

  it('reports unknown namespaces in nested data values and keys', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/data/examplemod/recipes/namespaces.json', JSON.stringify({
      'othermod:input': ['thirdmod:item', { nested: 'fourthmod:block' }],
    }))
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.warnings.filter(issue => issue.code === 'suspicious_namespace').map(issue => issue.reference)).toEqual(expect.arrayContaining([
      'othermod:input',
      'thirdmod:item',
      'fourthmod:block',
    ]))
  })

  it('reports ambiguous high-confidence mod ids and accepts current item formats', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/quilt.mod.json', JSON.stringify({ quilt_loader: { id: 'othermod' } }))
    await write('gradle.properties', 'minecraft_version=1.21.4\nmod_id=examplemod\n')
    await rm(join(workspace, 'gradle/libs.versions.toml'))
    await write('src/main/resources/assets/examplemod/items/example_item.json', '{"model":{"type":"minecraft:model","model":"examplemod:item/example_item"}}')
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ambiguous_modid' }),
    ]))
    expect(validation.warnings.some(issue => issue.code === 'item_definition_version')).toBe(false)
  })

  it('warns instead of assuming a version for item-definition resources', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/items/example_item.json', '{"model":{"type":"minecraft:model","model":"examplemod:item/example_item"}}')
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'item_definition_version', path: 'src/main/resources/assets/examplemod/items' }),
    ]))
  })

  it('reports item-definition compatibility as unknown without an exact version', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-item-version-unknown-'))
    await write('assets/examplemod/items/example_item.json', '{"model":{"type":"minecraft:model"}}')
    const context = await bootDirect(dir)
    const validation = await callValidate(context, dir)

    expect(validation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'item_definition_version_unknown' }),
    ]))
  })

  it('covers resource scan warnings, known PNG size limits, and generic read failures', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/textures/item/large.png', new Uint8Array(200))
    const scanContext = await bootDirect(workspace, { maxEntries: 1 })
    const scanValidation = await callValidate(scanContext, workspace)
    expect(scanValidation.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'scan_warning' }),
    ]))
    await scanContext.fiber.dispose()

    const context = await bootDirect(workspace, { maxFileBytes: 100 })
    const validation = await callValidate(context, workspace)

    expect(validation.warnings.some(issue => issue.code === 'file_too_large' && issue.path.includes('large.png'))).toBe(true)
    await context.fiber.dispose()

    const readContext = await bootDirect(workspace)
    const readBytes = readContext.fs.readBytes.bind(readContext.fs)
    readContext.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('example_block.png')) throw new Error('image provider failed')
      if (target.displayPath.endsWith('example_item.png')) throw 'image provider failed without Error'
      return readBytes(target, signal, maxBytes)
    }
    const readValidation = await callValidate(readContext, workspace)
    expect(readValidation.errors.some(issue => issue.code === 'invalid_png' && issue.path.includes('example_block.png'))).toBe(true)
  })

  it('handles empty and primitive model documents without inventing references', async () => {
    const workspace = await createFabricProject()
    await addValidResources()
    await write('src/main/resources/assets/examplemod/models/item/no-textures.json', '{"parent":"minecraft:item/generated"}')
    await write('src/main/resources/assets/examplemod/blockstates/primitive.json', '42')
    await write('src/main/resources/assets/examplemod/blockstates/empty-array.json', '[]')
    await write('src/main/resources/data/examplemod/recipes/primitive.json', '42')
    const context = await bootDirect(workspace)
    const validation = await callValidate(context, workspace)

    expect(validation.errors.some(issue => issue.path.includes('no-textures.json') && issue.code === 'missing_texture')).toBe(false)
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
    const { context, shell, approval } = await bootWithShell(workspace)

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
    expect(approval.requests).toHaveLength(0)
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

  it('uses the system Gradle command when no wrapper is present', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-system-gradle-'))
    await write('build.gradle', 'plugins { id "fabric-loom" version "1.8" }\n')
    const { context, shell } = await bootWithShell(dir)
    const result = await callRunCheck(context, dir, { target: 'build' })

    expect(result.commands).toEqual(['gradle build'])
    expect(shell.commands).toEqual(['gradle build'])
  })

  it('discovers a loader-provided datagen task when the build text has no declaration', async () => {
    const workspace = await createFabricProject()
    const build = await readFile(join(workspace, 'build.gradle'), 'utf8')
    await write('build.gradle', build.replace('tasks.register("runDatagen") {}\n', ''))
    const { context, shell } = await bootWithShell(workspace)
    shell.results.set(expectedGradle('tasks --all --console=plain'), okResult([
      'Build tasks',
      '-----------',
      'build - Assembles the outputs',
      'Fabric tasks',
      '------------',
      'runDatagen - Runs data generation',
      '',
    ].join('\n')))

    const result = await callRunCheck(context, workspace, { target: 'datagen' })

    expect(result.commands).toEqual([
      expectedGradle('tasks --all --console=plain'),
      expectedGradle('runDatagen'),
    ])
    expect(result.steps.map(step => step.step)).toEqual(['gradle:tasks', 'datagen'])
    expect(result.failedStep).toBeNull()
    expect(shell.commands).toEqual([
      expectedGradle('tasks --all --console=plain'),
      expectedGradle('runDatagen'),
    ])
  })

  it('uses one custom datagen declaration without probing Gradle tasks', async () => {
    const workspace = await createFabricProject()
    await write('build.gradle', 'plugins { id "fabric-loom" version "1.8" }\ntasks.register("generateFabricData") {}\n')
    const { context, shell } = await bootWithShell(workspace)

    const result = await callRunCheck(context, workspace, { target: 'datagen' })

    expect(result.commands).toEqual([expectedGradle('generateFabricData')])
    expect(result.steps.map(step => step.step)).toEqual(['datagen'])
    expect(shell.commands).toEqual([expectedGradle('generateFabricData')])
  })

  it('reports a truncated or ambiguous Gradle task listing without guessing', async () => {
    const workspace = await createFabricProject()
    const build = await readFile(join(workspace, 'build.gradle'), 'utf8')
    await write('build.gradle', build.replace('tasks.register("runDatagen") {}\n', ''))
    const { context, shell } = await bootWithShell(workspace, { maxTaskDiscoveryBytes: 12 })
    shell.results.set(expectedGradle('tasks --all --console=plain'), {
      ...okResult('runDatagen - one\ngenerateData - two\n'),
      stdout: { text: 'runDatagen - one\ngenerateData - two\n', truncated: true },
    })

    const result = await callRunCheck(context, workspace, { target: 'datagen' })

    expect(result.failedStep).toBe('gradle:tasks')
    expect(result.steps[0]).toMatchObject({
      step: 'gradle:tasks',
      status: 'failed',
    })
    expect(result.steps[0]?.message?.includes('maxTaskDiscoveryBytes')).toBe(true)
    expect(shell.commands).toEqual([expectedGradle('tasks --all --console=plain')])
  })

  it('requires an explicit runtime mode before launching a Minecraft process', async () => {
    const workspace = await createFabricProject()
    const { context, shell, approval } = await bootWithShell(workspace)

    const result = await callRunCheck(context, workspace, { target: 'runtime' })

    expect(result.failedStep).toBe('runtime')
    expect(result.suggestedNextAction).toContain('client or dedicated server')
    expect(shell.commands).toEqual([])
    expect(approval.requests).toHaveLength(0)
  })

  it('asks for approval before discovering and running a runtime task', async () => {
    const workspace = await createFabricProject()
    const build = await readFile(join(workspace, 'build.gradle'), 'utf8')
    await write('build.gradle', build.replace('tasks.register("runDatagen") {}\n', ''))
    const { context, shell, approval } = await bootWithShell(workspace)
    shell.results.set(expectedGradle('tasks --all --console=plain'), okResult('runClient - launches the client\nrunServer - launches the server\n'))

    const result = await callRunCheck(context, workspace, { target: 'runtime', runtimeMode: 'server', timeoutMs: 321 })

    expect(result.commands).toEqual([
      expectedGradle('tasks --all --console=plain'),
      expectedGradle('runServer'),
    ])
    expect(result.steps.map(step => step.step)).toEqual(['gradle:tasks', 'runtime'])
    expect(result.failedStep).toBeNull()
    expect(shell.commands).toEqual([
      expectedGradle('tasks --all --console=plain'),
      expectedGradle('runServer'),
    ])
    expect(shell.timeoutMs).toContain(321)
    expect(approval.requests).toHaveLength(1)
    expect(approval.requests[0]).toMatchObject({
      toolName: ToolMcProject.RUN_MC_CHECK,
      reason: 'Launching a Minecraft client or dedicated server requires explicit user approval.',
    })
  })

  it('does not run Gradle when runtime approval is rejected', async () => {
    const workspace = await createFabricProject()
    const { context, shell, approval } = await bootWithShell(workspace)
    approval.outcome = 'rejected'

    const result = await executeTool(context, ToolMcProject.RUN_MC_CHECK, workspace, {
      target: 'runtime',
      runtimeMode: 'client',
    })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ message: 'the user rejected tool "run_mc_check"' })
    expect(shell.commands).toEqual([])
    expect(approval.requests).toHaveLength(1)
  })

  it('refuses all checks when datagen clues have no known loader', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-unknown-all-'))
    await write('build.gradle', 'tasks.register("runDatagen") {}\n')
    const { context, shell } = await bootWithShell(dir)
    const result = await callRunCheck(context, dir, { target: 'all' })

    expect(result.failedStep).toBe('datagen')
    expect(result.commands).toEqual([])
    expect(shell.commands).toEqual([])
  })

  it('runs all standard checks without a datagen plan when no clue is present', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-mc-project-all-no-datagen-'))
    await write('build.gradle', 'plugins { id "fabric-loom" version "1.8" }\n')
    const { context, shell } = await bootWithShell(dir)
    const result = await callRunCheck(context, dir, { target: 'all' })

    expect(result.failedStep).toBeNull()
    expect(result.steps.map(step => step.step)).toEqual(['resources:static', 'resources:gradle', 'test', 'build'])
    expect(shell.commands).toEqual(['gradle processResources', 'gradle test', 'gradle build'])
  })

  it.each([
    ['subproject', 'include(":common")'],
    ['included build', 'includeBuild("build-logic")'],
  ])('refuses automatic root tasks for a Gradle %s layout', async (_layout, settings) => {
    const workspace = await createFabricProject()
    await write('settings.gradle', `${settings}\n`)
    const { context, shell } = await bootWithShell(workspace)

    const result = await callRunCheck(context, workspace, { target: 'build' })

    expect(result.commands).toEqual([])
    expect(result.failedStep).toBe('gradle-layout')
    expect(result.steps[0]).toMatchObject({
      step: 'gradle-layout',
      status: 'failed',
      exitCode: null,
    })
    expect(result.suggestedNextAction).toContain('qualified task')
    expect(shell.commands).toEqual([])
  })

  it('reports unreadable Gradle settings as an unavailable layout', async () => {
    const workspace = await createFabricProject()
    const { context, shell } = await bootWithShell(workspace)
    const readBytes = context.fs.readBytes.bind(context.fs)
    context.fs.readBytes = async (target, signal, maxBytes) => {
      if (target.displayPath.endsWith('settings.gradle')) throw new FsError('settings unavailable', 'FS_IO_ERROR')
      return readBytes(target, signal, maxBytes)
    }

    const result = await callRunCheck(context, workspace, { target: 'build' })

    expect(result.failedStep).toBe('gradle-layout')
    expect(result.steps[0]?.message).toContain('settings.gradle could not be inspected')
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

  it('reports signal, aborted, runner, and generic command failures', async () => {
    const workspace = await createFabricProject()
    const { context, shell } = await bootWithShell(workspace)
    const signalResult: ShellRunResult = {
      ...okResult('signal'),
      signal: 'SIGINT',
    }
    const abortedResult: ShellRunResult = {
      ...okResult('aborted'),
      aborted: true,
    }
    const runnerResult: ShellRunResult = {
      ...okResult('runner'),
      sandbox: { mode: 'read-only', denied: false, runnerFailed: true },
    }
    shell.results.set(expectedGradle('build'), signalResult)
    const signal = await callRunCheck(context, workspace, { target: 'build' })
    shell.results.set(expectedGradle('build'), abortedResult)
    const aborted = await callRunCheck(context, workspace, { target: 'build' })
    shell.results.set(expectedGradle('build'), runnerResult)
    const runner = await callRunCheck(context, workspace, { target: 'build' })

    expect(signal.failedStep).toBe('build')
    expect(aborted.failedStep).toBe('build')
    expect(runner.failedStep).toBe('build')
    expect(runner.steps[0]?.sandbox).toEqual({ mode: 'read-only', denied: false, runnerFailed: true })
  })

  it('preserves already-truncated and spill-free command summaries', async () => {
    const workspace = await createFabricProject()
    const { context, shell } = await bootWithShell(workspace, { maxOutputSummaryBytes: 100 })
    shell.results.set(expectedGradle('build'), {
      ...okResult('short'),
      stdout: { text: 'short', truncated: true },
    })
    const result = await callRunCheck(context, workspace, { target: 'build' })

    expect(result.steps[0]?.stdout).toEqual({ text: 'short', truncated: true })
  })

  it('runs with the filesystem cwd when the check execution omits a session header', async () => {
    const workspace = await createFabricProject()
    const { context, shell } = await bootWithShell(workspace)
    const result = await executeTool(context, ToolMcProject.RUN_MC_CHECK, undefined, { target: 'build' })

    expect(result.isError).toBe(false)
    expect(shell.commands).toEqual([expectedGradle('build')])
  })

  it('renders canonical tool values and exposes concurrency-safe metadata', async () => {
    const workspace = await createFabricProject()
    const context = await bootDirect(workspace)
    const detectedDefinition = context.tools.get(ToolMcProject.DETECT_MC_PROJECT)
    const validationDefinition = context.tools.get(ToolMcProject.VALIDATE_MC_RESOURCES)
    const detected = await callDetect(context, workspace)
    const validation = await callValidate(context, workspace)

    expect(detectedDefinition?.isConcurrencySafe?.({})).toBe(true)
    expect(validationDefinition?.isConcurrencySafe?.({})).toBe(true)
    expect(detectedDefinition?.output.render({}, detected as never)).toEqual([
      { type: 'text', text: JSON.stringify(detected, null, 2) },
    ])
    expect(validationDefinition?.output.render({}, validation as never)).toEqual([
      { type: 'text', text: JSON.stringify(validation, null, 2) },
    ])

    const shellHarness = await bootWithShell(workspace)
    const checkDefinition = shellHarness.context.tools.get(ToolMcProject.RUN_MC_CHECK)
    const check = await callRunCheck(shellHarness.context, workspace, { target: 'build' })
    const checkContent = [{ type: 'text' as const, text: JSON.stringify(check, null, 2) }]
    expect(checkDefinition?.presentCall?.({ target: 'build' })).toEqual({ card: 'generic', title: 'Run Minecraft check: build', kind: 'execute' })
    expect(checkDefinition?.presentResult?.({ target: 'build' }, { content: checkContent, isError: false })).toEqual({
      card: 'generic',
      title: 'Minecraft check result',
      content: checkContent,
    })
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

    shell.results.set(expectedGradle('test'), {
      ...okResult('0123456789abcdefghijklmnopqrstuvwxyz'),
      stdout: { text: '0123456789abcdefghijklmnopqrstuvwxyz', truncated: false },
    })
    const withoutSpill = await callRunCheck(context, workspace, { target: 'test' })
    expect(withoutSpill.steps[0]?.stdout).toEqual({ text: 'qrstuvwxyz', truncated: true })
  })
})
