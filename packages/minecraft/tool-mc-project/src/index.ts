/**
 * Model-facing Minecraft project detector. The tool reads Gradle files,
 * mod metadata, source roots, and resource roots through `ctx.fs` and returns
 * structured evidence instead of asking the model to infer project facts from
 * prompt guidance alone.
 * @module @deepseek-ai/dsh-tool-mc-project
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parse as parseToml } from 'smol-toml'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'

/** Cordis plugin name. */
export const name = 'tool-mc-project'
/** Services required by the detector. */
export const inject = ['tools', 'fs']

/** Model-facing tool name. */
export const DETECT_MC_PROJECT = 'detect_mc_project'
/** Model-facing Minecraft resource validator tool name. */
export const VALIDATE_MC_RESOURCES = 'validate_mc_resources'

const DEFAULT_MAX_ENTRIES = 2_000
const DEFAULT_MAX_FILE_BYTES = 512 * 1024

/** Tool configuration. */
export interface Config {
  /**
   * Maximum directory entries walked while discovering source/resource and
   * metadata clues. When the limit is reached, the result carries a warning and
   * returns the facts already found.
   */
  maxEntries?: number
  /**
   * Maximum bytes read from one candidate text file. Larger files are skipped
   * with a warning instead of being partially parsed.
   */
  maxFileBytes?: number
}

/** Schemastery configuration for the detector. */
export const Config: z<Config> = z.object({
  maxEntries: z.number().default(DEFAULT_MAX_ENTRIES),
  maxFileBytes: z.number().default(DEFAULT_MAX_FILE_BYTES),
})

type Loader = 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'unknown'
type Confidence = 'high' | 'medium' | 'low'

interface ResolvedConfig {
  maxEntries: number
  maxFileBytes: number
}

interface MappingsInfo {
  type: string
  version: string | null
  evidence: string[]
}

interface ModIdCandidate {
  id: string
  source: string
  confidence: Confidence
}

interface SourceSetInfo {
  name: string
  java: string[]
  kotlin: string[]
  resources: string[]
}

interface MixinConfig {
  path: string
  source: string
}

interface DatagenClue {
  kind: string
  source: string
  detail: string
}

interface DetectionResult {
  workspace: string
  loader: Loader
  minecraftVersion: string | null
  mappings: MappingsInfo
  modIdCandidates: ModIdCandidate[]
  languages: { java: boolean; kotlin: boolean }
  mainSourceSets: SourceSetInfo[]
  resourceRoots: string[]
  mixinConfigs: MixinConfig[]
  datagenClues: DatagenClue[]
  recommendedValidationCommands: string[]
  inspected: {
    gradleFiles: string[]
    metadataFiles: string[]
    sourceRoots: string[]
    resourceRoots: string[]
  }
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

interface TextFile {
  path: string
  text: string
}

interface WalkState {
  entries: number
  warned: boolean
}

interface DetectionState {
  warnings: string[]
  loaderEvidence: Map<Exclude<Loader, 'unknown'>, string[]>
  minecraftVersions: { value: string; source: string }[]
  mappings: MappingsInfo[]
  modIds: ModIdCandidate[]
  mixins: MixinConfig[]
  datagen: DatagenClue[]
}

const ROOT_GRADLE_FILES = [
  'settings.gradle',
  'settings.gradle.kts',
  'build.gradle',
  'build.gradle.kts',
  'gradle.properties',
  'gradle/libs.versions.toml',
] as const

const METADATA_BASENAMES = new Set([
  'fabric.mod.json',
  'quilt.mod.json',
  'mods.toml',
  'neoforge.mods.toml',
])

const LOADER_PATTERNS: ReadonlyArray<{ loader: Exclude<Loader, 'unknown'>; regex: RegExp; label: string }> = [
  { loader: 'fabric', regex: /\b(?:fabric-loom|net\.fabricmc\.fabric-loom|net\.fabricmc:fabric-loader|net\.fabricmc\.fabric-api)\b/u, label: 'Fabric Gradle/dependency clue' },
  { loader: 'quilt', regex: /\b(?:org\.quiltmc\.loom|org\.quiltmc:quilt-loader|org\.quiltmc\.quilted-fabric-api)\b/u, label: 'Quilt Gradle/dependency clue' },
  { loader: 'forge', regex: /\b(?:net\.minecraftforge\.gradle|net\.minecraftforge:forge|MinecraftForge)\b/u, label: 'Forge Gradle/dependency clue' },
  { loader: 'neoforge', regex: /\b(?:net\.neoforged\.gradle|net\.neoforged\.moddev|net\.neoforged:neoforge|NeoForge)\b/u, label: 'NeoForge Gradle/dependency clue' },
]

const BUILTIN_RESOURCE_NAMESPACES = new Set(['minecraft', 'c', 'forge', 'neoforge', 'fabric', 'quilt'])
const RESOURCE_LOCATION_PATTERN = /^([a-z0-9_.-]+:)?[a-z0-9/._-]+$/u
const RESOURCE_LOCATION_SCAN_PATTERN = /#?([a-z0-9_.-]+):([a-z0-9/._-]+)/gu

function resolveConfig(config: Config | undefined): ResolvedConfig {
  const maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxFileBytes = config?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  if (!Number.isFinite(maxEntries) || !Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('tool-mc-project config maxEntries must be a positive integer')
  }
  if (!Number.isFinite(maxFileBytes) || !Number.isInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new Error('tool-mc-project config maxFileBytes must be a positive integer')
  }
  return { maxEntries, maxFileBytes }
}

function sessionResolveOptions(exec: ToolExecution): { cwd?: string; signal?: AbortSignal } {
  const cwd = exec.agent?.session.header.cwd
  return {
    ...cwd === undefined ? {} : { cwd },
    signal: exec.signal,
  }
}

function relJoin(base: string, name: string): string {
  return base === '' ? name : `${base}/${name}`
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? path : path.slice(index + 1)
}

function uniq<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const k = key(item)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value)
}

async function optionalStat(ctx: Context, exec: ToolExecution, path: string): Promise<{ target: FsTarget; type: FsDirEntry['type']; size?: number } | undefined> {
  try {
    const target = await ctx.fs.resolve(path, sessionResolveOptions(exec))
    const info = await ctx.fs.stat(target, exec.signal)
    if (info === undefined) return undefined
    return { target, type: info.type, ...info.size === undefined ? {} : { size: info.size } }
  } catch {
    return undefined
  }
}

async function readTextFile(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  target: FsTarget,
  size: number | undefined,
  config: ResolvedConfig,
  warnings: string[],
): Promise<TextFile | undefined> {
  if (size !== undefined && size > config.maxFileBytes) {
    warnings.push(`${path}: skipped because file size ${size} exceeds maxFileBytes ${config.maxFileBytes}`)
    return undefined
  }
  try {
    return { path, text: await ctx.fs.readText(target, exec.signal) }
  } catch (error) {
    warnings.push(`${path}: could not read text (${error instanceof Error ? error.message : String(error)})`)
    return undefined
  }
}

async function readOptionalText(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  config: ResolvedConfig,
  warnings: string[],
): Promise<TextFile | undefined> {
  const stat = await optionalStat(ctx, exec, path)
  if (stat === undefined || stat.type !== 'file') return undefined
  return readTextFile(ctx, exec, path, stat.target, stat.size, config, warnings)
}

async function listOptionalDir(ctx: Context, exec: ToolExecution, path: string, warnings: string[]): Promise<FsDirEntry[]> {
  const stat = await optionalStat(ctx, exec, path)
  if (stat === undefined || stat.type !== 'directory') return []
  try {
    return await ctx.fs.listDir(stat.target, exec.signal)
  } catch (error) {
    warnings.push(`${path}: could not list directory (${error instanceof Error ? error.message : String(error)})`)
    return []
  }
}

async function walkFiles(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  state: WalkState,
  config: ResolvedConfig,
  warnings: string[],
  predicate: (path: string, entry: FsDirEntry) => boolean,
): Promise<Array<{ path: string; entry: FsDirEntry }>> {
  if (state.entries >= config.maxEntries) {
    if (!state.warned) {
      state.warned = true
      warnings.push(`directory scan stopped after maxEntries ${config.maxEntries}`)
    }
    return []
  }
  const entries = await listOptionalDir(ctx, exec, path, warnings)
  const out: Array<{ path: string; entry: FsDirEntry }> = []
  for (const entry of entries) {
    state.entries++
    const child = relJoin(path, entry.name)
    if (entry.type === 'file' && predicate(child, entry)) out.push({ path: child, entry })
    if (entry.type === 'directory') {
      out.push(...await walkFiles(ctx, exec, child, state, config, warnings, predicate))
    }
    if (state.entries >= config.maxEntries) break
  }
  return out
}

function addLoader(state: DetectionState, loader: Exclude<Loader, 'unknown'>, evidence: string): void {
  const list = state.loaderEvidence.get(loader) ?? []
  pushUnique(list, evidence)
  state.loaderEvidence.set(loader, list)
}

function addModId(state: DetectionState, id: unknown, source: string, confidence: Confidence): void {
  if (typeof id !== 'string') return
  const trimmed = id.trim()
  if (trimmed === '') return
  state.modIds.push({ id: trimmed, source, confidence })
}

function addMapping(state: DetectionState, type: string, version: string | null, evidence: string): void {
  const existing = state.mappings.find(mapping => mapping.type === type && mapping.version === version)
  if (existing !== undefined) {
    pushUnique(existing.evidence, evidence)
  } else {
    state.mappings.push({ type, version, evidence: [evidence] })
  }
}

function concreteVersion(value: string | undefined): string | undefined {
  if (value === undefined || /[$}{]/u.test(value)) return undefined
  return value
}

function isMixinFile(path: string): boolean {
  return /\.mixins?\.json$/u.test(path) || /mixins?.*\.json$/u.test(basename(path))
}

function stringAt(record: unknown, key: string): string | undefined {
  return typeof record === 'object' && record !== null && typeof (record as Record<string, unknown>)[key] === 'string'
    ? (record as Record<string, string>)[key]
    : undefined
}

function arrayAt(record: unknown, key: string): unknown[] | undefined {
  return typeof record === 'object' && record !== null && Array.isArray((record as Record<string, unknown>)[key])
    ? (record as Record<string, unknown[]>)[key]
    : undefined
}

function scanGradleText(state: DetectionState, file: TextFile): void {
  for (const pattern of LOADER_PATTERNS) {
    if (pattern.regex.test(file.text)) addLoader(state, pattern.loader, `${file.path}: ${pattern.label}`)
  }

  const minecraftPropertyPattern =
    /^\s*(?:minecraft[_-]?version|minecraft_version|minecraftVersion)\s*=\s*["']?([^"'\s#]+)["']?/gimu
  for (const match of file.text.matchAll(minecraftPropertyPattern)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) state.minecraftVersions.push({ value, source: `${file.path}: minecraft version property` })
  }
  const minecraftDeclarationPattern =
    /(?:com\.mojang:minecraft:|minecraft_version\s*=\s*["']|minecraftVersion\s*=\s*["'])([^"'\s)]+)/gimu
  for (const match of file.text.matchAll(minecraftDeclarationPattern)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) state.minecraftVersions.push({ value, source: `${file.path}: Minecraft dependency/version declaration` })
  }

  for (const match of file.text.matchAll(/^\s*(?:yarn_mappings|yarnMappings)\s*=\s*["']?([^"'\s#]+)["']?/gimu)) {
    addMapping(state, 'yarn', concreteVersion(match[1]) ?? null, `${file.path}: Yarn mappings property`)
  }
  for (const match of file.text.matchAll(/net\.fabricmc:yarn:([^"'\s)]+)/gimu)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) addMapping(state, 'yarn', value, `${file.path}: Yarn mappings dependency`)
  }
  if (/\bofficialMojangMappings\s*\(/u.test(file.text)) {
    addMapping(state, 'official', null, `${file.path}: officialMojangMappings()`)
  }
  for (const match of file.text.matchAll(/org\.parchmentmc\.data:parchment-[^:]+:([^"'\s)]+)/gimu)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) addMapping(state, 'parchment', value, `${file.path}: Parchment mappings dependency`)
  }

  for (const match of file.text.matchAll(/^\s*(?:mod[_-]?id|modId)\s*=\s*["']?([a-z0-9_.-]+)["']?/gimu)) {
    addModId(state, match[1], `${file.path}: mod id property`, 'medium')
  }
  for (const match of file.text.matchAll(/^\s*(?:archives[_-]?base[_-]?name|archivesName)\s*=\s*["']?([a-z0-9_.-]+)["']?/gimu)) {
    addModId(state, match[1], `${file.path}: archive name`, 'low')
  }

  if (/\b(?:runDatagen|runData|DataGeneratorEntrypoint|GatherDataEvent|datagen)\b/u.test(file.text)) {
    state.datagen.push({ kind: 'gradle', source: file.path, detail: 'Gradle text contains datagen task or API clues' })
  }
}

function scanVersionsToml(state: DetectionState, file: TextFile): void {
  let document: unknown
  try {
    document = parseToml(file.text, { integersAsBigInt: false })
  } catch (error) {
    state.warnings.push(`${file.path}: could not parse TOML (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  const versions = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>).versions
    : undefined
  if (typeof versions !== 'object' || versions === null) return
  for (const key of ['minecraft', 'minecraft_version', 'minecraftVersion']) {
    const value = (versions as Record<string, unknown>)[key]
    if (typeof value === 'string') state.minecraftVersions.push({ value, source: `${file.path}: versions.${key}` })
  }
  for (const [key, type] of [['yarn', 'yarn'], ['parchment', 'parchment'], ['mappings', 'unknown']] as const) {
    const value = (versions as Record<string, unknown>)[key]
    if (typeof value === 'string') addMapping(state, type, value, `${file.path}: versions.${key}`)
  }
}

function scanFabricMetadata(state: DetectionState, file: TextFile): void {
  let document: unknown
  try {
    document = JSON.parse(file.text) as unknown
  } catch (error) {
    state.warnings.push(`${file.path}: could not parse JSON (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  addLoader(state, 'fabric', `${file.path}: fabric.mod.json`)
  addModId(state, stringAt(document, 'id'), `${file.path}: id`, 'high')
  const mixins = arrayAt(document, 'mixins') ?? []
  for (const mixin of mixins) {
    if (typeof mixin === 'string') state.mixins.push({ path: mixin, source: `${file.path}: mixins` })
    else if (typeof mixin === 'object' && mixin !== null) {
      const config = stringAt(mixin, 'config')
      if (config !== undefined) state.mixins.push({ path: config, source: `${file.path}: mixins.config` })
    }
  }
  const entrypoints = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>).entrypoints
    : undefined
  const datagen = arrayAt(entrypoints, 'fabric-datagen')
  if (datagen !== undefined && datagen.length > 0) {
    state.datagen.push({ kind: 'fabric-datagen-entrypoint', source: file.path, detail: 'fabric.mod.json declares entrypoints.fabric-datagen' })
  }
  const depends = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>).depends
    : undefined
  const minecraft = stringAt(depends, 'minecraft')
  if (minecraft !== undefined) state.minecraftVersions.push({ value: minecraft, source: `${file.path}: depends.minecraft` })
}

function scanQuiltMetadata(state: DetectionState, file: TextFile): void {
  let document: unknown
  try {
    document = JSON.parse(file.text) as unknown
  } catch (error) {
    state.warnings.push(`${file.path}: could not parse JSON (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  addLoader(state, 'quilt', `${file.path}: quilt.mod.json`)
  const quiltLoader = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>).quilt_loader
    : undefined
  addModId(state, stringAt(quiltLoader, 'id'), `${file.path}: quilt_loader.id`, 'high')
  const mixins = arrayAt(quiltLoader, 'mixin') ?? arrayAt(quiltLoader, 'mixins') ?? []
  for (const mixin of mixins) {
    if (typeof mixin === 'string') state.mixins.push({ path: mixin, source: `${file.path}: quilt_loader mixins` })
  }
}

function scanTomlMetadata(state: DetectionState, file: TextFile): void {
  let document: unknown
  try {
    document = parseToml(file.text, { integersAsBigInt: false })
  } catch (error) {
    state.warnings.push(`${file.path}: could not parse TOML (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  const loader: Exclude<Loader, 'unknown'> = basename(file.path) === 'neoforge.mods.toml' ? 'neoforge' : 'forge'
  addLoader(state, loader, `${file.path}: ${basename(file.path)}`)
  const mods = arrayAt(document, 'mods') ?? []
  for (const mod of mods) addModId(state, stringAt(mod, 'modId'), `${file.path}: [[mods]].modId`, 'high')
}

function scanSourceText(state: DetectionState, file: TextFile): void {
  if (/\bDataGeneratorEntrypoint\b/u.test(file.text)) {
    state.datagen.push({ kind: 'fabric-datagen-source', source: file.path, detail: 'Source implements or references DataGeneratorEntrypoint' })
  }
  if (/\bGatherDataEvent\b/u.test(file.text)) {
    state.datagen.push({ kind: 'forge-datagen-source', source: file.path, detail: 'Source references GatherDataEvent' })
  }
}

function chooseLoader(state: DetectionState): Loader {
  const found = [...state.loaderEvidence.entries()].filter(([, evidence]) => evidence.length > 0)
  if (found.length === 0) return 'unknown'
  if (found.length === 1) return found[0]?.[0] ?? 'unknown'
  state.warnings.push(`conflicting loader evidence: ${found.map(([loader]) => loader).join(', ')}`)
  return 'unknown'
}

function chooseMinecraftVersion(state: DetectionState): string | null {
  const candidates = uniq(state.minecraftVersions, item => `${item.value}\0${item.source}`)
  if (candidates.length === 0) return null
  const first = candidates[0]
  if (first === undefined) return null
  const conflicts = new Set(candidates.map(candidate => candidate.value))
  if (conflicts.size > 1) {
    state.warnings.push(`multiple Minecraft version candidates: ${[...conflicts].join(', ')}`)
  }
  return first.value
}

function chooseMappings(state: DetectionState): MappingsInfo {
  const mappings = state.mappings
  if (mappings.length === 0) return { type: 'unknown', version: null, evidence: [] }
  const priority = ['yarn', 'parchment', 'official', 'unknown']
  mappings.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type))
  const first = mappings[0]
  if (first === undefined) return { type: 'unknown', version: null, evidence: [] }
  if (new Set(mappings.map(mapping => `${mapping.type}\0${mapping.version ?? ''}`)).size > 1) {
    state.warnings.push(`multiple mappings candidates: ${mappings.map(mapping => `${mapping.type}${mapping.version === null ? '' : ` ${mapping.version}`}`).join(', ')}`)
  }
  return first
}

function validationCommands(loader: Loader, hasGradle: boolean, hasWrapper: boolean, datagen: readonly DatagenClue[]): string[] {
  if (!hasGradle) return []
  const gradle = hasWrapper ? './gradlew' : 'gradle'
  const commands = [`${gradle} build`]
  if (datagen.length > 0) commands.push(`${gradle} runDatagen`)
  if (loader === 'forge' || loader === 'neoforge') commands.push(`${gradle} runData`)
  return uniq(commands, command => command)
}

function issueKey(issue: ResourceIssue): string {
  return `${issue.code}\0${issue.path}\0${issue.reference ?? ''}\0${issue.expectedPath ?? ''}\0${issue.message}`
}

function sortIssue(a: ResourceIssue, b: ResourceIssue): number {
  return a.path.localeCompare(b.path)
    || a.code.localeCompare(b.code)
    || (a.reference ?? '').localeCompare(b.reference ?? '')
    || (a.expectedPath ?? '').localeCompare(b.expectedPath ?? '')
}

function sortValidation(result: ResourceValidationResult): ResourceValidationResult {
  return {
    errors: uniq(result.errors, issueKey).sort(sortIssue),
    warnings: uniq(result.warnings, issueKey).sort(sortIssue),
    checkedFiles: [...new Set(result.checkedFiles)].sort(),
    detectedModId: result.detectedModId,
  }
}

function addResourceIssue(
  list: ResourceIssue[],
  code: string,
  path: string,
  message: string,
  reference: string | null = null,
  expectedPath: string | null = null,
): void {
  list.push({ code, path, message, reference, expectedPath })
}

function parseResourceLocation(reference: string, defaultNamespace: string): { namespace: string; path: string } | undefined {
  if (reference.startsWith('#') || !RESOURCE_LOCATION_PATTERN.test(reference)) return undefined
  const colon = reference.indexOf(':')
  if (colon >= 0) return { namespace: reference.slice(0, colon), path: reference.slice(colon + 1) }
  return { namespace: defaultNamespace, path: reference }
}

function shouldCheckLocalReference(namespace: string, currentNamespace: string, detectedModId: string | null): boolean {
  return namespace === currentNamespace || namespace === detectedModId
}

function texturePath(root: string, namespace: string, path: string): string {
  return relJoin(root, `assets/${namespace}/textures/${path}.png`)
}

function modelPath(root: string, namespace: string, path: string): string {
  return relJoin(root, `assets/${namespace}/models/${path}.json`)
}

function parseJsonForValidation(result: ResourceValidationResult, path: string, text: string): unknown | undefined {
  result.checkedFiles.push(path)
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    addResourceIssue(
      result.errors,
      'invalid_json',
      path,
      `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

async function readValidationText(
  ctx: Context,
  exec: ToolExecution,
  path: string,
  entry: FsDirEntry,
  config: ResolvedConfig,
  result: ResourceValidationResult,
): Promise<string | undefined> {
  if (entry.size !== undefined && entry.size > config.maxFileBytes) {
    addResourceIssue(
      result.warnings,
      'file_too_large',
      path,
      `Skipped because file size ${entry.size} exceeds maxFileBytes ${config.maxFileBytes}`,
    )
    return undefined
  }
  try {
    return await ctx.fs.readText(entry.target, exec.signal)
  } catch (error) {
    addResourceIssue(
      result.warnings,
      'read_failed',
      path,
      `Could not read text: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function collectObjectModels(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectModels(item, out)
    return
  }
  const record = objectRecord(value)
  if (record === undefined) return
  for (const [key, child] of Object.entries(record)) {
    if (key === 'model' && typeof child === 'string') out.push(child)
    collectObjectModels(child, out)
  }
}

function collectNamespaceReferences(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(RESOURCE_LOCATION_SCAN_PATTERN)) {
      const namespace = match[1]
      const path = match[2]
      if (namespace !== undefined && path !== undefined) out.add(`${namespace}:${path}`)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNamespaceReferences(item, out)
    return
  }
  const record = objectRecord(value)
  if (record === undefined) return
  for (const [key, child] of Object.entries(record)) {
    for (const match of key.matchAll(RESOURCE_LOCATION_SCAN_PATTERN)) {
      const namespace = match[1]
      const path = match[2]
      if (namespace !== undefined && path !== undefined) out.add(`${namespace}:${path}`)
    }
    collectNamespaceReferences(child, out)
  }
}

function detectedHighConfidenceModId(detected: DetectionResult, result: ResourceValidationResult): string | null {
  const candidates = [...new Set(detected.modIdCandidates
    .filter(candidate => candidate.confidence === 'high')
    .map(candidate => candidate.id))]
  if (candidates.length === 1) return candidates[0] ?? null
  if (candidates.length > 1) {
    addResourceIssue(
      result.warnings,
      'ambiguous_modid',
      '',
      `Multiple high-confidence mod ids were detected: ${candidates.join(', ')}`,
    )
  }
  return null
}

async function fallbackResourceRoots(ctx: Context, exec: ToolExecution, warnings: ResourceIssue[]): Promise<string[]> {
  const roots: string[] = []
  const srcEntries = await listOptionalDir(ctx, exec, 'src', [])
  for (const entry of srcEntries.filter(candidate => candidate.type === 'directory')) {
    const path = `src/${entry.name}/resources`
    if ((await optionalStat(ctx, exec, path))?.type === 'directory') pushUnique(roots, path)
  }
  if (roots.length > 0) return roots.sort()
  const hasTopLevelAssets = (await optionalStat(ctx, exec, 'assets'))?.type === 'directory'
  const hasTopLevelData = (await optionalStat(ctx, exec, 'data'))?.type === 'directory'
  if (hasTopLevelAssets || hasTopLevelData) return ['']
  addResourceIssue(warnings, 'no_resource_roots', '', 'No Minecraft resource roots were found')
  return []
}

async function localFileExists(ctx: Context, exec: ToolExecution, path: string): Promise<boolean> {
  return (await optionalStat(ctx, exec, path))?.type === 'file'
}

async function resourceNamespaces(ctx: Context, exec: ToolExecution, roots: readonly string[], kind: 'assets' | 'data'): Promise<string[]> {
  const namespaces: string[] = []
  for (const root of roots) {
    const entries = await listOptionalDir(ctx, exec, relJoin(root, kind), [])
    for (const entry of entries) {
      if (entry.type === 'directory') pushUnique(namespaces, entry.name)
    }
  }
  return namespaces.sort()
}

function namespaceAllowlist(detectedModId: string | null, namespaces: readonly string[]): Set<string> {
  const allowed = new Set(BUILTIN_RESOURCE_NAMESPACES)
  if (detectedModId !== null) allowed.add(detectedModId)
  for (const namespace of namespaces) allowed.add(namespace)
  return allowed
}

function projectOutputSchema() {
  const stringArray = { type: 'array', items: { type: 'string' } } as const
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      workspace: { type: 'string', required: true },
      loader: { type: 'string', required: true, enum: ['fabric', 'forge', 'neoforge', 'quilt', 'unknown'] },
      minecraftVersion: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      mappings: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          type: { type: 'string', required: true },
          version: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          evidence: { ...stringArray, required: true },
        },
      },
      modIdCandidates: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            source: { type: 'string', required: true },
            confidence: { type: 'string', required: true, enum: ['high', 'medium', 'low'] },
          },
        },
      },
      languages: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          java: { type: 'boolean', required: true },
          kotlin: { type: 'boolean', required: true },
        },
      },
      mainSourceSets: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            java: { ...stringArray, required: true },
            kotlin: { ...stringArray, required: true },
            resources: { ...stringArray, required: true },
          },
        },
      },
      resourceRoots: { ...stringArray, required: true },
      mixinConfigs: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            source: { type: 'string', required: true },
          },
        },
      },
      datagenClues: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true },
            source: { type: 'string', required: true },
            detail: { type: 'string', required: true },
          },
        },
      },
      recommendedValidationCommands: { ...stringArray, required: true },
      inspected: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          gradleFiles: { ...stringArray, required: true },
          metadataFiles: { ...stringArray, required: true },
          sourceRoots: { ...stringArray, required: true },
          resourceRoots: { ...stringArray, required: true },
        },
      },
      warnings: { ...stringArray, required: true },
    },
  } as const
}

function resourceValidationOutputSchema() {
  const issue = {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true },
      path: { type: 'string', required: true },
      message: { type: 'string', required: true },
      reference: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
      expectedPath: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    },
  } as const
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      errors: { type: 'array', required: true, items: issue },
      warnings: { type: 'array', required: true, items: issue },
      checkedFiles: { type: 'array', required: true, items: { type: 'string' } },
      detectedModId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    },
  } as const
}

async function detect(ctx: Context, exec: ToolExecution, config: ResolvedConfig): Promise<DetectionResult> {
  const warnings: string[] = []
  const root = await ctx.fs.resolve('.', sessionResolveOptions(exec))
  const rootInfo = await ctx.fs.stat(root, exec.signal)
  if (rootInfo?.type !== 'directory') warnings.push('workspace root is not a directory')

  const state: DetectionState = {
    warnings,
    loaderEvidence: new Map(),
    minecraftVersions: [],
    mappings: [],
    modIds: [],
    mixins: [],
    datagen: [],
  }

  const gradleFiles: TextFile[] = []
  for (const path of ROOT_GRADLE_FILES) {
    const file = await readOptionalText(ctx, exec, path, config, warnings)
    if (file !== undefined) gradleFiles.push(file)
  }
  for (const file of gradleFiles) {
    if (file.path === 'gradle/libs.versions.toml') scanVersionsToml(state, file)
    else scanGradleText(state, file)
  }

  const sourceSets: SourceSetInfo[] = []
  const sourceRoots: string[] = []
  const resourceRoots: string[] = []
  const srcEntries = await listOptionalDir(ctx, exec, 'src', warnings)
  for (const entry of srcEntries.filter(candidate => candidate.type === 'directory')) {
    const sourceSet = entry.name
    const java = (await optionalStat(ctx, exec, `src/${sourceSet}/java`))?.type === 'directory' ? [`src/${sourceSet}/java`] : []
    const kotlin = (await optionalStat(ctx, exec, `src/${sourceSet}/kotlin`))?.type === 'directory' ? [`src/${sourceSet}/kotlin`] : []
    const resources = (await optionalStat(ctx, exec, `src/${sourceSet}/resources`))?.type === 'directory' ? [`src/${sourceSet}/resources`] : []
    if (java.length + kotlin.length + resources.length === 0) continue
    sourceSets.push({ name: sourceSet, java, kotlin, resources })
    for (const path of java) pushUnique(sourceRoots, path)
    for (const path of kotlin) pushUnique(sourceRoots, path)
    for (const path of resources) pushUnique(resourceRoots, path)
  }

  const metadataFiles: TextFile[] = []
  const walkState: WalkState = { entries: 0, warned: false }
  for (const resourceRoot of resourceRoots) {
    const files = await walkFiles(ctx, exec, resourceRoot, walkState, config, warnings, path => METADATA_BASENAMES.has(basename(path)))
    for (const file of files) {
      const text = await readTextFile(ctx, exec, file.path, file.entry.target, file.entry.size, config, warnings)
      if (text !== undefined) metadataFiles.push(text)
    }
  }
  for (const file of metadataFiles) {
    switch (basename(file.path)) {
      case 'fabric.mod.json':
        scanFabricMetadata(state, file)
        break
      case 'quilt.mod.json':
        scanQuiltMetadata(state, file)
        break
      case 'mods.toml':
      case 'neoforge.mods.toml':
        scanTomlMetadata(state, file)
        break
    }
  }

  const mixinState: WalkState = { entries: 0, warned: false }
  for (const resourceRoot of resourceRoots) {
    const files = await walkFiles(ctx, exec, resourceRoot, mixinState, config, warnings, isMixinFile)
    for (const file of files) state.mixins.push({ path: file.path, source: 'resource file name' })
  }

  const sourceWalkState: WalkState = { entries: 0, warned: false }
  let hasJava = false
  let hasKotlin = false
  for (const sourceRoot of sourceRoots) {
    if (sourceRoot.endsWith('/java')) hasJava = true
    if (sourceRoot.endsWith('/kotlin')) hasKotlin = true
    const files = await walkFiles(ctx, exec, sourceRoot, sourceWalkState, config, warnings, path => /\.(?:java|kt)$/u.test(path))
    for (const file of files) {
      if (file.path.endsWith('.java')) hasJava = true
      if (file.path.endsWith('.kt')) hasKotlin = true
      const text = await readTextFile(ctx, exec, file.path, file.entry.target, file.entry.size, config, warnings)
      if (text !== undefined) scanSourceText(state, text)
    }
  }
  for (const file of gradleFiles) {
    if (/\b(?:org\.jetbrains\.kotlin\.jvm|kotlin\(["']jvm["']\))\b/u.test(file.text)) hasKotlin = true
  }

  const loader = chooseLoader(state)
  const minecraftVersion = chooseMinecraftVersion(state)
  const mappings = chooseMappings(state)
  const modIdCandidates = uniq(state.modIds, item => `${item.id}\0${item.source}\0${item.confidence}`)
  const mixinConfigs = uniq(state.mixins, item => `${item.path}\0${item.source}`)
  const datagenClues = uniq(state.datagen, item => `${item.kind}\0${item.source}\0${item.detail}`)
  const hasWrapper = (await optionalStat(ctx, exec, 'gradlew'))?.type === 'file' || (await optionalStat(ctx, exec, 'gradlew.bat'))?.type === 'file'

  if (gradleFiles.length === 0) warnings.push('no root Gradle files were found')
  if (metadataFiles.length === 0) warnings.push('no Minecraft mod metadata files were found under resource roots')
  if (resourceRoots.length === 0) warnings.push('no src/<sourceSet>/resources roots were found')
  if (loader === 'unknown' && state.loaderEvidence.size === 0) warnings.push('loader could not be identified from Gradle files or mod metadata')
  if (minecraftVersion === null) warnings.push('Minecraft version could not be identified')
  if (mappings.type === 'unknown' && mappings.evidence.length === 0) warnings.push('mappings could not be identified')

  return {
    workspace: root.displayPath,
    loader,
    minecraftVersion,
    mappings,
    modIdCandidates,
    languages: { java: hasJava, kotlin: hasKotlin },
    mainSourceSets: sourceSets.sort((a, b) => a.name.localeCompare(b.name)),
    resourceRoots: [...resourceRoots].sort(),
    mixinConfigs,
    datagenClues,
    recommendedValidationCommands: validationCommands(loader, gradleFiles.length > 0, hasWrapper, datagenClues),
    inspected: {
      gradleFiles: gradleFiles.map(file => file.path),
      metadataFiles: metadataFiles.map(file => file.path),
      sourceRoots: [...sourceRoots].sort(),
      resourceRoots: [...resourceRoots].sort(),
    },
    warnings,
  }
}

async function resourceFileExists(
  ctx: Context,
  exec: ToolExecution,
  roots: readonly string[],
  expected: (root: string) => string,
): Promise<boolean> {
  for (const root of roots) {
    if (await localFileExists(ctx, exec, expected(root))) return true
  }
  return false
}

async function readJsonResourceFiles(
  ctx: Context,
  exec: ToolExecution,
  base: string,
  config: ResolvedConfig,
  result: ResourceValidationResult,
): Promise<Array<{ path: string; document: unknown }>> {
  const scanWarnings: string[] = []
  const files = await walkFiles(
    ctx,
    exec,
    base,
    { entries: 0, warned: false },
    config,
    scanWarnings,
    path => path.endsWith('.json'),
  )
  for (const warning of scanWarnings) addResourceIssue(result.warnings, 'scan_warning', base, warning)
  const documents: Array<{ path: string; document: unknown }> = []
  for (const file of files) {
    const text = await readValidationText(ctx, exec, file.path, file.entry, config, result)
    if (text === undefined) continue
    const document = parseJsonForValidation(result, file.path, text)
    if (document !== undefined) documents.push({ path: file.path, document })
  }
  return documents
}

async function validateModelTextures(
  ctx: Context,
  exec: ToolExecution,
  roots: readonly string[],
  root: string,
  namespace: string,
  folder: 'item' | 'block',
  config: ResolvedConfig,
  detectedModId: string | null,
  result: ResourceValidationResult,
): Promise<void> {
  const documents = await readJsonResourceFiles(ctx, exec, relJoin(root, `assets/${namespace}/models/${folder}`), config, result)
  for (const file of documents) {
    const textures = objectRecord(file.document)?.textures
    const textureRecord = objectRecord(textures)
    if (textureRecord === undefined) continue
    for (const texture of Object.values(textureRecord)) {
      if (typeof texture !== 'string' || texture.startsWith('#')) continue
      const parsed = parseResourceLocation(texture, namespace)
      if (parsed === undefined) continue
      if (!shouldCheckLocalReference(parsed.namespace, namespace, detectedModId)) continue
      const expectedPath = texturePath(root, parsed.namespace, parsed.path)
      if (!await resourceFileExists(ctx, exec, roots, candidateRoot => texturePath(candidateRoot, parsed.namespace, parsed.path))) {
        addResourceIssue(
          result.errors,
          'missing_texture',
          file.path,
          `Model references missing texture ${texture}`,
          texture,
          expectedPath,
        )
      }
    }
  }
}

async function validateBlockstateModels(
  ctx: Context,
  exec: ToolExecution,
  roots: readonly string[],
  root: string,
  namespace: string,
  config: ResolvedConfig,
  detectedModId: string | null,
  result: ResourceValidationResult,
): Promise<void> {
  const documents = await readJsonResourceFiles(ctx, exec, relJoin(root, `assets/${namespace}/blockstates`), config, result)
  for (const file of documents) {
    const models: string[] = []
    collectObjectModels(file.document, models)
    for (const model of models) {
      const parsed = parseResourceLocation(model, namespace)
      if (parsed === undefined) continue
      if (!shouldCheckLocalReference(parsed.namespace, namespace, detectedModId)) continue
      const expectedPath = modelPath(root, parsed.namespace, parsed.path)
      if (!await resourceFileExists(ctx, exec, roots, candidateRoot => modelPath(candidateRoot, parsed.namespace, parsed.path))) {
        addResourceIssue(
          result.errors,
          'missing_model',
          file.path,
          `Blockstate references missing model ${model}`,
          model,
          expectedPath,
        )
      }
    }
  }
}

async function validateDataJson(
  ctx: Context,
  exec: ToolExecution,
  root: string,
  namespace: string,
  folder: 'recipes' | 'tags',
  config: ResolvedConfig,
  allowedNamespaces: ReadonlySet<string>,
  detectedModId: string | null,
  result: ResourceValidationResult,
): Promise<void> {
  if (detectedModId !== null && namespace !== detectedModId && !BUILTIN_RESOURCE_NAMESPACES.has(namespace)) {
    addResourceIssue(
      result.warnings,
      'suspicious_namespace',
      relJoin(root, `data/${namespace}/${folder}`),
      `Data namespace ${namespace} differs from detected mod id ${detectedModId}`,
      namespace,
    )
  }

  const documents = await readJsonResourceFiles(ctx, exec, relJoin(root, `data/${namespace}/${folder}`), config, result)
  for (const file of documents) {
    const references = new Set<string>()
    collectNamespaceReferences(file.document, references)
    for (const reference of references) {
      const parsed = parseResourceLocation(reference, namespace)
      if (parsed === undefined || allowedNamespaces.has(parsed.namespace)) continue
      addResourceIssue(
        result.warnings,
        'suspicious_namespace',
        file.path,
        `Reference uses namespace ${parsed.namespace}, which was not detected in this project`,
        reference,
      )
    }
  }
}

async function validateResources(ctx: Context, exec: ToolExecution, config: ResolvedConfig): Promise<ResourceValidationResult> {
  const result: ResourceValidationResult = {
    errors: [],
    warnings: [],
    checkedFiles: [],
    detectedModId: null,
  }
  const detected = await detect(ctx, exec, config)
  for (const path of detected.inspected.metadataFiles) result.checkedFiles.push(path)
  const detectedModId = detectedHighConfidenceModId(detected, result)
  result.detectedModId = detectedModId

  const roots = detected.resourceRoots.length > 0
    ? [...detected.resourceRoots].sort()
    : await fallbackResourceRoots(ctx, exec, result.warnings)
  if (roots.length === 0) return sortValidation(result)

  const assetNamespaces = await resourceNamespaces(ctx, exec, roots, 'assets')
  const dataNamespaces = await resourceNamespaces(ctx, exec, roots, 'data')
  const allNamespaces = [...new Set([...assetNamespaces, ...dataNamespaces])].sort()
  const allowedNamespaces = namespaceAllowlist(detectedModId, allNamespaces)

  for (const root of roots) {
    const rootAssetNamespaces = (await listOptionalDir(ctx, exec, relJoin(root, 'assets'), []))
      .filter(entry => entry.type === 'directory')
      .map(entry => entry.name)
      .sort()
    for (const namespace of rootAssetNamespaces) {
      if (detectedModId !== null && namespace !== detectedModId && namespace !== 'minecraft') {
        addResourceIssue(
          result.errors,
          'modid_mismatch',
          relJoin(root, `assets/${namespace}`),
          `Asset namespace ${namespace} differs from detected mod id ${detectedModId}`,
          namespace,
        )
      }
      await readJsonResourceFiles(ctx, exec, relJoin(root, `assets/${namespace}/lang`), config, result)
      await validateModelTextures(ctx, exec, roots, root, namespace, 'item', config, detectedModId, result)
      await validateModelTextures(ctx, exec, roots, root, namespace, 'block', config, detectedModId, result)
      await validateBlockstateModels(ctx, exec, roots, root, namespace, config, detectedModId, result)
    }

    const rootDataNamespaces = (await listOptionalDir(ctx, exec, relJoin(root, 'data'), []))
      .filter(entry => entry.type === 'directory')
      .map(entry => entry.name)
      .sort()
    for (const namespace of rootDataNamespaces) {
      await validateDataJson(ctx, exec, root, namespace, 'recipes', config, allowedNamespaces, detectedModId, result)
      await validateDataJson(ctx, exec, root, namespace, 'tags', config, allowedNamespaces, detectedModId, result)
    }
  }

  return sortValidation(result)
}

/**
 * Register the Minecraft project detector.
 * @param ctx - plugin context carrying tool and filesystem services.
 * @param rawConfig - optional scan bounds.
 */
export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config = resolveConfig(rawConfig)
  ctx.tools.register(defineTool({
    name: DETECT_MC_PROJECT,
    description: 'Inspect the current workspace and return structured Minecraft mod project facts: loader, Minecraft version, mappings, mod id candidates, languages, source sets, resource roots, mixins, datagen clues, and recommended Gradle validation commands. Use this before assuming which Minecraft mod loader or version the repository uses.',
    parameters: {},
    output: {
      schema: projectOutputSchema(),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    execute: (_args, exec) => detect(ctx, exec, config),
    presentCall: () => ({ card: 'generic', title: 'Detect Minecraft project', kind: 'read' }),
    presentResult: (_args, result: ToolResult) => ({
      card: 'generic',
      title: 'Minecraft project facts',
      content: result.content,
    }),
  }))
  ctx.tools.register(defineTool({
    name: VALIDATE_MC_RESOURCES,
    description: 'Validate the current Minecraft mod workspace resources with deterministic static checks: lang JSON syntax, item/block model texture references, blockstate model references, recipe/tag JSON syntax, suspicious namespaces, and mod id versus metadata consistency. This does not execute Gradle or emulate Minecraft resource loading.',
    parameters: {},
    output: {
      schema: resourceValidationOutputSchema(),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    execute: (_args, exec) => validateResources(ctx, exec, config),
    presentCall: () => ({ card: 'generic', title: 'Validate Minecraft resources', kind: 'read' }),
    presentResult: (_args, result: ToolResult) => ({
      card: 'generic',
      title: 'Minecraft resource validation',
      content: result.content,
    }),
  }))
}
