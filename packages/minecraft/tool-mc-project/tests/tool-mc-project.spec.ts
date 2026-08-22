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
