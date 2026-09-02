/**
 * Model-facing Minecraft project detector. The tool reads Gradle files,
 * mod metadata, source roots, and resource roots through `ctx.fs` and returns
 * structured evidence instead of asking the model to infer project facts from
 * prompt guidance alone.
 * @module @deepseek-ai/dsh-tool-mc-project
 */

import { posix } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { gte, satisfies, valid, validRange } from 'semver'
import { parse as parseToml } from 'smol-toml'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PreToolDecision, ToolExecution, ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsDirEntry } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-fs'
import type { CollectedOutput, ShellRunResult, ShellSandboxInfo } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-shell'
import { datagenTaskCandidates, loaderSupport, validationCommands } from './loader-support.ts'
import type { Loader, LoaderSupport } from './loader-support.ts'
import { parseGradleTaskNames, runtimeTaskCandidates } from './gradle-tasks.ts'
import type { RuntimeMode } from './gradle-tasks.ts'
import {
  errorCode,
  isAbortedError,
  listOptionalDir,
  optionalStat,
  readBoundedText,
  readOptionalText,
  readTextFile,
  sessionResolveOptions,
  walkFiles,
} from './fs-support.ts'
import type { TextFile, WalkState } from './fs-support.ts'

/** Cordis plugin name. */
export const name = 'tool-mc-project'
/** Services required by the detector. */
export const inject = ['tools', 'fs']

/** Model-facing tool name. */
export const DETECT_MC_PROJECT = 'detect_mc_project'
/** Model-facing Minecraft resource validator tool name. */
export const VALIDATE_MC_RESOURCES = 'validate_mc_resources'
/** Model-facing Minecraft project check runner tool name. */
export const RUN_MC_CHECK = 'run_mc_check'

const DEFAULT_MAX_ENTRIES = 2_000
const DEFAULT_MAX_FILE_BYTES = 512 * 1024
const DEFAULT_MAX_OUTPUT_SUMMARY_BYTES = 4_096
const DEFAULT_MAX_TASK_DISCOVERY_BYTES = 64 * 1024
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
  /**
   * Maximum UTF-8 bytes retained inline from each command stdout/stderr tail in
   * `run_mc_check` step summaries. The shell executor may already have
   * truncated or spilled the stream before this bound is applied.
   */
  maxOutputSummaryBytes?: number
  /**
   * Maximum stdout bytes captured while discovering Gradle tasks. A truncated
   * task list is treated as inconclusive rather than selecting a guessed task.
   */
  maxTaskDiscoveryBytes?: number
}

/** Schemastery configuration for the detector. */
export const Config: z<Config> = z.object({
  maxEntries: z.number().default(DEFAULT_MAX_ENTRIES),
  maxFileBytes: z.number().default(DEFAULT_MAX_FILE_BYTES),
  maxOutputSummaryBytes: z.number().default(DEFAULT_MAX_OUTPUT_SUMMARY_BYTES),
  maxTaskDiscoveryBytes: z.number().default(DEFAULT_MAX_TASK_DISCOVERY_BYTES),
})

type Confidence = 'high' | 'medium' | 'low'
type VersionClassification = 'exact' | 'range'
type CheckTarget = 'build' | 'test' | 'datagen' | 'resources' | 'runtime' | 'all'
type CheckStepStatus = 'passed' | 'failed' | 'skipped'

interface ResolvedConfig {
  maxEntries: number
  maxFileBytes: number
  maxOutputSummaryBytes: number
  maxTaskDiscoveryBytes: number
}

interface MinecraftVersionCandidate {
  value: string
  classification: VersionClassification
  source: string
  evidence: string
}

type MinecraftVersionResult =
  | { status: 'unknown'; candidates: [] }
  | {
    status: 'determined'
    value: string
    classification: VersionClassification
    candidates: MinecraftVersionCandidate[]
  }
  | { status: 'conflict'; candidates: MinecraftVersionCandidate[] }

interface MappingsCandidate {
  type: string
  version: string | null
  source: string
  evidence: string
}

type MappingsResult =
  | { status: 'unknown'; candidates: [] }
  | { status: 'determined'; type: string; version: string | null; candidates: MappingsCandidate[] }
  | { status: 'conflict'; candidates: MappingsCandidate[] }

interface LoaderEvidence {
  loader: Exclude<Loader, 'unknown'>
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
  loaderSupport: LoaderSupport
  loaderEvidence: LoaderEvidence[]
  minecraftVersion: MinecraftVersionResult
  mappings: MappingsResult
  modIdCandidates: ModIdCandidate[]
  languages: { java: boolean; kotlin: boolean }
  mainSourceSets: SourceSetInfo[]
  resourceRoots: string[]
  mixinConfigs: MixinConfig[]
  datagenClues: DatagenClue[]
  recommendedValidationCommands: string[]
  gradleTaskCandidates: string[]
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

interface OutputSummary {
  text: string
  truncated: boolean
  spillPath?: string
}

interface SandboxSummary {
  mode: string
  denied: boolean
  enforcement?: string
  runnerFailed?: boolean
}

interface CheckStepResult {
  step: string
  command?: string
  status: CheckStepStatus
  exitCode: number | null
  stdout: OutputSummary
  stderr: OutputSummary
  timedOut: boolean
  aborted: boolean
  signal: string | null
  sandbox?: SandboxSummary
  message?: string
}

interface CheckResult {
  commands: string[]
  exitCode: number | null
  steps: CheckStepResult[]
  failedStep: string | null
  suggestedNextAction: string | null
}

interface RunCheckArgs {
  target: CheckTarget
  timeoutMs?: number
  runtimeMode?: RuntimeMode
}

function isApprovedRuntimeCheck(exec: ToolExecution): boolean {
  if (exec.name !== RUN_MC_CHECK || typeof exec.arguments !== 'object' || exec.arguments === null || Array.isArray(exec.arguments)) {
    return false
  }
  const args = exec.arguments as { target?: unknown; runtimeMode?: unknown }
  return args.target === 'runtime' && (args.runtimeMode === 'client' || args.runtimeMode === 'server')
}

interface CommandPlan {
  step: string
  task?: string
}

interface DetectionState {
  warnings: string[]
  loaderEvidence: Map<Exclude<Loader, 'unknown'>, string[]>
  minecraftVersions: MinecraftVersionCandidate[]
  mappings: MappingsCandidate[]
  modIds: ModIdCandidate[]
  mixins: MixinConfig[]
  datagen: DatagenClue[]
  gradleTaskCandidates: string[]
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
const DATA_JSON_FOLDERS = ['recipes', 'tags', 'loot_tables', 'advancements', 'predicates', 'item_modifiers'] as const

const LOADER_PATTERNS: ReadonlyArray<{ loader: Exclude<Loader, 'unknown'>; regex: RegExp; label: string }> = [
  { loader: 'architectury', regex: /\b(?:architectury-loom|architectury-plugin|dev\.architectury(?::|[./])|net\.architectury(?::|[./]))\b/iu, label: 'Architectury Gradle/plugin/dependency clue' },
  { loader: 'fabric', regex: /\b(?:fabric-loom|net\.fabricmc\.fabric-loom|net\.fabricmc:fabric-loader|net\.fabricmc\.fabric-api)\b/u, label: 'Fabric Gradle/dependency clue' },
  { loader: 'quilt', regex: /\b(?:org\.quiltmc\.loom|org\.quiltmc:quilt-loader|org\.quiltmc\.quilted-fabric-api)\b/u, label: 'Quilt Gradle/dependency clue' },
  { loader: 'forge', regex: /\b(?:net\.minecraftforge\.gradle|net\.minecraftforge:forge|MinecraftForge)\b/u, label: 'Forge Gradle/dependency clue' },
  { loader: 'neoforge', regex: /\b(?:net\.neoforged\.gradle|net\.neoforged\.moddev|net\.neoforged:neoforge|NeoForge)\b/u, label: 'NeoForge Gradle/dependency clue' },
]

const BUILTIN_RESOURCE_NAMESPACES = new Set(['minecraft', 'c', 'forge', 'neoforge', 'fabric', 'quilt'])
const RESOURCE_LOCATION_PATTERN = /^([a-z0-9_.-]+:)?[a-z0-9/._-]+$/u
const RESOURCE_LOCATION_SCAN_PATTERN = /#?([a-z0-9_.-]+):([a-z0-9/._-]+)/gu
function resolveConfig(config: Config | undefined): ResolvedConfig {
  /* v8 ignore next -- optional config fields are normalized by the loader before runtime use. */
  const maxEntries = config?.maxEntries ?? DEFAULT_MAX_ENTRIES
  /* v8 ignore next -- optional config fields are normalized by the loader before runtime use. */
  const maxFileBytes = config?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  /* v8 ignore next -- optional config fields are normalized by the loader before runtime use. */
  const maxOutputSummaryBytes = config?.maxOutputSummaryBytes ?? DEFAULT_MAX_OUTPUT_SUMMARY_BYTES
  /* v8 ignore next -- optional config fields are normalized by the loader before runtime use. */
  const maxTaskDiscoveryBytes = config?.maxTaskDiscoveryBytes ?? DEFAULT_MAX_TASK_DISCOVERY_BYTES
  if (!Number.isFinite(maxEntries) || !Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('tool-mc-project config maxEntries must be a positive integer')
  }
  if (!Number.isFinite(maxFileBytes) || !Number.isInteger(maxFileBytes) || maxFileBytes < 1) {
    throw new Error('tool-mc-project config maxFileBytes must be a positive integer')
  }
  if (!Number.isFinite(maxOutputSummaryBytes) || !Number.isInteger(maxOutputSummaryBytes) || maxOutputSummaryBytes < 1) {
    throw new Error('tool-mc-project config maxOutputSummaryBytes must be a positive integer')
  }
  if (!Number.isFinite(maxTaskDiscoveryBytes) || !Number.isInteger(maxTaskDiscoveryBytes) || maxTaskDiscoveryBytes < 1) {
    throw new Error('tool-mc-project config maxTaskDiscoveryBytes must be a positive integer')
  }
  return { maxEntries, maxFileBytes, maxOutputSummaryBytes, maxTaskDiscoveryBytes }
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
  /* v8 ignore next -- callers derive each resource/source path from a unique source-set name. */
  if (!list.includes(value)) list.push(value)
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

function addGradleTask(state: DetectionState, task: string): void {
  const normalized = task.trim().replace(/^:/u, '')
  if (normalized === '' || !/^[A-Za-z][A-Za-z0-9:_-]*$/u.test(normalized)) return
  pushUnique(state.gradleTaskCandidates, normalized)
}

function scanGradleTaskDeclarations(state: DetectionState, text: string): void {
  for (const match of text.matchAll(/\btasks\.(?:register|named|create)\s*(?:<[^>]+>\s*)?\(\s*["']([^"']+)["']/gu)) {
    const task = match[1]
    /* v8 ignore next -- the capture is guaranteed by the declaration regex. */
    if (task !== undefined) addGradleTask(state, task)
  }
  for (const match of text.matchAll(/\btask\s+(?:["']([^"']+)["']|([A-Za-z][A-Za-z0-9:_-]*))/gu)) {
    const task = match[1] ?? match[2]
    /* v8 ignore next -- the alternation guarantees one task capture. */
    if (task !== undefined) addGradleTask(state, task)
  }
}

function addMinecraftVersion(state: DetectionState, value: string, source: string, evidence: string): void {
  state.minecraftVersions.push({
    value,
    classification: classifyVersion(value),
    source,
    evidence,
  })
}

function addMapping(state: DetectionState, type: string, version: string | null, source: string, evidence: string): void {
  state.mappings.push({
    type,
    version: type === 'yarn' && version?.endsWith(':v2') === true ? version.slice(0, -3) : version,
    source,
    evidence,
  })
}

function concreteVersion(value: string | undefined): string | undefined {
  if (value === undefined || /[$}{]/u.test(value)) return undefined
  return value
}

function classifyVersion(value: string): VersionClassification {
  return /^(?:[<>=~^]|[[(])/u.test(value)
    || /(?:\s|\|\||[*xX]|,)/u.test(value)
    ? 'range'
    : 'exact'
}

function isMixinFile(path: string): boolean {
  return /\.mixins?\.json$/u.test(path) || /mixins?.*\.json$/u.test(posix.basename(path))
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
  scanGradleTaskDeclarations(state, file.text)
  for (const pattern of LOADER_PATTERNS) {
    if (pattern.regex.test(file.text)) addLoader(state, pattern.loader, `${file.path}: ${pattern.label}`)
  }

  const minecraftPropertyPattern =
    /^\s*(?:minecraft[_-]?version|minecraft_version|minecraftVersion)\s*=\s*["']?([^"'\s#]+)["']?/gimu
  for (const match of file.text.matchAll(minecraftPropertyPattern)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) addMinecraftVersion(state, value, file.path, 'Minecraft version property')
  }
  const minecraftDeclarationPattern =
    /(?:com\.mojang:minecraft:|minecraft_version\s*=\s*["']|minecraftVersion\s*=\s*["'])([^"'\s)]+)/gimu
  for (const match of file.text.matchAll(minecraftDeclarationPattern)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) addMinecraftVersion(state, value, file.path, 'Minecraft dependency/version declaration')
  }

  for (const match of file.text.matchAll(/^\s*(?:yarn_mappings|yarnMappings)\s*=\s*["']?([^"'\s#]+)["']?/gimu)) {
    addMapping(state, 'yarn', concreteVersion(match[1]) ?? null, file.path, 'Yarn mappings property')
  }
  for (const match of file.text.matchAll(/net\.fabricmc:yarn:([^"'\s)]+)/gimu)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) addMapping(state, 'yarn', value, file.path, 'Yarn mappings dependency')
  }
  if (/\bofficialMojangMappings\s*\(/u.test(file.text)) {
    addMapping(state, 'official', null, file.path, 'officialMojangMappings()')
  }
  for (const match of file.text.matchAll(/org\.parchmentmc\.data:parchment-[^:]+:([^"'\s)]+)/gimu)) {
    const value = concreteVersion(match[1])
    if (value !== undefined) addMapping(state, 'parchment', value, file.path, 'Parchment mappings dependency')
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
    /* v8 ignore next -- smol-toml always throws Error instances for parser failures. */
    state.warnings.push(`${file.path}: could not parse TOML (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  /* v8 ignore next -- smol-toml returns a table object for every successful parse. */
  const versions = typeof document === 'object' && document !== null
    ? (document as Record<string, unknown>).versions
    : undefined
  if (typeof versions !== 'object' || versions === null) return
  for (const key of ['minecraft', 'minecraft_version', 'minecraftVersion']) {
    const value = (versions as Record<string, unknown>)[key]
    if (typeof value === 'string') addMinecraftVersion(state, value, file.path, `versions.${key}`)
  }
  for (const [key, type] of [['yarn', 'yarn'], ['parchment', 'parchment'], ['mappings', 'unknown']] as const) {
    const value = (versions as Record<string, unknown>)[key]
    if (typeof value === 'string') addMapping(state, type, value, file.path, `versions.${key}`)
  }
}

function scanFabricMetadata(state: DetectionState, file: TextFile): void {
  let document: unknown
  try {
    document = JSON.parse(file.text) as unknown
  } catch (error) {
    /* v8 ignore next -- JSON.parse always throws a SyntaxError. */
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
  if (minecraft !== undefined) addMinecraftVersion(state, minecraft, file.path, 'depends.minecraft')
}

function scanQuiltMetadata(state: DetectionState, file: TextFile): void {
  let document: unknown
  try {
    document = JSON.parse(file.text) as unknown
  } catch (error) {
    /* v8 ignore next -- JSON.parse always throws a SyntaxError. */
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
    /* v8 ignore next -- smol-toml always throws Error instances for parser failures. */
    state.warnings.push(`${file.path}: could not parse TOML (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  const loader: Exclude<Loader, 'unknown'> = posix.basename(file.path) === 'neoforge.mods.toml' ? 'neoforge' : 'forge'
  addLoader(state, loader, `${file.path}: ${posix.basename(file.path)}`)
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
  if (found.length === 1) {
    const first = found[0] as [Exclude<Loader, 'unknown'>, string[]]
    return first[0]
  }
  state.warnings.push(`conflicting loader evidence: ${found.map(([loader]) => loader).join(', ')}`)
  return 'unknown'
}

function chooseMinecraftVersion(state: DetectionState): MinecraftVersionResult {
  const candidates = uniq(
    state.minecraftVersions,
    item => `${item.value}\0${item.classification}\0${item.source}\0${item.evidence}`,
  )
  if (candidates.length === 0) return { status: 'unknown', candidates: [] }
  const exactValues = uniq(candidates.filter(candidate => candidate.classification === 'exact').map(candidate => candidate.value), value => value)
  const rangeValues = uniq(candidates.filter(candidate => candidate.classification === 'range').map(candidate => candidate.value), value => value)
  if (exactValues.length === 1) {
    const exact = exactValues[0] as string
    if (rangeValues.every(range => rangeIncludesExact(range, exact))) {
      return { status: 'determined', value: exact, classification: 'exact', candidates }
    }
  } else if (exactValues.length === 0 && rangeValues.length === 1) {
    return { status: 'determined', value: rangeValues[0] as string, classification: 'range', candidates }
  }
  state.warnings.push(`conflicting Minecraft version candidates: ${uniq(candidates.map(candidate => candidate.value), value => value).join(', ')}`)
  return { status: 'conflict', candidates }
}

function rangeIncludesExact(range: string, exact: string): boolean {
  const parsedExact = valid(exact, { loose: true })
  const parsedRange = validRange(range, { loose: true })
  return parsedExact !== null
    && parsedRange !== null
    && satisfies(parsedExact, parsedRange, { includePrerelease: true, loose: true })
}

function chooseMappings(state: DetectionState): MappingsResult {
  const candidates = uniq(state.mappings, mapping =>
    `${mapping.type}\0${mapping.version ?? ''}\0${mapping.source}\0${mapping.evidence}`)
  if (candidates.length === 0) return { status: 'unknown', candidates: [] }
  const facts = uniq(candidates, mapping => `${mapping.type}\0${mapping.version ?? ''}`)
  if (facts.length === 1) {
    const first = facts[0] as MappingsCandidate
    return { status: 'determined', type: first.type, version: first.version, candidates }
  }
  state.warnings.push(`conflicting mappings candidates: ${facts.map(mapping => `${mapping.type}${mapping.version === null ? '' : ` ${mapping.version}`}`).join(', ')}`)
  return { status: 'conflict', candidates }
}

function outputSummarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
      truncated: { type: 'boolean', required: true },
      spillPath: { type: 'string' },
    },
  } as const
}

function sandboxSummarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: { type: 'string', required: true },
      denied: { type: 'boolean', required: true },
      enforcement: { type: 'string' },
      runnerFailed: { type: 'boolean' },
    },
  } as const
}

function checkOutputSchema() {
  const stream = outputSummarySchema()
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      commands: { type: 'array', required: true, items: { type: 'string' } },
      exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
      steps: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string', required: true },
            command: { type: 'string' },
            status: { type: 'string', required: true, enum: ['passed', 'failed', 'skipped'] },
            exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
            stdout: { ...stream, required: true },
            stderr: { ...stream, required: true },
            timedOut: { type: 'boolean', required: true },
            aborted: { type: 'boolean', required: true },
            signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
            sandbox: sandboxSummarySchema(),
            message: { type: 'string' },
          },
        },
      },
      failedStep: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
      suggestedNextAction: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
    },
  } as const
}

function emptyOutput(): OutputSummary {
  return { text: '', truncated: false }
}

function summarizeText(text: string, alreadyTruncated: boolean, spillPath: string | undefined, maxBytes: number): OutputSummary {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) {
    return {
      text,
      truncated: alreadyTruncated,
      /* v8 ignore next -- spillPath is an optional provider-owned artifact path. */
      ...spillPath !== undefined ? { spillPath } : {},
    }
  }
  const tail = bytes.subarray(bytes.length - maxBytes).toString('utf8').replace(/^\uFFFD/u, '')
  return {
    text: tail,
    truncated: true,
    /* v8 ignore next -- spillPath is an optional provider-owned artifact path. */
    ...spillPath !== undefined ? { spillPath } : {},
  }
}

function summarizeStream(output: CollectedOutput, maxBytes: number): OutputSummary {
  return summarizeText(output.text, output.truncated, output.spillPath, maxBytes)
}

function summarizeSandbox(sandbox: ShellSandboxInfo): SandboxSummary {
  return {
    mode: sandbox.mode,
    denied: sandbox.denied,
    ...sandbox.enforcement !== undefined ? { enforcement: sandbox.enforcement } : {},
    ...sandbox.runnerFailed !== undefined ? { runnerFailed: sandbox.runnerFailed } : {},
  }
}

function checkFailed(result: ShellRunResult): boolean {
  return result.exitCode !== 0
    || result.signal !== null
    || result.timedOut
    || result.aborted
    || result.sandbox?.denied === true
    || result.sandbox?.runnerFailed === true
}

function commandStep(step: string, command: string, result: ShellRunResult, config: ResolvedConfig): CheckStepResult {
  return {
    step,
    command,
    status: checkFailed(result) ? 'failed' : 'passed',
    exitCode: result.exitCode,
    stdout: summarizeStream(result.stdout, config.maxOutputSummaryBytes),
    stderr: summarizeStream(result.stderr, config.maxOutputSummaryBytes),
    timedOut: result.timedOut,
    aborted: result.aborted,
    signal: result.signal,
    ...result.sandbox !== undefined ? { sandbox: summarizeSandbox(result.sandbox) } : {},
  }
}

function failedStaticStep(step: string, message: string, detail: unknown, config: ResolvedConfig): CheckStepResult {
  return {
    step,
    status: 'failed',
    exitCode: null,
    stdout: summarizeText(JSON.stringify(detail, null, 2), false, undefined, config.maxOutputSummaryBytes),
    stderr: emptyOutput(),
    timedOut: false,
    aborted: false,
    signal: null,
    message,
  }
}

function passedStaticStep(step: string, message: string): CheckStepResult {
  return {
    step,
    status: 'passed',
    exitCode: 0,
    stdout: { text: message, truncated: false },
    stderr: emptyOutput(),
    timedOut: false,
    aborted: false,
    signal: null,
    message,
  }
}

function unavailableStep(step: string, message: string): CheckStepResult {
  return {
    step,
    status: 'failed',
    exitCode: null,
    stdout: emptyOutput(),
    stderr: { text: message, truncated: false },
    timedOut: false,
    aborted: false,
    signal: null,
    message,
  }
}

async function gradleLauncher(ctx: Context, exec: ToolExecution, detected: DetectionResult): Promise<string | null> {
  if (detected.inspected.gradleFiles.length === 0) return null
  const hasPosixWrapper = (await optionalStat(ctx, exec, 'gradlew'))?.type === 'file'
  const hasWindowsWrapper = (await optionalStat(ctx, exec, 'gradlew.bat'))?.type === 'file'
  /* v8 ignore next -- POSIX coverage cannot execute the Windows wrapper peer; the native Windows lane covers it. */
  if (process.platform === 'win32') {
    /* v8 ignore start -- the Windows branch is exercised by the native Windows lane. */
    if (hasWindowsWrapper) return '.\\gradlew.bat'
    if (hasPosixWrapper) return './gradlew'
    /* v8 ignore stop */
  } else {
    if (hasPosixWrapper) return './gradlew'
    if (hasWindowsWrapper) return './gradlew.bat'
  }
  return 'gradle'
}

function addTargetPlans(plans: CommandPlan[], target: CheckTarget, detected: DetectionResult): string | undefined {
  switch (target) {
    case 'build':
      plans.push({ step: 'build', task: 'build' })
      return undefined
    case 'test':
      plans.push({ step: 'test', task: 'test' })
      return undefined
    case 'datagen': {
      if (detected.loaderSupport !== 'supported') return 'datagen'
      plans.push({ step: 'datagen' })
      return undefined
    }
    case 'resources':
      plans.push({ step: 'resources:gradle', task: 'processResources' })
      return undefined
    case 'runtime':
      if (detected.loaderSupport !== 'supported') return 'runtime'
      plans.push({ step: 'runtime' })
      return undefined
    case 'all': {
      if (detected.datagenClues.length > 0) {
        if (detected.loaderSupport === 'supported') plans.push({ step: 'datagen' })
        // Unsupported loaders retain generic checks; only the loader-specific
        // datagen plan is omitted. Unknown evidence still fails closed.
        if (detected.loaderSupport === 'unknown') return 'datagen'
      }
      plans.push(
        { step: 'resources:gradle', task: 'processResources' },
        { step: 'test', task: 'test' },
        { step: 'build', task: 'build' },
      )
      return undefined
    }
  }
}

function suggestedNextAction(step: string, result?: CheckStepResult): string {
  if (step === 'datagen' && result === undefined) {
    return 'Inspect loader evidence with detect_mc_project before choosing a datagen task.'
  }
  if (step === 'resources:static') {
    return 'Fix the reported Minecraft resource errors, then rerun run_mc_check with target "resources".'
  }
  if (step === 'gradle') {
    return 'Add a Gradle wrapper or root Gradle build file, or run detect_mc_project to confirm this workspace is a Minecraft Gradle project.'
  }
  if (step === 'gradle-layout') {
    return 'Inspect the Gradle settings and run the appropriate qualified task manually; run_mc_check only executes unambiguous root-project tasks.'
  }
  if (step === 'runtime') {
    return 'Ask the user to approve a client or dedicated-server launch, then retry run_mc_check with runtimeMode set.'
  }
  if (result?.sandbox?.denied === true) {
    return 'The sandbox denied the Gradle command; review the denied access and retry through the approved shell permission path if the command is trusted.'
  }
  if (result?.timedOut === true) {
    return `The ${step} command timed out; inspect partial output and rerun with a focused target or larger timeout.`
  }
  return `Inspect the ${step} output, fix the failing project issue, then rerun run_mc_check.`
}

function commandFor(launcher: string, task: string): string {
  return `${launcher} ${task}`
}

function taskDiscoveryFailure(step: CheckStepResult, message: string): CheckStepResult {
  return { ...step, status: 'failed', message }
}

async function listGradleTasks(
  ctx: Context,
  exec: ToolExecution,
  config: ResolvedConfig,
  launcher: string,
  timeoutMs: number | undefined,
): Promise<{ tasks: string[]; step: CheckStepResult }> {
  const command = commandFor(launcher, 'tasks --all --console=plain')
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    ...timeoutMs !== undefined ? { timeoutMs } : {},
    stdoutMaxBytes: config.maxTaskDiscoveryBytes,
    signal: exec.signal,
    ...exec.agent?.session.header.cwd !== undefined ? { workdir: exec.agent.session.header.cwd } : {},
  }))
  const step = commandStep('gradle:tasks', command, result, config)
  if (step.status === 'failed') return { tasks: [], step }
  if (result.stdout.truncated) {
    return {
      tasks: [],
      step: taskDiscoveryFailure(step, `Gradle task output exceeded maxTaskDiscoveryBytes ${config.maxTaskDiscoveryBytes}; no task was selected.`),
    }
  }
  return { tasks: parseGradleTaskNames(result.stdout.text), step }
}

async function discoverDatagenTask(
  ctx: Context,
  exec: ToolExecution,
  config: ResolvedConfig,
  detected: DetectionResult,
  launcher: string,
  timeoutMs: number | undefined,
): Promise<{ task?: string; step?: CheckStepResult }> {
  const staticCandidates = datagenTaskCandidates(detected.loader, detected.gradleTaskCandidates)
  if (staticCandidates.length === 1) {
    const task = staticCandidates[0]
    /* v8 ignore next -- length one guarantees a defined candidate. */
    if (task !== undefined) return { task }
  }
  if (staticCandidates.length > 1) {
    return {
      step: unavailableStep(
        'datagen',
        `Multiple datagen Gradle tasks were declared: ${staticCandidates.join(', ')}. Inspect the project and choose one explicitly.`,
      ),
    }
  }

  const listing = await listGradleTasks(ctx, exec, config, launcher, timeoutMs)
  if (listing.step.status === 'failed') return { step: listing.step }
  const candidates = datagenTaskCandidates(detected.loader, listing.tasks)
  if (candidates.length === 1) {
    const task = candidates[0]
    /* v8 ignore next -- length one guarantees a defined candidate. */
    if (task !== undefined) return { task, step: listing.step }
  }
  if (candidates.length === 0) {
    return { step: taskDiscoveryFailure(listing.step, `Gradle task listing did not expose a datagen task for loader ${detected.loader}.`) }
  }
  return { step: taskDiscoveryFailure(listing.step, `Gradle task listing exposed multiple datagen tasks: ${candidates.join(', ')}.`) }
}

async function discoverRuntimeTask(
  ctx: Context,
  exec: ToolExecution,
  config: ResolvedConfig,
  detected: DetectionResult,
  launcher: string,
  mode: RuntimeMode,
  timeoutMs: number | undefined,
): Promise<{ task?: string; step?: CheckStepResult }> {
  const staticCandidates = runtimeTaskCandidates(mode, detected.gradleTaskCandidates)
  if (staticCandidates.length === 1) {
    const task = staticCandidates[0]
    /* v8 ignore next -- length one guarantees a defined candidate. */
    if (task !== undefined) return { task }
  }
  if (staticCandidates.length > 1) {
    return {
      step: unavailableStep(
        'runtime',
        `Multiple ${mode} runtime Gradle tasks were declared: ${staticCandidates.join(', ')}. Inspect the project and choose one explicitly.`,
      ),
    }
  }
  const listing = await listGradleTasks(ctx, exec, config, launcher, timeoutMs)
  if (listing.step.status === 'failed') return { step: listing.step }
  const candidates = runtimeTaskCandidates(mode, listing.tasks)
  if (candidates.length === 1) {
    const task = candidates[0]
    /* v8 ignore next -- length one guarantees a defined candidate. */
    if (task !== undefined) return { task, step: listing.step }
  }
  if (candidates.length === 0) {
    return { step: taskDiscoveryFailure(listing.step, `Gradle task listing did not expose a ${mode} runtime task.`) }
  }
  return { step: taskDiscoveryFailure(listing.step, `Gradle task listing exposed multiple ${mode} runtime tasks: ${candidates.join(', ')}.`) }
}

async function unsupportedGradleLayout(
  ctx: Context,
  exec: ToolExecution,
  config: ResolvedConfig,
): Promise<string | undefined> {
  for (const path of ['settings.gradle', 'settings.gradle.kts']) {
    const stat = await optionalStat(ctx, exec, path)
    if (stat === undefined || stat.type !== 'file') continue
    const warnings: string[] = []
    const file = await readTextFile(ctx, exec, path, stat.target, stat.size, config, warnings)
    if (file === undefined) {
      return `Cannot safely choose root Gradle tasks because ${path} could not be inspected: ${warnings.join('; ')}`
    }
    if (/\bincludeBuild\s*(?:\(|["'])/u.test(file.text)) {
      return `${path} declares an included build; root task selection is ambiguous.`
    }
    if (/\binclude(?:Flat)?\s*(?:\(|["'])/u.test(file.text)) {
      return `${path} declares one or more subprojects; root task selection is ambiguous.`
    }
  }
  return undefined
}

async function runCommandStep(
  ctx: Context,
  exec: ToolExecution,
  config: ResolvedConfig,
  plan: CommandPlan,
  launcher: string,
  timeoutMs: number | undefined,
): Promise<CheckStepResult> {
  if (plan.task === undefined) throw new Error(`unresolved Gradle task for ${plan.step}`)
  const command = commandFor(launcher, plan.task)
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    ...timeoutMs !== undefined ? { timeoutMs } : {},
    signal: exec.signal,
    ...exec.agent?.session.header.cwd !== undefined ? { workdir: exec.agent.session.header.cwd } : {},
  }))
  return commandStep(plan.step, command, result, config)
}

async function runStaticResourceStep(ctx: Context, exec: ToolExecution, config: ResolvedConfig): Promise<CheckStepResult> {
  const validation = await validateResources(ctx, exec, config)
  if (validation.errors.length > 0) {
    return failedStaticStep(
      'resources:static',
      `Minecraft resource validation reported ${validation.errors.length} error(s).`,
      {
        errors: validation.errors,
        warnings: validation.warnings,
        checkedFiles: validation.checkedFiles,
        detectedModId: validation.detectedModId,
      },
      config,
    )
  }
  return passedStaticStep(
    'resources:static',
    `validated ${validation.checkedFiles.length} Minecraft resource file(s); warnings: ${validation.warnings.length}`,
  )
}

function issueKey(issue: ResourceIssue): string {
  return `${issue.code}\0${issue.path}\0${issue.reference ?? ''}\0${issue.expectedPath ?? ''}\0${issue.message}`
}

function sortIssue(a: ResourceIssue, b: ResourceIssue): number {
  /* v8 ignore next -- issueKey deduplication and fixed issue constructors make later tie-breakers defensive only. */
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
  return posix.join(root, `assets/${namespace}/textures/${path}.png`)
}

function modelPath(root: string, namespace: string, path: string): string {
  return posix.join(root, `assets/${namespace}/models/${path}.json`)
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = (value & 1) === 0 ? value >>> 1 : (value >>> 1) ^ 0xedb88320
    table[index] = value >>> 0
  }
  return table
})()

function pngCrc(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = (value >>> 8) ^ (PNG_CRC_TABLE[(value ^ byte) & 0xff] ?? 0)
  return (value ^ 0xffffffff) >>> 0
}

function pngError(bytes: Uint8Array): string | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length === 0) return 'PNG file is empty'
  if (bytes.length < signature.length || !signature.every((value, index) => bytes[index] === value)) {
    return 'PNG signature is missing or invalid'
  }

  let offset = signature.length
  let hasHeader = false
  let hasEnd = false
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) return 'PNG chunk header is truncated'
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
    /* v8 ignore start -- the preceding length guard guarantees all four type bytes. */
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    )
    /* v8 ignore stop */
    const end = offset + 12 + length
    /* v8 ignore next -- a valid PNG chunk always has a four-byte non-empty type. */
    if (end > bytes.length) return `PNG ${type || 'chunk'} data is truncated`
    const expectedCrc = new DataView(bytes.buffer, bytes.byteOffset + offset + 8 + length, 4).getUint32(0)
    const actualCrc = pngCrc(bytes.subarray(offset + 4, offset + 8 + length))
    if (expectedCrc !== actualCrc) return `PNG ${type || 'chunk'} CRC is invalid`
    if (!hasHeader && type !== 'IHDR') return 'PNG must begin with an IHDR chunk'
    if (type === 'IHDR') {
      if (hasHeader || length !== 13) return 'PNG IHDR chunk is invalid'
      const header = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 13)
      if (header.getUint32(0) === 0 || header.getUint32(4) === 0) return 'PNG dimensions must be non-zero'
      hasHeader = true
    }
    if (type === 'IEND') {
      if (length !== 0) return 'PNG IEND chunk is invalid'
      hasEnd = true
      break
    }
    offset = end
  }
  if (!hasHeader) return 'PNG has no IHDR chunk'
  if (!hasEnd) return 'PNG has no complete IEND chunk'
  return undefined
}

async function validatePngFiles(
  ctx: Context,
  exec: ToolExecution,
  root: string,
  namespace: string,
  config: ResolvedConfig,
  result: ResourceValidationResult,
): Promise<void> {
  const warnings: string[] = []
  const files = await walkFiles(
    ctx,
    exec,
    posix.join(root, `assets/${namespace}/textures`),
    { entries: 0, warned: false },
    config,
    warnings,
    path => path.endsWith('.png'),
  )
  for (const warning of warnings) addResourceIssue(result.warnings, 'scan_warning', root, warning)
  for (const file of files) {
    result.checkedFiles.push(file.path)
    if (file.entry.size !== undefined && file.entry.size > config.maxFileBytes) {
      /* v8 ignore next -- JSON.parse throws SyntaxError, never a non-Error value. */
      addResourceIssue(
        result.warnings,
        'file_too_large',
        file.path,
        `Skipped because file size ${file.entry.size} exceeds maxFileBytes ${config.maxFileBytes}`,
      )
      continue
    }
    try {
      const bytes = await ctx.fs.readBytes(file.entry.target, exec.signal, config.maxFileBytes)
      const error = pngError(bytes)
      if (error !== undefined) addResourceIssue(result.errors, 'invalid_png', file.path, error)
    } catch (error) {
      if (isAbortedError(error, exec.signal)) throw error
      if (errorCode(error) === 'FS_TOO_LARGE') {
        addResourceIssue(
          result.warnings,
          'file_too_large',
          file.path,
          `Skipped because content exceeds maxFileBytes ${config.maxFileBytes}`,
        )
        continue
      }
      addResourceIssue(
        result.errors,
        'invalid_png',
        file.path,
        `PNG could not be read as bounded binary data: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

function validateLanguageDocuments(
  documents: readonly { path: string; document: unknown }[],
  result: ResourceValidationResult,
): void {
  for (const file of documents) {
    const entries = objectRecord(file.document)
    if (entries === undefined) {
      addResourceIssue(result.errors, 'invalid_lang_shape', file.path, 'Language JSON must contain an object at the root.')
      continue
    }
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'string') {
        addResourceIssue(
          result.errors,
          'invalid_lang_entry',
          file.path,
          `Language entry ${key} must have a string value.`,
          key,
        )
      }
    }
  }
}

function parseJsonForValidation(result: ResourceValidationResult, path: string, text: string): unknown {
  result.checkedFiles.push(path)
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    addResourceIssue(
      result.errors,
      'invalid_json',
      path,
      /* v8 ignore next -- JSON.parse throws SyntaxError, never a non-Error value. */
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
    return await readBoundedText(ctx, exec, entry.target, config)
  } catch (error) {
    if (isAbortedError(error, exec.signal)) throw error
    if (errorCode(error) === 'FS_TOO_LARGE') {
      addResourceIssue(
        result.warnings,
        'file_too_large',
        path,
        `Skipped because content exceeds maxFileBytes ${config.maxFileBytes}`,
      )
      return undefined
    }
    addResourceIssue(
      result.warnings,
      'read_failed',
      path,
      /* v8 ignore next -- filesystem providers expose Error-compatible failures. */
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
      /* v8 ignore next -- the regex requires both capture groups when it yields a match. */
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
      /* v8 ignore next -- the regex requires both capture groups when it yields a match. */
      if (namespace !== undefined && path !== undefined) out.add(`${namespace}:${path}`)
    }
    collectNamespaceReferences(child, out)
  }
}

function detectedHighConfidenceModId(detected: DetectionResult, result: ResourceValidationResult): string | null {
  const candidates = [...new Set(detected.modIdCandidates
    .filter(candidate => candidate.confidence === 'high')
    .map(candidate => candidate.id))]
  /* v8 ignore next -- length one guarantees a defined array element. */
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
  const srcEntries = await listOptionalDir(ctx, exec, 'src')
  for (const entry of srcEntries.filter(candidate => candidate.type === 'directory')) {
    const path = `src/${entry.name}/resources`
    /* v8 ignore next -- detect() records every existing source-set resources directory before fallback runs. */
    if ((await optionalStat(ctx, exec, path))?.type === 'directory') pushUnique(roots, path)
  }
  /* v8 ignore next -- fallback is only called when detect() found no resource roots. */
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
    const entries = await listOptionalDir(ctx, exec, posix.join(root, kind))
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
      loader: { type: 'string', required: true, enum: ['architectury', 'fabric', 'forge', 'neoforge', 'quilt', 'unknown'] },
      loaderSupport: { type: 'string', required: true, enum: ['supported', 'unsupported', 'unknown'] },
      loaderEvidence: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            loader: { type: 'string', required: true, enum: ['architectury', 'fabric', 'forge', 'neoforge', 'quilt'] },
            evidence: { ...stringArray, required: true },
          },
        },
      },
      minecraftVersion: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          status: { type: 'string', required: true, enum: ['determined', 'unknown', 'conflict'] },
          value: { type: 'string' },
          classification: { type: 'string', enum: ['exact', 'range'] },
          candidates: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                value: { type: 'string', required: true },
                classification: { type: 'string', required: true, enum: ['exact', 'range'] },
                source: { type: 'string', required: true },
                evidence: { type: 'string', required: true },
              },
            },
          },
        },
      },
      mappings: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          status: { type: 'string', required: true, enum: ['determined', 'unknown', 'conflict'] },
          type: { type: 'string' },
          version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          candidates: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', required: true },
                version: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                source: { type: 'string', required: true },
                evidence: { type: 'string', required: true },
              },
            },
          },
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
      gradleTaskCandidates: { ...stringArray, required: true },
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
    gradleTaskCandidates: [],
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
  const srcEntries = await listOptionalDir(ctx, exec, 'src')
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
    const files = await walkFiles(
      ctx,
      exec,
      resourceRoot,
      walkState,
      config,
      warnings,
      path => METADATA_BASENAMES.has(posix.basename(path)),
    )
    for (const file of files) {
      const text = await readTextFile(ctx, exec, file.path, file.entry.target, file.entry.size, config, warnings)
      if (text !== undefined) metadataFiles.push(text)
    }
  }
  for (const file of metadataFiles) {
    switch (posix.basename(file.path)) {
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
  const loaderSupportState = loaderSupport(loader)
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
  if (loaderSupportState === 'unsupported') {
    warnings.push(`loader ${loader} is detected but unsupported by this profile; only Fabric and NeoForge are supported`)
  }
  if (minecraftVersion.status === 'unknown') warnings.push('Minecraft version could not be identified')
  if (mappings.status === 'unknown') warnings.push('mappings could not be identified')

  const loaderEvidence = [...state.loaderEvidence.entries()]
    .map(([loader, evidence]) => ({ loader, evidence: [...evidence] }))
    .sort((a, b) => a.loader.localeCompare(b.loader))

  return {
    workspace: root.displayPath,
    loader,
    loaderSupport: loaderSupportState,
    loaderEvidence,
    minecraftVersion,
    mappings,
    modIdCandidates,
    languages: { java: hasJava, kotlin: hasKotlin },
    mainSourceSets: sourceSets.sort((a, b) => a.name.localeCompare(b.name)),
    resourceRoots: [...resourceRoots].sort(),
    mixinConfigs,
    datagenClues,
    recommendedValidationCommands: validationCommands(
      loader,
      loaderSupportState,
      gradleFiles.length > 0,
      hasWrapper,
      datagenClues,
      state.gradleTaskCandidates,
    ),
    gradleTaskCandidates: [...state.gradleTaskCandidates].sort(),
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
  const documents = await readJsonResourceFiles(ctx, exec, posix.join(root, `assets/${namespace}/models/${folder}`), config, result)
  for (const file of documents) {
    const model = objectRecord(file.document)
    if (model === undefined) {
      addResourceIssue(result.errors, 'invalid_model_shape', file.path, 'Model JSON must contain an object at the root.')
      continue
    }
    const parent = stringAt(model, 'parent')
    if (parent !== undefined) {
      const parsedParent = parseResourceLocation(parent, namespace)
      if (parsedParent !== undefined && shouldCheckLocalReference(parsedParent.namespace, namespace, detectedModId)) {
        const expectedParent = modelPath(root, parsedParent.namespace, parsedParent.path)
        const parentExists = await resourceFileExists(
          ctx,
          exec,
          roots,
          candidateRoot => modelPath(candidateRoot, parsedParent.namespace, parsedParent.path),
        )
        if (!parentExists) {
          addResourceIssue(
            result.errors,
            'missing_model_parent',
            file.path,
            `Model references missing local parent ${parent}`,
            parent,
            expectedParent,
          )
        }
      }
    }
    const textures = model.textures
    const textureRecord = objectRecord(textures)
    if (textures !== undefined && textureRecord === undefined) {
      addResourceIssue(result.errors, 'invalid_model_shape', file.path, 'Model textures must be an object when present.')
      continue
    }
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
  const documents = await readJsonResourceFiles(ctx, exec, posix.join(root, `assets/${namespace}/blockstates`), config, result)
  for (const file of documents) {
    if (objectRecord(file.document) === undefined) {
      addResourceIssue(result.errors, 'invalid_blockstate_shape', file.path, 'Blockstate JSON must contain an object at the root.')
      continue
    }
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
  folder: typeof DATA_JSON_FOLDERS[number],
  config: ResolvedConfig,
  allowedNamespaces: ReadonlySet<string>,
  detectedModId: string | null,
  result: ResourceValidationResult,
): Promise<void> {
  if (detectedModId !== null && namespace !== detectedModId && !BUILTIN_RESOURCE_NAMESPACES.has(namespace)) {
    addResourceIssue(
      result.warnings,
      'suspicious_namespace',
      posix.join(root, `data/${namespace}/${folder}`),
      `Data namespace ${namespace} differs from detected mod id ${detectedModId}`,
      namespace,
    )
  }

  const documents = await readJsonResourceFiles(ctx, exec, posix.join(root, `data/${namespace}/${folder}`), config, result)
  for (const file of documents) {
    if (objectRecord(file.document) === undefined) {
      addResourceIssue(
        result.errors,
        'invalid_resource_shape',
        file.path,
        `${folder} JSON must contain an object at the root.`,
      )
      continue
    }
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

async function validateItemDefinitions(
  ctx: Context,
  exec: ToolExecution,
  root: string,
  namespace: string,
  config: ResolvedConfig,
  version: MinecraftVersionResult,
  result: ResourceValidationResult,
): Promise<void> {
  const base = posix.join(root, `assets/${namespace}/items`)
  const files = await readJsonResourceFiles(ctx, exec, base, config, result)
  if (files.length === 0) return
  for (const file of files) {
    if (objectRecord(file.document) === undefined) {
      addResourceIssue(result.errors, 'invalid_item_definition_shape', file.path, 'Item definition JSON must contain an object at the root.')
    }
  }
  if (version.status === 'determined' && version.classification === 'exact' && valid(version.value, { loose: true }) !== null) {
    if (!gte(version.value, '1.21.4', { loose: true })) {
      addResourceIssue(
        result.warnings,
        'item_definition_version',
        base,
        `Item definition resources are newer than detected Minecraft ${version.value}; verify the target version and resource format.`,
      )
    }
    return
  }
  addResourceIssue(
    result.warnings,
    'item_definition_version_unknown',
    base,
    'Item definition resources were found, but the exact Minecraft version is not determined; resource-format compatibility was not assumed.',
  )
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
    const rootAssetNamespaces = (await listOptionalDir(ctx, exec, posix.join(root, 'assets')))
      .filter(entry => entry.type === 'directory')
      .map(entry => entry.name)
      .sort()
    for (const namespace of rootAssetNamespaces) {
      if (detectedModId !== null && namespace !== detectedModId && namespace !== 'minecraft') {
        addResourceIssue(
          result.errors,
          'modid_mismatch',
          posix.join(root, `assets/${namespace}`),
          `Asset namespace ${namespace} differs from detected mod id ${detectedModId}`,
          namespace,
        )
      }
      const languageDocuments = await readJsonResourceFiles(ctx, exec, posix.join(root, `assets/${namespace}/lang`), config, result)
      validateLanguageDocuments(languageDocuments, result)
      await validatePngFiles(ctx, exec, root, namespace, config, result)
      await validateModelTextures(ctx, exec, roots, root, namespace, 'item', config, detectedModId, result)
      await validateModelTextures(ctx, exec, roots, root, namespace, 'block', config, detectedModId, result)
      await validateBlockstateModels(ctx, exec, roots, root, namespace, config, detectedModId, result)
      await validateItemDefinitions(ctx, exec, root, namespace, config, detected.minecraftVersion, result)
    }

    const rootDataNamespaces = (await listOptionalDir(ctx, exec, posix.join(root, 'data')))
      .filter(entry => entry.type === 'directory')
      .map(entry => entry.name)
      .sort()
    for (const namespace of rootDataNamespaces) {
      for (const folder of DATA_JSON_FOLDERS) {
        await validateDataJson(ctx, exec, root, namespace, folder, config, allowedNamespaces, detectedModId, result)
      }
    }
  }

  return sortValidation(result)
}

async function runMcCheck(ctx: Context, exec: ToolExecution, config: ResolvedConfig, args: RunCheckArgs): Promise<CheckResult> {
  const detected = await detect(ctx, exec, config)
  const unsupportedLayout = await unsupportedGradleLayout(ctx, exec, config)
  if (unsupportedLayout !== undefined) {
    const step = unavailableStep('gradle-layout', unsupportedLayout)
    return {
      commands: [],
      exitCode: null,
      steps: [step],
      failedStep: 'gradle-layout',
      suggestedNextAction: suggestedNextAction('gradle-layout'),
    }
  }
  const plans: CommandPlan[] = []
  if (args.target === 'runtime' && args.runtimeMode === undefined) {
    const step = unavailableStep('runtime', 'runtimeMode must be "client" or "server" before launching a Minecraft runtime task.')
    return {
      commands: [],
      exitCode: null,
      steps: [step],
      failedStep: 'runtime',
      suggestedNextAction: 'Ask the user whether the client or dedicated server should be launched, then retry with runtimeMode.',
    }
  }
  const unsupportedStep = addTargetPlans(plans, args.target, detected)
  if (unsupportedStep !== undefined) {
    const message = detected.loaderSupport === 'unsupported'
      ? `Loader ${detected.loader} is detected but unsupported by this profile; no loader-specific ${unsupportedStep} check was executed.`
      : `Cannot infer a datagen Gradle task for loader ${detected.loader}.`
    const step = unavailableStep(unsupportedStep, message)
    return {
      commands: [],
      exitCode: null,
      steps: [step],
      failedStep: unsupportedStep,
      suggestedNextAction: suggestedNextAction(unsupportedStep),
    }
  }

  const launcher = await gradleLauncher(ctx, exec, detected)
  if (launcher === null) {
    const step = unavailableStep('gradle', 'No root Gradle files were found; no Minecraft check command was executed.')
    return {
      commands: [],
      exitCode: null,
      steps: [step],
      failedStep: 'gradle',
      suggestedNextAction: suggestedNextAction('gradle'),
    }
  }

  const steps: CheckStepResult[] = []
  let discoveryCommand: string | undefined
  const unresolvedPlan = plans.find(plan => plan.task === undefined)
  if (unresolvedPlan !== undefined) {
    const discovery = unresolvedPlan.step === 'datagen'
      ? await discoverDatagenTask(ctx, exec, config, detected, launcher, args.timeoutMs)
      : await discoverRuntimeTask(ctx, exec, config, detected, launcher, args.runtimeMode as RuntimeMode, args.timeoutMs)
    if (discovery.step !== undefined) {
      steps.push(discovery.step)
      discoveryCommand = discovery.step.command
    }
    if (discovery.task === undefined) {
      const failedStep = discovery.step?.step ?? 'datagen'
      const unresolvedLabel = unresolvedPlan.step === 'runtime' ? 'runtime' : 'datagen'
      return {
        commands: discovery.step?.command === undefined ? [] : [discovery.step.command],
        exitCode: discovery.step?.exitCode ?? null,
        steps,
        failedStep,
        suggestedNextAction: failedStep === 'gradle:tasks'
          ? `Inspect the Gradle task listing and choose the project-specific ${unresolvedLabel} task before retrying.`
          : suggestedNextAction(unresolvedLabel),
      }
    }
    unresolvedPlan.task = discovery.task
  }
  const commands = [
    ...discoveryCommand === undefined ? [] : [discoveryCommand],
    ...plans.map((plan) => {
      if (plan.task === undefined) throw new Error(`unresolved Gradle task for ${plan.step}`)
      return commandFor(launcher, plan.task)
    }),
  ]
  for (const plan of plans) {
    if (plan.step === 'resources:gradle') {
      const staticStep = await runStaticResourceStep(ctx, exec, config)
      steps.push(staticStep)
      if (staticStep.status === 'failed') {
        return {
          commands,
          exitCode: null,
          steps,
          failedStep: 'resources:static',
          suggestedNextAction: suggestedNextAction('resources:static'),
        }
      }
    }
    const step = await runCommandStep(ctx, exec, config, plan, launcher, args.timeoutMs)
    steps.push(step)
    if (step.status === 'failed') {
      return {
        commands,
        exitCode: step.exitCode,
        steps,
        failedStep: step.step,
        suggestedNextAction: suggestedNextAction(step.step, step),
      }
    }
  }
  return {
    commands,
    exitCode: 0,
    steps,
    failedStep: null,
    suggestedNextAction: null,
  }
}

/**
 * Register the Minecraft project tools.
 * @param ctx - plugin context carrying tool and filesystem services.
 * @param rawConfig - optional scan and output-summary bounds.
 */
export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config = resolveConfig(rawConfig)
  ctx.effect(() => {
    const dispose = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (!isApprovedRuntimeCheck(exec)) return next()
      return {
        kind: 'ask',
        reason: 'Launching a Minecraft client or dedicated server requires explicit user approval.',
      }
    })
    return dispose
  }, 'tool-mc-project.runtime-approval')
  ctx.tools.register(defineTool({
    name: DETECT_MC_PROJECT,
    description: 'Inspect the current workspace and return structured Minecraft mod project facts: loader, loader support status, Minecraft version, mappings, mod id candidates, languages, source sets, resource roots, mixins, datagen clues, and recommended Gradle validation commands. Fabric and NeoForge are supported; Forge, Quilt, and Architectury are diagnostic-only. Use this before assuming which Minecraft mod loader or version the repository uses.',
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
    description: 'Validate the current Minecraft mod workspace resources with deterministic static checks: language values, item/block models, blockstates, recipe/tag/loot/advancement JSON structure, bounded PNG checksums, suspicious namespaces, and mod id versus metadata consistency. This does not execute Gradle or emulate Minecraft resource loading.',
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
  ctx.effect(() => {
    const fiber = ctx.inject(['shell'], (shellCtx: Context) => {
      shellCtx.tools.register(defineTool({
        name: RUN_MC_CHECK,
        description: 'Run the appropriate Minecraft Gradle validation for the current workspace. The tool first detects the project with detect_mc_project, chooses Gradle wrapper or gradle commands from the detected loader, discovers custom datagen/runtime tasks when needed, runs each command through the mounted shell executor, and returns structured command results. Targets: build, test, datagen, resources, runtime, all. A runtime target launches the user-approved client or dedicated server and requires runtimeMode.',
        parameters: {
          target: {
            type: 'string',
            required: true,
            description: 'Check to run. resources performs static Minecraft resource validation before Gradle processResources. runtime launches a client or dedicated server only after the user approves it and supplies runtimeMode. all stops at the first failed step.',
            enum: ['build', 'test', 'datagen', 'resources', 'runtime', 'all'],
          },
          runtimeMode: {
            type: 'string',
            enum: ['client', 'server'],
            description: 'Required for target runtime: choose client or dedicated server after user approval.',
          },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds for each Gradle command. The shell executor applies its configured default and cap.',
          },
        },
        output: {
          schema: checkOutputSchema(),
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        execute: (args: RunCheckArgs, exec) => runMcCheck(shellCtx, exec, config, args),
        presentCall: args => ({ card: 'generic', title: `Run Minecraft check: ${args.target}`, kind: 'execute' }),
        presentResult: (_args, result: ToolResult) => ({
          card: 'generic',
          title: 'Minecraft check result',
          content: result.content,
        }),
      }))
    })
    return fiber.dispose
  }, 'tool-mc-project.run_mc_check')
}
