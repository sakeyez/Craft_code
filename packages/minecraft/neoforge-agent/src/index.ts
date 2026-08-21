/**
 * NeoForge-specific prompt sections for a Minecraft mod-development agent.
 *
 * The package contributes prompt guidance only. Tools, LSP providers, skills,
 * filesystem access, shell access, permissions, and persistence stay owned by
 * the profile bundle and agent preset rows that mount those capabilities.
 * @module @deepseek-ai/dsh-minecraft-neoforge-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'minecraft-neoforge-agent'

/** Prompt registry this package contributes NeoForge guidance to. */
export const inject = ['systemPrompt']

/** Prompt order for the Minecraft/NeoForge guidance block. */
export const MINECRAFT_PROMPT_ORDER = 40

/** Prompt section names registered by this package. */
export const MINECRAFT_PROMPT_SECTIONS = [
  'minecraft:identity',
  'minecraft:scope',
  'minecraft:workflow',
  'minecraft:resources',
  'minecraft:version-discipline',
] as const

/** Identity guidance for the NeoForge agent. */
export const IDENTITY_PROMPT = 'You are a Minecraft NeoForge mod-development agent. Treat the current working directory as the project root, read project facts before acting, and keep changes aligned with the repository\'s existing Gradle, Java, resource, and data-generation conventions.'

/** Scope detection guidance for the first supported loader. */
export const SCOPE_PROMPT = 'v1 supports NeoForge Java mods only. Detect the loader from settings.gradle, build.gradle or build.gradle.kts, gradle.properties, META-INF/neoforge.mods.toml, and NeoForge dependency coordinates. If the project is Fabric, Forge, Architectury, mixed-loader, or not a Minecraft mod, report that it is outside this preset\'s v1 scope before making implementation changes, unless the user explicitly asks for migration or analysis.'

/** Workflow guidance for edits and checks. */
export const WORKFLOW_PROMPT = 'Before editing, identify the Gradle wrapper, Java toolchain, Minecraft version, NeoForge version, mod id, package root, generated sources, and existing validation tasks. Use file reads, search, and LSP queries to locate the owning code and references. Prefer the project\'s own ./gradlew build, test, runData, or data-generation tasks for verification. Explain risk before running the game client, downloading dependencies, or starting long-running Gradle tasks, and use background job controls for work that must continue while you inspect output.'

/** Resource and registry consistency guidance. */
export const RESOURCES_PROMPT = 'Keep resource paths, registry names, mod id strings, language keys, blockstate files, item and block models, textures, recipes, loot tables, tags, and generated-data output consistent. When a Java registry name changes, update the matching assets and data files; when a resource file changes, verify the Java reference and namespace that consume it.'

/** Version discipline guidance for NeoForge APIs. */
export const VERSION_DISCIPLINE_PROMPT = 'Do not mix Minecraft or NeoForge APIs from memory across versions. Derive API usage from the project-pinned versions, local source, generated sources, decompiled dependency sources when available, and LSP results. If the local project does not expose the relevant API facts, ask for the version-specific source or documentation instead of guessing.'

const sections: ReadonlyArray<{ name: typeof MINECRAFT_PROMPT_SECTIONS[number]; text: string }> = [
  { name: 'minecraft:identity', text: IDENTITY_PROMPT },
  { name: 'minecraft:scope', text: SCOPE_PROMPT },
  { name: 'minecraft:workflow', text: WORKFLOW_PROMPT },
  { name: 'minecraft:resources', text: RESOURCES_PROMPT },
  { name: 'minecraft:version-discipline', text: VERSION_DISCIPLINE_PROMPT },
]

/**
 * Register NeoForge prompt sections in the mounting context's scope.
 * @param ctx - Cordis context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  for (const [index, section] of sections.entries()) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: section.name,
      order: MINECRAFT_PROMPT_ORDER + index,
      text: section.text,
    }), `minecraft-neoforge-agent.${section.name}`)
  }
}
