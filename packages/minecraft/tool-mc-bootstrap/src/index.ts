/** Deterministic, safety-bounded starter projects for supported Minecraft loaders. */

import { isAbsolute, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell'

export const name = 'tool-mc-bootstrap'
export const inject = ['tools', 'fs', 'shell']
/** Model-facing bootstrap tool name. */
export const BOOTSTRAP_MC_PROJECT = 'bootstrap_mc_project'
/** Pinned versions used by the deterministic starter templates. */
export const templates = {
  fabric: { minecraftVersion: '1.21.1', loaderVersion: '0.16.5', jdk: 21 },
  neoforge: { minecraftVersion: '1.21.1', loaderVersion: '21.1.77', jdk: 21 },
} as const
type Loader = keyof typeof templates
type Args = {
  loader: Loader
  minecraftVersion: string
  modName: string
  modId: string
  packageName: string
  targetDirectory?: string
  enableDatagen?: boolean
}

const params = {
  loader: { type: 'string', required: true, enum: ['fabric', 'neoforge'] },
  minecraftVersion: { type: 'string', required: true },
  modName: { type: 'string', required: true },
  modId: { type: 'string', required: true },
  packageName: { type: 'string', required: true },
  targetDirectory: { type: 'string' },
  enableDatagen: { type: 'boolean' },
} as const
const output = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    projectPath: { type: 'string', required: true },
    loader: { type: 'string', required: true },
    versions: { type: 'object', required: true, additionalProperties: false, properties: {
      minecraftVersion: { type: 'string', required: true }, loaderVersion: { type: 'string', required: true }, jdk: { type: 'number', required: true },
    } },
    phases: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', required: true }, status: { type: 'string', required: true }, message: { type: 'string', required: true },
    } } },
    generatedFiles: { type: 'array', required: true, items: { type: 'string' } },
    buildEvidence: { type: 'string', required: true },
    suggestedNextAction: { type: 'string', required: true },
  },
} as const

function validId(value: string): boolean {
  return /^[a-z][a-z0-9_-]{1,63}$/u.test(value)
}

function validPackage(value: string): boolean {
  return /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+$/u.test(value)
}

function validModName(value: string): boolean {
  return value.trim().length > 0 && value.length <= 128
}

function tomlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '\\r').replaceAll('\n', '\\n')
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'FS_NOT_FOUND' || errorCode(error) === 'ENOENT'
}

async function isEmpty(ctx: Context, target: FsTarget, signal: AbortSignal | undefined): Promise<boolean> {
  try {
    const info = await ctx.fs.stat(target, signal)
    if (info === undefined) return true
    if (info.type !== 'directory') return false
    return (await ctx.fs.listDir(target, signal)).length === 0
  } catch (error) {
    if (isMissing(error)) return true
    throw error
  }
}

function javaVersion(shell: Context['shell'], exec: ToolExecution, projectPath: string): Promise<string> {
  return shell.run(shell.resolve({ command: 'java -version', workdir: projectPath, signal: exec.signal }))
    .then((result: ShellRunResult) => `${result.exitCode === 0 ? 'available' : 'missing'}${result.stderr.text ? `: ${result.stderr.text.slice(0, 160)}` : ''}`)
}

function metadata(args: Args, version: typeof templates[Loader]): string {
  if (args.loader === 'fabric') {
    return `${JSON.stringify({
      schemaVersion: 1,
      id: args.modId,
      version: '1.0.0',
      name: args.modName,
      environment: '*',
      entrypoints: {
        main: [`${args.packageName}.Mod`],
        ...(args.enableDatagen ? { 'fabric-datagen': [`${args.packageName}.FabricData`] } : {}),
      },
      depends: { fabricloader: `>=${version.loaderVersion}`, minecraft: version.minecraftVersion, 'fabric-api': '*' },
    }, null, 2)}\n`
  }
  return [
    'modLoader="javafml"',
    'loaderVersion="[4,)"',
    'license="MIT"',
    '[[mods]]',
    `modId="${args.modId}"`,
    'version="1.0.0"',
    `displayName="${tomlString(args.modName)}"`,
    '',
  ].join('\n')
}

function filesFor(args: Args, version: typeof templates[Loader]): Record<string, string> {
  const pkg = args.packageName.replaceAll('.', '/')
  const files: Record<string, string> = {
    'settings.gradle': `pluginManagement { repositories { maven { url = "https://maven.fabricmc.net/" }; gradlePluginPortal(); mavenCentral() } }\nrootProject.name = "${args.modId}"\n`,
    'gradle.properties': `minecraft_version=${version.minecraftVersion}\nmod_id=${args.modId}\nmod_name=${args.modName}\n`,
    'README.md': `# ${args.modName}\n\nGenerated by CraftCode. Run \`detect_mc_project\`, then \`validate_mc_resources\` and \`run_mc_check\`.\n`,
    'build.gradle': args.loader === 'fabric'
      ? [
        'plugins { id "fabric-loom" version "1.8.12" }',
        'repositories { maven { url = "https://maven.fabricmc.net/" } }',
        'dependencies {',
        `  minecraft "com.mojang:minecraft:${version.minecraftVersion}"`,
        `  mappings "net.fabricmc:yarn:${version.minecraftVersion}+build.3:v2"`,
        `  modImplementation "net.fabricmc:fabric-loader:${version.loaderVersion}"`,
        `  modImplementation "net.fabricmc.fabric-api:fabric-api:0.102.0+${version.minecraftVersion}"`,
        '}',
        ...(args.enableDatagen ? ['fabricApi { configureDataGeneration() }'] : []),
        'java { withSourcesJar() }',
        '',
      ].join('\n')
      : [
        'plugins { id "java-library"; id "net.neoforged.moddev" version "2.0.107" }',
        'neoForge {',
        `  version = "${version.loaderVersion}"`,
        ...(args.enableDatagen ? ['  runs { data { data() } }'] : []),
        '}',
        '',
      ].join('\n'),
    [`src/main/resources/${args.loader === 'fabric' ? 'fabric.mod.json' : 'META-INF/neoforge.mods.toml'}`]: metadata(args, version),
    [`src/main/java/${pkg}/Mod.java`]: args.loader === 'fabric'
      ? [`package ${args.packageName};`, '', 'import net.fabricmc.api.ModInitializer;', '', 'public final class Mod implements ModInitializer {', '  @Override', '  public void onInitialize() {', '  }', '}', ''].join('\n')
      : [`package ${args.packageName};`, '', 'import net.neoforged.bus.api.IEventBus;', 'import net.neoforged.fml.common.Mod;', '', `@Mod("${args.modId}")`, 'public final class Mod {', '  public Mod(IEventBus modEventBus) {', '  }', '}', ''].join('\n'),
  }
  if (args.enableDatagen && args.loader === 'fabric') {
    files[`src/main/java/${pkg}/FabricData.java`] = [`package ${args.packageName};`, '', 'import net.fabricmc.fabric.api.datagen.v1.DataGeneratorEntrypoint;', 'import net.fabricmc.fabric.api.datagen.v1.FabricDataGenerator;', '', 'public final class FabricData implements DataGeneratorEntrypoint {', '  @Override', '  public void onInitializeDataGenerator(FabricDataGenerator generator) {', '  }', '}', ''].join('\n')
  }
  return files
}

export function apply(ctx: Context): void {
  ctx.inject(['shell', 'fs'], (services: Context) => {
    services.tools.register(defineTool({
      name: BOOTSTRAP_MC_PROJECT,
      description: 'Create a complete minimal Fabric or NeoForge Minecraft Java mod project from a pinned template. Writes only inside the session workspace, refuses non-empty targets and unsupported versions, and reports Java readiness; it does not claim gameplay or a Gradle build until run_mc_check executes one.',
      parameters: params,
      output: { schema: output, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
      isConcurrencySafe: () => false,
      execute: async (args: Args, exec: ToolExecution) => {
        if (!(args.loader in templates)) return { status: 'unsupported', projectPath: '', loader: args.loader, versions: { minecraftVersion: args.minecraftVersion, loaderVersion: '', jdk: 0 }, phases: [{ name: 'validate', status: 'failed', message: 'Loader is not supported' }], generatedFiles: [], buildEvidence: '', suggestedNextAction: 'Choose Fabric or NeoForge.' }
        const version = templates[args.loader]
        const failed = (status: string, projectPath = '', message: string) => ({ status, projectPath, loader: args.loader, versions: version, phases: [{ name: 'validate', status: 'failed', message }], generatedFiles: [], buildEvidence: '', suggestedNextAction: 'Use a supported version, valid identifiers, and an empty workspace directory.' })
        if (args.minecraftVersion !== version.minecraftVersion || !validId(args.modId) || !validPackage(args.packageName) || !validModName(args.modName)) return failed('unsupported', '', 'Unsupported version or invalid mod id/package name')
        const cwd = exec.agent?.session.header.cwd
        if (cwd === undefined) return failed('failed', '', 'Session workspace is unavailable')
        if (args.targetDirectory !== undefined && isAbsolute(args.targetDirectory)) return failed('unsupported', '', 'targetDirectory must be relative to the session workspace')
        const workspace = await services.fs.resolve('.', { cwd, signal: exec.signal })
        const target = await services.fs.resolve(args.targetDirectory ?? args.modId, { cwd, signal: exec.signal })
        if (!services.fs.contains(workspace, target)) return failed('unsupported', services.fs.processPath(target), 'targetDirectory escapes the session workspace')
        if (target.targetKey === workspace.targetKey) return failed('unsupported', services.fs.processPath(target), 'targetDirectory must name a child project directory')
        const projectPath = services.fs.processPath(target)
        if (!await isEmpty(services, target, exec.signal)) return { ...failed('conflict', projectPath, 'Target directory is not empty'), phases: [{ name: 'validate', status: 'failed', message: 'Target directory is not empty' }] }
        const generated = filesFor(args, version)
        const generatedFiles: string[] = []
        for (const [path, content] of Object.entries(generated)) {
          const destination = await services.fs.resolve(path, { cwd: projectPath, signal: exec.signal })
          if (!services.fs.contains(target, destination)) throw new Error(`Template path escaped project directory: ${path}`)
          const outcome = await services.fs.writeText(destination, content, { kind: 'createIfAbsent' }, exec.signal)
          services.emit('fs/observed', destination, { kind: 'present', version: outcome.version }, exec)
          generatedFiles.push(relative(projectPath, services.fs.processPath(destination)).replaceAll('\\', '/'))
        }
        const phases = [{ name: 'validate', status: 'passed', message: 'Arguments and workspace validated' }, { name: 'generate', status: 'passed', message: `Generated ${generatedFiles.length} files` }]
        const java = await javaVersion(services.shell, exec, projectPath)
        phases.push({ name: 'prepare', status: java.startsWith('available') ? 'passed' : 'failed', message: java })
        return { status: java.startsWith('available') ? 'created' : 'failed', projectPath, loader: args.loader, versions: version, phases, generatedFiles, buildEvidence: 'No Gradle build was run by bootstrap; run detect_mc_project, validate_mc_resources, then run_mc_check(build) for executable evidence.', suggestedNextAction: java.startsWith('available') ? 'Run detect_mc_project, validate_mc_resources, then run_mc_check(build).' : 'Load minecraft-environment-doctor.' }
      },
      presentCall: () => ({ card: 'generic', title: 'Bootstrap Minecraft project', kind: 'execute' }),
      presentResult: (_args, result) => ({ card: 'generic', title: 'Minecraft project bootstrap result', content: result.content }),
    }))
  })
}
