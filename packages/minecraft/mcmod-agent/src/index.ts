/**
 * Fabric-first prompt sections for a Minecraft mod-development agent.
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
export const SCOPE_PROMPT = 'v1 is Fabric + Java + Minecraft 1.21.x by default when the project has not already made a loader or version decision. Detect existing loader facts from settings.gradle(.kts), build.gradle(.kts), gradle.properties, fabric.mod.json or corresponding mod metadata, mixin config, and dependency coordinates before choosing APIs.'

/** Workflow guidance for edits and checks. */
export const WORKFLOW_PROMPT = 'Before editing, read build.gradle(.kts), settings.gradle(.kts), fabric.mod.json or corresponding metadata, the main mod class, and mixin configuration when present. Use file reads, search, and LSP queries to locate the owning code and references. Prefer the smallest project validation that proves the change, such as ./gradlew build, test, runDatagen, or the project\'s focused data-generation task.'

/** Resource and registry consistency guidance. */
export const RESOURCES_PROMPT = 'Keep resource paths, registry names, mod id strings, language keys, blockstate files, item and block models, textures, recipes, loot tables, tags, and generated-data output consistent. When a Java registry name changes, update the matching assets and data files; when a resource file changes, verify the Java reference and namespace that consume it.'

/** Version discipline guidance for loader-specific APIs. */
export const VERSION_DISCIPLINE_PROMPT = 'Do not mix Fabric, Forge, NeoForge, Architectury, or cross-version Minecraft APIs. Derive API usage from the project-pinned versions, local source, generated sources, decompiled dependency sources when available, and LSP results. If the local project does not expose the relevant API facts, ask for the version-specific source or documentation instead of guessing.'

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
