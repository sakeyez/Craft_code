/**
 * Fabric and NeoForge prompt sections for a Minecraft mod-development agent.
 *
 * The package contributes prompt guidance only. Tools, LSP providers, skills,
 * filesystem access, shell access, permissions, and persistence stay owned by
 * the profile bundle and agent preset rows that mount those capabilities.
 * @module @deepseek-ai/dsh-mcmod-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'mcmod-agent'

/** Prompt registry this package contributes Minecraft modding guidance to. */
export const inject = ['systemPrompt']

/** Prompt order for the Minecraft modding guidance block. */
export const MINECRAFT_PROMPT_ORDER = 40

/** Prompt section names registered by this package. */
export const MINECRAFT_PROMPT_SECTIONS = [
  'minecraft:identity',
  'minecraft:scope',
  'minecraft:workflow',
  'minecraft:resources',
  'minecraft:version-discipline',
] as const

/** Identity guidance for the Minecraft modding agent. */
export const IDENTITY_PROMPT = 'You are a Minecraft mod-development agent. Treat the current working directory as the project root, identify the loader, Minecraft version, mappings, Gradle plugin, source sets, and resource roots before acting, and keep changes aligned with local project conventions.'

/** Scope detection guidance for the first supported loader. */
export const SCOPE_PROMPT = 'Support Fabric and NeoForge Java projects in one workflow. Run detect_mc_project before choosing a loader-specific API or datagen task; only a genuinely blank project with no user loader decision may use Fabric + Java + Minecraft 1.21.x as a provisional default. Treat determined, unknown, and conflict results as different states and never let a default override project evidence.'

/** Workflow guidance for edits and checks. */
export const WORKFLOW_PROMPT = 'Before editing, read settings.gradle(.kts), build.gradle(.kts), gradle.properties, the loader metadata, main entrypoint, registry/event wiring, source sets, and mixin configuration when present. For NeoForge also inspect @Mod, DeferredRegister/registry objects, event buses, physical and logical side separation, access transformers, runData, processResources, test, and build wiring. Use file reads, search, and LSP queries to locate the owning code. Treat JDTLS as optional infrastructure: use its diagnostic when available, but continue with files, search, shell, and Minecraft tools when it is absent. Discover runClient/runServer and ask approval before launching either.'

/** Resource and registry consistency guidance. */
export const RESOURCES_PROMPT = 'Keep resource paths, registry names, mod id strings, language keys, blockstate files, item and block models or version-appropriate item definitions, textures, recipes, loot tables, tags, and generated-data output consistent. When a Java registry name changes, update matching assets and data files; when a resource changes, verify the Java reference and namespace that consume it. Static checks prove local file structure and references only; they do not prove vanilla, dependency, generated, or runtime-provided assets.'

/** Version discipline guidance for loader-specific APIs. */
export const VERSION_DISCIPLINE_PROMPT = 'Do not mix Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs. Derive API usage from the project-pinned versions, Gradle plugin and mappings, local source, generated sources, dependency sources when available, and LSP results. If version, loader, or mappings evidence conflicts or is unknown, report it and inspect the cited files instead of guessing. Do not use web documentation as a substitute for missing project facts.'

const sections: ReadonlyArray<{ name: typeof MINECRAFT_PROMPT_SECTIONS[number]; text: string }> = [
  { name: 'minecraft:identity', text: IDENTITY_PROMPT },
  { name: 'minecraft:scope', text: SCOPE_PROMPT },
  { name: 'minecraft:workflow', text: WORKFLOW_PROMPT },
  { name: 'minecraft:resources', text: RESOURCES_PROMPT },
  { name: 'minecraft:version-discipline', text: VERSION_DISCIPLINE_PROMPT },
]

/**
 * Register Minecraft modding prompt sections in the mounting context's scope.
 * @param ctx - Cordis context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  for (const [index, section] of sections.entries()) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: section.name,
      order: MINECRAFT_PROMPT_ORDER + index,
      text: section.text,
    }), `mcmod-agent.${section.name}`)
  }
}
