/** Run repeated live-model mcmod tasks from one immutable NeoForge MDK baseline. */

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { execa } from 'execa'
import { parseEfficiencyMetrics, type EfficiencyMetrics } from '@deepseek-ai/dsh-loader-smoke'
import { decompressZstdFrame, scanZstdFrames } from '../packages/session/session-persistence-jsonl/src/zstd.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_BIN = join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts')
const TSCONFIG = join(REPO_ROOT, 'tsconfig.json')
const OMITTED_DIRS = new Set(['.git', '.gradle', '.dsh', '.sessions', 'build'])
const ENVIRONMENT_UNAVAILABLE = new RegExp([
  'JAVA_HOME',
  'java.*(?:not found|could not be located)',
  'gradle.*(?:not found|could not be located)',
  'could not download',
  'network.*unavailable',
  'access is denied',
  'permission denied',
  'unable to start',
].join('|'), 'iu')
const RUNTIME_FAILURE = new RegExp([
  'Failed!',
  'GameTest.*(?:failed|error)',
  'required tests failed',
  'Test failed',
  'ModLoadingException',
  'Failed to start the minecraft server',
  '\\bFATAL\\b',
  'crash-report',
].join('|'), 'iu')

/** Repository-owned source for the three standard benchmark prompts. */
export const DEFAULT_BENCHMARK_PROMPT_SOURCE = join(REPO_ROOT, 'scripts', 'fixtures', 'mcmod-agent-benchmark-prompts.md')

export type ScenarioId = 'accuracy' | 'speed' | 'complex'

export interface BenchmarkPrompt {
  id: ScenarioId
  name: string
  text: string
  acceptanceTotal: number
}

export interface AcceptanceCheck {
  name: string
  passed: boolean
  evidence: string
}

export interface AcceptanceResult {
  checks: AcceptanceCheck[]
  unverified: string[]
}

export interface PriceTable {
  provider?: string
  model?: string
  currency: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  /** Compatibility alias for older price files. */
  cache?: number
  actualCost?: number
  actualCostCurrency?: string
}

interface TimelineMetrics {
  steps: number
  toolFailures: number
  averageToolDurationMs?: number
  ttftMs?: number
  buildAttempts: number
  firstBuildSuccessMs?: number
}

interface BuildResult {
  passed: boolean
  environmentUnavailable: boolean
  durationMs: number
  exitCode: number | null
  timedOut: boolean
}

export type BenchmarkVerdict = 'passed' | 'failed' | 'inconclusive'

export interface SessionCapture {
  status: 'captured' | 'empty' | 'failed'
  fileCount: number
  eventCount: number
  error?: string
}

export interface RuntimeResult {
  status: 'passed' | 'failed' | 'environment_unavailable' | 'not_run'
  durationMs: number
  exitCode: number | null
  timedOut: boolean
  checks: AcceptanceCheck[]
  error?: string
}

export interface AgentClaims {
  verifiedSection: boolean
  unverifiedSection: boolean
  commandMentionCount: number
}

interface RunResult {
  scenario: ScenarioId
  scenarioName: string
  run: number
  automatedSuccess: boolean
  verdict: BenchmarkVerdict
  acceptancePassed: number
  acceptanceTotal: number
  acceptance: AcceptanceResult
  agentExitCode: number | null
  agentTimedOut: boolean
  durationMs: number
  build: BuildResult
  efficiency: EfficiencyMetrics
  timeline: TimelineMetrics
  sessionCapture: SessionCapture
  runtime: RuntimeResult
  agentClaims: AgentClaims
  usage: EfficiencyMetrics['tokens']
  estimatedCost?: number
  workspace: string
}

interface ReportMeta {
  agentLabel: string
  gitRevision: string
  dirty: boolean
  baselineDigest: string
  runs: number
  agentPatches: string[]
  baselineBuildDurationMs: number
  prices?: PriceTable
  actualCost?: number
  actualCostCurrency?: string
}

interface Options {
  fixture: string
  promptSource: string
  runs: number
  output: string
  agentLabel: string
  allowDirty: boolean
  agentTimeoutMs: number
  buildTimeoutMs: number
  runtimeTimeoutMs: number
  prices?: PriceTable
  actualCost?: number
  actualCostCurrency?: string
  agentPatches: string[]
}

interface SessionRecord {
  type?: unknown
  time?: unknown
  data?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Extract the three runnable tasks from a numbered benchmark prompt source. */
export function parseBenchmarkPrompts(source: string): BenchmarkPrompt[] {
  const heading = /^###\s+([123])\.\s+(.+)$/gmu
  const matches = [...source.matchAll(heading)]
  if (matches.length !== 3) throw new Error(`prompt source must contain exactly three numbered level-3 headings, found ${matches.length}`)
  const metadata = [
    { id: 'accuracy', acceptanceTotal: 14 },
    { id: 'speed', acceptanceTotal: 14 },
    { id: 'complex', acceptanceTotal: 27 },
  ] as const satisfies readonly { id: ScenarioId; acceptanceTotal: number }[]
  return matches.map((match, index) => {
    const meta = metadata[index]
    const name = match[2]
    if (meta === undefined || name === undefined) throw new Error(`prompt section ${index + 1} has no benchmark metadata`)
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    const section = source.slice(start, end)
    const promptStart = section.search(/^你正在一个/gmu)
    if (promptStart === -1) throw new Error(`prompt section ${index + 1} does not contain its task opening`)
    let text = section.slice(promptStart).trim()
    if (index === 2) {
      const commentary = text.search(/^这三题的区分度/gmu)
      if (commentary !== -1) text = text.slice(0, commentary).trim()
    }
    return { ...meta, name: name.trim(), text }
  })
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && OMITTED_DIRS.has(entry.name)) continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(root, path))
    else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'))
  }
  return files.sort()
}

async function directoryDigest(root: string): Promise<string> {
  const hash = createHash('sha256')
  for (const path of await walkFiles(root)) {
    hash.update(path).update('\0').update(await readFile(join(root, path))).update('\0')
  }
  return hash.digest('hex')
}

async function copyFixture(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    filter: path => !relative(source, path).split(/[\\/]/u).some(part => OMITTED_DIRS.has(part)),
  })
}

async function readSessionFile(path: string): Promise<string> {
  const content = await readFile(path)
  if (!path.endsWith('.zstd')) return content.toString('utf8')
  const scan = scanZstdFrames(content)
  if (scan.tornStart !== undefined) throw new Error(`session log has a torn Zstandard frame: ${path}`)
  const frames: Buffer[] = []
  for (const frame of scan.frames) frames.push(await decompressZstdFrame(content.subarray(frame.start, frame.end)))
  return Buffer.concat(frames).toString('utf8')
}

/** Read all persisted session frames from the DSH_HOME owned by one run. */
export async function sessionText(dshHome: string): Promise<{ raw: string; fileCount: number }> {
  const root = join(dshHome, 'sessions')
  try {
    const files = (await readdir(root, { recursive: true }))
      .filter(file => file.endsWith('.jsonl') || file.endsWith('.jsonl.zstd'))
      .sort()
    return {
      raw: (await Promise.all(files.map(file => readSessionFile(join(root, file))))).join('\n'),
      fileCount: files.length,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { raw: '', fileCount: 0 }
    throw error
  }
}

function redactSecrets(text: string): string {
  return text
    .replaceAll(/(DEEPSEEK_API_KEY\s*[=:]\s*)([^\s"'&,}]+)/giu, '$1[REDACTED]')
    .replaceAll(/(sk-[a-z0-9_-]{12,})/giu, '[REDACTED]')
}

function sessionCapture(raw: string, fileCount: number, error?: string): SessionCapture {
  if (error !== undefined) return { status: 'failed', fileCount, eventCount: 0, error }
  const eventCount = parseRecords(raw).length
  return { status: raw.trim() === '' ? 'empty' : 'captured', fileCount, eventCount }
}

function parseAgentClaims(text: string): AgentClaims {
  return {
    verifiedSection: /(?:^|\n)\s*(?:#+\s*)?verified\b/imu.test(text),
    unverifiedSection: /(?:^|\n)\s*(?:#+\s*)?unverified\b/imu.test(text),
    commandMentionCount: (text.match(/(?:gradlew|pnpm|npm|runGameTestServer|build)/giu) ?? []).length,
  }
}

function parseRecords(raw: string): SessionRecord[] {
  return raw.split(/\r?\n/u).flatMap((line) => {
    if (line.trim() === '') return []
    try {
      const value: unknown = JSON.parse(line)
      return isRecord(value) ? [value] : []
    } catch {
      return []
    }
  })
}

function data(record: SessionRecord): Record<string, unknown> {
  return isRecord(record.data) ? record.data : {}
}

function toolResult(record: SessionRecord): { callId?: string; failed: boolean; text: string } | undefined {
  if (record.type !== 'tool/result') return undefined
  const message = data(record).message
  if (!isRecord(message) || !Array.isArray(message.content)) return { failed: true, text: '' }
  const blocks = message.content.filter(isRecord)
  const results = blocks.filter(block => block.type === 'tool-result')
  const source = isRecord(message.source) ? message.source : undefined
  const callId = typeof source?.callId === 'string' ? source.callId : undefined
  return {
    ...callId === undefined ? {} : { callId },
    failed: results.some(result => result.isError === true),
    text: results.flatMap(result => Array.isArray(result.content) ? result.content.filter(isRecord) : [])
      .map(part => typeof part.text === 'string' ? part.text : '').join('\n'),
  }
}

function isBuildCall(record: SessionRecord): boolean {
  if (record.type !== 'tool/call') return false
  const row = data(record)
  const name = typeof row.name === 'string' ? row.name.toLowerCase() : ''
  const args = typeof row.arguments === 'string' ? row.arguments : JSON.stringify(row.arguments ?? {})
  return (name === 'run_mc_check' && /"target"\s*:\s*"build"/iu.test(args))
    || (/(?:bash|pwsh|shell)/u.test(name) && /gradlew(?:\.bat)?[^\n]*\bbuild\b/iu.test(args))
}

/** Fold timing, failure, build-attempt, and step evidence from a persisted session. */
export function parseTimelineMetrics(raw: string): TimelineMetrics {
  const records = parseRecords(raw)
  const prompt = records.find((record) => {
    const source = data(record).source
    return record.type === 'user/message' && isRecord(source) && source.kind === 'user'
  })
  const firstChunk = records.find(record => record.type === 'assistant/chunk' && finiteNumber(record.time) !== undefined)
  const firstChunkTime = finiteNumber(firstChunk?.time)
  const promptTime = finiteNumber(prompt?.time)
  const callTimes = new Map<string, number>()
  const buildCalls = new Map<string, number>()
  const durations: number[] = []
  let toolFailures = 0
  let firstBuildSuccessMs: number | undefined
  for (const record of records) {
    if (record.type === 'tool/call') {
      const callId = data(record).callId
      const time = finiteNumber(record.time)
      if (typeof callId === 'string' && time !== undefined) {
        callTimes.set(callId, time)
        if (isBuildCall(record)) buildCalls.set(callId, time)
      }
      continue
    }
    const result = toolResult(record)
    if (result === undefined) continue
    if (result.failed) toolFailures++
    const resultTime = finiteNumber(record.time)
    const callTime = result.callId === undefined ? undefined : callTimes.get(result.callId)
    if (resultTime !== undefined && callTime !== undefined) durations.push(Math.max(0, resultTime - callTime))
    const buildTime = result.callId === undefined ? undefined : buildCalls.get(result.callId)
    if (!result.failed && /(?:BUILD SUCCESSFUL|"exitCode"\s*:\s*0)/iu.test(result.text)
      && buildTime !== undefined && promptTime !== undefined && firstBuildSuccessMs === undefined) {
      firstBuildSuccessMs = Math.max(0, (resultTime ?? buildTime) - promptTime)
    }
  }
  return {
    steps: records.filter(record => record.type === 'step/start').length,
    toolFailures,
    ...durations.length === 0 ? {} : { averageToolDurationMs: durations.reduce((a, b) => a + b, 0) / durations.length },
    ...promptTime === undefined || firstChunkTime === undefined
      ? {}
      : { ttftMs: Math.max(0, firstChunkTime - promptTime) },
    buildAttempts: buildCalls.size,
    ...firstBuildSuccessMs === undefined ? {} : { firstBuildSuccessMs },
  }
}

interface ProjectIndex {
  paths: string[]
  text: string
  byPath: Map<string, string>
}

async function projectIndex(root: string): Promise<ProjectIndex> {
  const paths = await walkFiles(root)
  const byPath = new Map<string, string>()
  for (const path of paths) {
    if (/\.(?:java|json|toml|gradle|properties|mcmeta)$/u.test(path)) {
      byPath.set(path, await readFile(join(root, path), 'utf8'))
    }
  }
  return { paths, byPath, text: [...byPath.values()].join('\n') }
}

function check(name: string, passed: boolean, evidence: string): AcceptanceCheck {
  return { name, passed, evidence }
}

function pathsMatching(index: ProjectIndex, pattern: RegExp): string[] {
  return index.paths.filter(path => pattern.test(path))
}

function jsonAt(index: ProjectIndex, pattern: RegExp): unknown[] {
  return pathsMatching(index, pattern).flatMap((path) => {
    try { return [JSON.parse(index.byPath.get(path) ?? '') as unknown] } catch { return [] }
  })
}

function jsonObjects(index: ProjectIndex, pattern: RegExp): Array<{ path: string; value: Record<string, unknown> }> {
  return pathsMatching(index, pattern).flatMap((path) => {
    try {
      const value: unknown = JSON.parse(index.byPath.get(path) ?? '')
      return isRecord(value) ? [{ path, value }] : []
    } catch {
      return []
    }
  })
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function recipeCount(index: ProjectIndex): number {
  return pathsMatching(index, /data\/[^/]+\/recipes?\/.*\.json$/u).length
}

function evaluateAccuracy(index: ProjectIndex): AcceptanceResult {
  const recipes = jsonAt(index, /data\/agent_accuracy_test\/recipes?\/.*\.json$/u)
  const recipe = recipes.find(isRecord)
  const recipeResult = isRecord(recipe) ? recipe.result : undefined
  const text = index.text
  return {
    checks: [
      check('mod id and Java package', text.includes('agent_accuracy_test') && text.includes('com.example.agentaccuracy'), 'source contains the fixed identifiers'),
      check('position_recorder registration', text.includes('position_recorder') && /DeferredRegister/u.test(text), 'registered item id and DeferredRegister'),
      check('RecordedPosition fields', /RecordedPosition/u.test(text) && /dimension/u.test(text) && /\b[xyz]\b/u.test(text), 'record type and coordinates are present'),
      check('persistent Data Component codec', /DataComponentType/u.test(text) && /persistent|codec/iu.test(text), 'DataComponentType and codec evidence'),
      check('network Data Component codec', /networkSynchroniz|streamCodec/iu.test(text), 'network codec evidence'),
      check('no ItemStack custom NBT', /RecordedPosition/u.test(text)
        && !/(?:getOrCreateTag|CompoundTag.*(?:recorded|position)|getTag\s*\()/isu.test(text),
      'RecordedPosition exists and forbidden ItemStack NBT APIs are absent'),
      check('server-authoritative block interaction', /useOn\s*\(/u.test(text) && /isClientSide/u.test(text) && /\.set\s*\(/u.test(text), 'useOn guards server-side component mutation'),
      check('sneak air-use clear path', /use\s*\(/u.test(text) && /shift|crouch|secondary/iu.test(text) && /remove\s*\(/u.test(text), 'air use removes the component while sneaking'),
      check('tooltip and both locales', /appendHoverText/u.test(text) && pathsMatching(index, /assets\/agent_accuracy_test\/lang\/(?:en_us|zh_cn)\.json$/u).length === 2, 'tooltip hook and two locale files'),
      check('fixed shaped recipe', isRecord(recipe) && recipe.type === 'minecraft:crafting_shaped'
        && isRecord(recipeResult) && recipeResult.item === 'agent_accuracy_test:position_recorder'
        && recipeResult.count === 1, 'recipe JSON has the exact shaped output'),
      check('item model reuses amethyst shard', jsonAt(index, /assets\/agent_accuracy_test\/models\/item\/position_recorder\.json$/u).some(value => JSON.stringify(value).includes('minecraft:item/amethyst_shard')), 'item model layer0'),
      check('creative tools tab', /TOOLS_AND_UTILITIES/u.test(text), 'creative tab event references TOOLS_AND_UTILITIES'),
    ],
    unverified: ['Minecraft loads the mod', 'in-game record/overwrite/tooltip/reload behavior', 'Dedicated Server class loading', 'absence of unrelated gameplay'],
  }
}

const DENSE_IDS = ['coal', 'iron', 'gold', 'copper', 'redstone', 'lapis', 'diamond', 'emerald'].map(name => `dense_${name}_block`)

function evaluateSpeed(index: ProjectIndex): AcceptanceResult {
  const text = index.text
  const allIds = DENSE_IDS.every(id => text.includes(id))
  const blockstates = pathsMatching(index, /assets\/agent_speed_test\/blockstates\/dense_.*\.json$/u)
  const blockModels = pathsMatching(index, /assets\/agent_speed_test\/models\/block\/dense_.*\.json$/u)
  const itemModels = pathsMatching(index, /assets\/agent_speed_test\/models\/item\/dense_.*\.json$/u)
  const loot = pathsMatching(index, /data\/agent_speed_test\/loot_tables?\/blocks\/dense_.*\.json$/u)
  const recipes = pathsMatching(index, /data\/agent_speed_test\/recipes?\/.*\.json$/u)
  const pickaxeTag = jsonObjects(index, /data\/minecraft\/tags\/block\/mineable\/pickaxe\.json$/u)[0]?.value
  const stoneTag = jsonObjects(index, /data\/minecraft\/tags\/block\/needs_stone_tool\.json$/u)[0]?.value
  const ironTag = jsonObjects(index, /data\/minecraft\/tags\/block\/needs_iron_tool\.json$/u)[0]?.value
  const tagged = (value: Record<string, unknown> | undefined, ids: string[]): boolean => {
    const values = stringArray(value?.values)
    return ids.every(id => values.includes(`agent_speed_test:${id}`))
  }
  return {
    checks: [
      check('fixed identifiers', text.includes('agent_speed_test') && text.includes('com.example.agentspeed'), 'source contains the fixed identifiers'),
      check('exact eight block ids', allIds && new Set(DENSE_IDS.filter(id => text.includes(id))).size === 8, 'all required ids are present'),
      check('DeferredRegister block and item wiring', /DeferredRegister/u.test(text) && /BlockItem/u.test(text), 'block and BlockItem registration evidence'),
      check('building blocks creative tab', /BUILDING_BLOCKS/u.test(text), 'creative tab reference'),
      check('eight blockstates', blockstates.length === 8, `${blockstates.length}/8`),
      check('eight cube_all block models', blockModels.length === 8 && blockModels.every((path) => {
        const value = jsonObjects(index, new RegExp(`^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'))[0]?.value
        return value?.parent === 'minecraft:block/cube_all' && isRecord(value.textures)
          && Object.values(value.textures).every(texture => typeof texture === 'string' && texture.startsWith('minecraft:block/'))
      }), `${blockModels.length}/8`),
      check('eight inherited item models', itemModels.length === 8 && itemModels.every((path) => {
        const value = jsonObjects(index, new RegExp(`^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'))[0]?.value
        return typeof value?.parent === 'string' && value.parent.includes('block/dense_')
      }), `${itemModels.length}/8`),
      check('eight self-drop loot tables', loot.length === 8 && loot.every((path) => {
        const value = jsonObjects(index, new RegExp(`^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'))[0]?.value
        return Array.isArray(value?.pools)
      }), `${loot.length}/8`),
      check('sixteen recipes', recipes.length === 16 && recipes.every((path) => {
        const value = jsonObjects(index, new RegExp(`^${path.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'))[0]?.value
        return typeof value?.type === 'string' && isRecord(value.result)
      }), `${recipes.length}/16`),
      check('pickaxe mining tag', pathsMatching(index, /data\/minecraft\/tags\/block\/mineable\/pickaxe\.json$/u).length === 1
        && tagged(pickaxeTag, DENSE_IDS), 'pickaxe tag contains exactly the required blocks'),
      check('stone and iron requirement tags', pathsMatching(index, /data\/minecraft\/tags\/block\/needs_(?:stone|iron)_tool\.json$/u).length === 2
        && tagged(stoneTag, ['dense_coal_block', 'dense_copper_block', 'dense_iron_block'])
        && tagged(ironTag, ['dense_gold_block', 'dense_redstone_block', 'dense_lapis_block', 'dense_diamond_block', 'dense_emerald_block']), 'tool tags contain the required groups'),
      check('both locale files', pathsMatching(index, /assets\/agent_speed_test\/lang\/(?:en_us|zh_cn)\.json$/u).length === 2, 'en_us and zh_cn'),
      check('no PNG or data generator', allIds && pathsMatching(index, /\.png$/u).length === 0
        && !/DataGenerator|GatherDataEvent/u.test(text), 'all blocks exist and forbidden generated assets/features are absent'),
    ],
    unverified: ['Minecraft rendering has no missing model or texture'],
  }
}

function evaluateComplex(index: ProjectIndex): AcceptanceResult {
  const text = index.text
  const recipeJson = jsonAt(index, /data\/agent_complex_test\/recipes?\/resonating_echo_shard\.json$/u)
  const checks: AcceptanceCheck[] = [
    check('fixed identifiers', text.includes('agent_complex_test') && text.includes('com.example.agentcomplex'), 'source contains the fixed identifiers'),
    check('block and BlockItem registration', text.includes('resonance_processor') && /DeferredRegister/u.test(text) && /BlockItem/u.test(text), 'registry evidence'),
    check('BlockEntity and three-slot handler', /BlockEntity/u.test(text)
      && (/ItemStackHandler\s*\(\s*3\s*\)/u.test(text)
        || (/ItemStackHandler\s*\(\s*SLOT_COUNT\s*\)/u.test(text) && /SLOT_COUNT\s*=\s*3/u.test(text))), 'three-slot ItemStackHandler'),
    check('Menu and Screen', /AbstractContainerMenu/u.test(text) && /AbstractContainerScreen/u.test(text), 'menu and screen classes'),
    check('player inventory and quickMoveStack', /quickMoveStack/u.test(text) && /Inventory/u.test(text), 'menu transfer implementation'),
    check('custom recipe type and serializer', /RecipeType/u.test(text) && /RecipeSerializer/u.test(text) && /resonance_processing/u.test(text), 'registered recipe pair'),
    check('MapCodec and StreamCodec', /MapCodec/u.test(text) && /StreamCodec/u.test(text), '1.21.1 serialization APIs'),
    check('custom RecipeInput', /RecipeInput/u.test(text), 'recipe input type'),
    check('fixed recipe JSON', recipeJson.some((value) => {
      const raw = JSON.stringify(value)
      return raw.includes('minecraft:amethyst_shard') && raw.includes('minecraft:redstone') && raw.includes('minecraft:echo_shard') && raw.includes('100')
    }), 'two inputs, echo shard, 100 ticks'),
    check('server ticker', /getTicker|createTickerHelper|serverTick/iu.test(text) && /isClientSide/u.test(text), 'server tick evidence'),
    check('progress reset and enabled state', /progress\s*=\s*0/u.test(text) && /enabled/u.test(text), 'machine state logic'),
    check('output capacity guard', /getMaxStackSize|isSameItemSameComponents|can.*output/iu.test(text), 'output compatibility/capacity evidence'),
    check('inventory/progress/enabled persistence', /saveAdditional/u.test(text) && /loadAdditional/u.test(text) && /progress/u.test(text) && /enabled/u.test(text), 'BlockEntity save/load'),
    check('GUI data synchronization', /ContainerData|DataSlot/u.test(text), 'server menu data channel'),
    check('C2S payload registration', /CustomPacketPayload/u.test(text) && /StreamCodec/u.test(text) && /RegisterPayloadHandlersEvent|PayloadRegistrar/u.test(text), 'payload type and registration'),
    check('payload validation', /distanceToSqr|stillValid|containerMenu|blockPosition/iu.test(text), 'menu/position/distance validation evidence'),
    check('ItemHandler block capability', /RegisterCapabilitiesEvent/u.test(text) && /Capabilities\.ItemHandler\.BLOCK/u.test(text), 'NeoForge capability provider'),
    check('directional capability policy', /Direction\.UP/u.test(text) && /Direction\.DOWN/u.test(text), 'top and bottom handlers'),
    check('blockstate, models, loot and locales', pathsMatching(index, /assets\/agent_complex_test\/blockstates\/resonance_processor\.json$/u).length === 1
      && pathsMatching(index, /assets\/agent_complex_test\/models\/(?:block|item)\/resonance_processor\.json$/u).length === 2
      && pathsMatching(index, /data\/agent_complex_test\/loot_tables?\/blocks\/resonance_processor\.json$/u).length === 1
      && pathsMatching(index, /assets\/agent_complex_test\/lang\/(?:en_us|zh_cn)\.json$/u).length === 2, 'required static resources'),
    check('machine crafting recipe', recipeCount(index) >= 2 && jsonAt(index, /data\/agent_complex_test\/recipes?\/(?!resonating_echo_shard).*\.json$/u).some(value => isRecord(value) && value.type === 'minecraft:crafting_shaped'), 'separate shaped machine recipe'),
    check('functional blocks creative tab', /FUNCTIONAL_BLOCKS/u.test(text), 'creative tab reference'),
    check('client registration is distribution-scoped', /Dist\.CLIENT|value\s*=\s*Dist\.CLIENT|DistExecutor/u.test(text), 'client-only screen registration evidence'),
  ]
  return {
    checks,
    unverified: ['Minecraft loads and places the block', 'GUI opens and renders correctly', '100-tick processing while GUI is closed', 'runtime output-full and invalid-input behavior', 'world reload persistence', 'hopper capability behavior', 'shift-click item conservation', 'Dedicated Server class loading and missing-texture checks'],
  }
}

/** Evaluate source/resource evidence without trusting the agent's final response. */
export async function evaluateProject(root: string, scenario: ScenarioId): Promise<AcceptanceResult> {
  const index = await projectIndex(root)
  switch (scenario) {
    case 'accuracy': return evaluateAccuracy(index)
    case 'speed': return evaluateSpeed(index)
    case 'complex': return evaluateComplex(index)
  }
}

function commandForBatch(file: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: file, args }
  const command = process.env.ComSpec ?? 'cmd.exe'
  const quoted = [file, ...args].map(value => /[\s"&|<>^]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value).join(' ')
  return { command, args: ['/d', '/s', '/c', quoted] }
}

async function independentBuild(workspace: string, timeout: number, artifactDir: string): Promise<BuildResult> {
  const wrapper = process.platform === 'win32' ? join(workspace, 'gradlew.bat') : join(workspace, 'gradlew')
  const invocation = commandForBatch(wrapper, ['clean', 'build', '--no-daemon'])
  const startedAt = performance.now()
  const result = await execa(invocation.command, invocation.args, {
    cwd: workspace, reject: false, timeout, killSignal: 'SIGKILL',
  })
  await writeFile(join(artifactDir, 'independent-build.stdout.txt'), result.stdout)
  await writeFile(join(artifactDir, 'independent-build.stderr.txt'), result.stderr)
  const output = `${result.stdout}\n${result.stderr}`
  const environmentUnavailable = ENVIRONMENT_UNAVAILABLE.test(output)
  return {
    passed: result.exitCode === 0 && !result.timedOut,
    environmentUnavailable,
    durationMs: performance.now() - startedAt,
    exitCode: result.exitCode ?? null,
    timedOut: result.timedOut,
  }
}

export function runtimeSource(prompt: BenchmarkPrompt): string {
  const namespace = prompt.id === 'accuracy' ? 'agent_accuracy_test' : prompt.id === 'speed' ? 'agent_speed_test' : 'agent_complex_test'
  const javaPackage = prompt.id === 'accuracy' ? 'com.example.agentaccuracy' : prompt.id === 'speed' ? 'com.example.agentspeed' : 'com.example.agentcomplex'
  const methods = prompt.id === 'accuracy'
    ? `@PrefixGameTestTemplate(false)
    @GameTest(templateNamespace = "${namespace}", template = "empty", timeoutTicks = 100)
    public static void positionRecorderBehavior(GameTestHelper helper) {
        Item item = BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath("${namespace}", "position_recorder"));
        helper.assertTrue(item != Items.AIR, "position_recorder is not registered");
        DataComponentType<?> component = BuiltInRegistries.DATA_COMPONENT_TYPE.get(ResourceLocation.fromNamespaceAndPath("${namespace}", "recorded_position"));
        helper.assertTrue(component != null, "recorded_position component is not registered");
        BlockPos pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, Blocks.STONE.defaultBlockState());
        Player player = helper.makeMockPlayer(GameType.SURVIVAL);
        ItemStack stack = new ItemStack(item);
        player.setItemInHand(InteractionHand.MAIN_HAND, stack);
        BlockPos absolute = helper.absolutePos(pos);
        item.useOn(new UseOnContext(player, InteractionHand.MAIN_HAND, new BlockHitResult(Vec3.atCenterOf(absolute), Direction.UP, absolute, false)));
        helper.assertTrue(stack.has(component), "useOn did not record a data component");
        player.setShiftKeyDown(true);
        item.use(helper.getLevel(), player, InteractionHand.MAIN_HAND);
        helper.assertTrue(!stack.has(component), "sneak air use did not clear the component");
        helper.succeed();
    }
`
    : prompt.id === 'speed'
      ? `@PrefixGameTestTemplate(false)
    @GameTest(templateNamespace = "${namespace}", template = "empty", timeoutTicks = 100)
    public static void registeredBlocks(GameTestHelper helper) {
        String[] ids = {"coal", "iron", "gold", "copper", "redstone", "lapis", "diamond", "emerald"};
        for (String id : ids) {
            helper.assertTrue(BuiltInRegistries.BLOCK.get(ResourceLocation.fromNamespaceAndPath("${namespace}", "dense_" + id + "_block")) != Blocks.AIR, "missing dense block " + id);
        }
        Block block = BuiltInRegistries.BLOCK.get(ResourceLocation.fromNamespaceAndPath("${namespace}", "dense_coal_block"));
        BlockPos pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, block.defaultBlockState());
        helper.assertBlockPresent(block, pos);
        helper.succeed();
    }
`
      : `@PrefixGameTestTemplate(false)
    @GameTest(templateNamespace = "${namespace}", template = "empty", timeoutTicks = 160)
    public static void processorBehavior(GameTestHelper helper) {
        Block block = BuiltInRegistries.BLOCK.get(ResourceLocation.fromNamespaceAndPath("${namespace}", "resonance_processor"));
        helper.assertTrue(block != Blocks.AIR, "resonance_processor is not registered");
        helper.assertTrue(BuiltInRegistries.ITEM.get(ResourceLocation.fromNamespaceAndPath("${namespace}", "resonance_processor")) != Items.AIR, "resonance processor item is not registered");
        helper.assertTrue(helper.getLevel().getServer().getRecipeManager().byKey(ResourceLocation.fromNamespaceAndPath("${namespace}", "resonating_echo_shard")).isPresent(), "processing recipe is not loaded");
        BlockPos pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, block.defaultBlockState());
        BlockEntity entity = helper.getBlockEntity(pos);
        helper.assertTrue(entity instanceof Container, "processor does not expose a three-slot container");
        Container container = (Container) entity;
        helper.assertValueEqual(container.getContainerSize(), 3, "machine slot count");
        IItemHandler top = helper.getLevel().getCapability(Capabilities.ItemHandler.BLOCK, helper.absolutePos(pos), Direction.UP);
        IItemHandler bottom = helper.getLevel().getCapability(Capabilities.ItemHandler.BLOCK, helper.absolutePos(pos), Direction.DOWN);
        IItemHandler side = helper.getLevel().getCapability(Capabilities.ItemHandler.BLOCK, helper.absolutePos(pos), Direction.NORTH);
        helper.assertTrue(top != null && bottom != null && side == null, "directional item capabilities are incorrect");
        helper.assertTrue(top.insertItem(0, new ItemStack(Items.AMETHYST_SHARD), false).isEmpty(), "top input A rejected");
        helper.assertTrue(top.insertItem(1, new ItemStack(Items.REDSTONE), false).isEmpty(), "top input B rejected");
        helper.runAfterDelay(110, () -> {
            helper.assertTrue(!container.getItem(2).isEmpty() && container.getItem(2).is(Items.ECHO_SHARD), "processor did not produce echo shard after 100 ticks");
            helper.assertTrue(container.getItem(0).isEmpty() && container.getItem(1).isEmpty(), "processor did not consume inputs");
            helper.assertTrue(bottom.extractItem(0, 1, true).is(Items.ECHO_SHARD), "bottom capability cannot extract output");
            helper.succeed();
        });
    }
`
  return `package ${javaPackage};

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.Container;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.GameType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.item.context.UseOnContext;
import net.neoforged.neoforge.capabilities.Capabilities;
import net.neoforged.neoforge.items.IItemHandler;
import net.neoforged.neoforge.gametest.GameTestHolder;
import net.neoforged.neoforge.gametest.PrefixGameTestTemplate;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;

@GameTestHolder("${namespace}")
@PrefixGameTestTemplate(false)
public final class BenchmarkRuntimeGameTests {
    private BenchmarkRuntimeGameTests() {}

    ${methods}
}
`
}

export async function injectRuntimeTest(workspace: string, prompt: BenchmarkPrompt): Promise<string> {
  // Older agent attempts can leave a same-named benchmark helper in another package.
  // Remove only that generated filename so stale registrations cannot affect this run.
  const sourceRoot = join(workspace, 'src', 'main', 'java')
  for (const path of await walkFiles(sourceRoot)) {
    if (path.endsWith('/BenchmarkRuntimeGameTests.java')) await rm(join(sourceRoot, path), { force: true })
  }
  const packagePath = prompt.id === 'accuracy' ? ['com', 'example', 'agentaccuracy'] : prompt.id === 'speed' ? ['com', 'example', 'agentspeed'] : ['com', 'example', 'agentcomplex']
  const sourcePath = join(workspace, 'src', 'main', 'java', ...packagePath, 'BenchmarkRuntimeGameTests.java')
  await mkdir(dirname(sourcePath), { recursive: true })
  await writeFile(sourcePath, runtimeSource(prompt), 'utf8')
  const namespace = prompt.id === 'accuracy' ? 'agent_accuracy_test' : prompt.id === 'speed' ? 'agent_speed_test' : 'agent_complex_test'
  const structurePath = join(workspace, 'src', 'main', 'resources', 'data', namespace, 'structures', 'empty.nbt')
  await mkdir(dirname(structurePath), { recursive: true })
  await writeFile(structurePath, gzipSync(emptyStructureNbt()))
  // NeoForge's IDE test source also checks the game-directory SNBT override.
  const testStructureText = '{DataVersion:3953,size:[3,1,1],palette:[{Name:"minecraft:air"}],blocks:[],entities:[]}'
  for (const testStructurePath of [
    join(workspace, 'gameteststructures', 'empty.snbt'),
    join(workspace, 'run', 'gameteststructures', 'empty.snbt'),
  ]) {
    await mkdir(dirname(testStructurePath), { recursive: true })
    await writeFile(testStructurePath, testStructureText, 'utf8')
  }
  return sourcePath
}

async function configureRuntimeNamespaces(workspace: string, namespace: string): Promise<void> {
  const path = join(workspace, 'build.gradle')
  const source = await readFile(path, 'utf8')
  const configured = source.replaceAll("systemProperty 'neoforge.enabledGameTestNamespaces', project.mod_id", `systemProperty 'neoforge.enabledGameTestNamespaces', 'minecraft,${namespace}'`)
  await writeFile(path, configured, 'utf8')
}

function emptyStructureNbt(): Buffer {
  const chunks: Buffer[] = []
  const byte = (value: number) => chunks.push(Buffer.from([value]))
  const short = (value: number) => { const b = Buffer.alloc(2); b.writeInt16BE(value); chunks.push(b) }
  const int = (value: number) => { const b = Buffer.alloc(4); b.writeInt32BE(value); chunks.push(b) }
  const name = (value: string) => { const b = Buffer.from(value); short(b.length); chunks.push(b) }
  const stringTag = (key: string, value: string) => { byte(8); name(key); name(value) }
  const intList = (key: string, values: number[]) => {
    byte(9); name(key); byte(3); int(values.length); for (const value of values) int(value)
  }
  byte(10); short(0)
  byte(3); name('DataVersion'); int(3953)
  intList('size', [3, 1, 1])
  byte(9); name('palette'); byte(10); int(1); stringTag('Name', 'minecraft:air'); byte(0)
  byte(9); name('blocks'); byte(10); int(0)
  byte(9); name('entities'); byte(10); int(0)
  byte(0)
  return Buffer.concat(chunks)
}

export async function runRuntime(workspace: string, timeout: number, artifactDir: string): Promise<RuntimeResult> {
  await mkdir(artifactDir, { recursive: true })
  const wrapper = process.platform === 'win32' ? join(workspace, 'gradlew.bat') : join(workspace, 'gradlew')
  const runtimeArgs = ['runGameTestServer', '--no-daemon', '--console=plain']
  const invocation = process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/c', wrapper, ...runtimeArgs] }
    : commandForBatch(wrapper, runtimeArgs)
  const startedAt = performance.now()
  try {
    const result = await execa(invocation.command, invocation.args, {
      cwd: workspace, reject: false, timeout, killSignal: 'SIGKILL',
    })
    await writeFile(join(artifactDir, 'runtime.stdout.txt'), redactSecrets(result.stdout))
    await writeFile(join(artifactDir, 'runtime.stderr.txt'), redactSecrets(result.stderr))
    const output = `${result.stdout}\n${result.stderr}`
    const failed = RUNTIME_FAILURE.test(output)
    const environmentUnavailable = ENVIRONMENT_UNAVAILABLE.test(output)
    const status = environmentUnavailable ? 'environment_unavailable' : result.timedOut || result.exitCode !== 0 || failed ? 'failed' : 'passed'
    return {
      status,
      durationMs: performance.now() - startedAt,
      exitCode: result.exitCode ?? null,
      timedOut: result.timedOut,
      checks: [check('server GameTest process', status === 'passed', status === 'passed' ? 'runGameTestServer completed without failures' : status === 'environment_unavailable' ? 'runtime environment was unavailable' : 'runtime process reported failure')],
      ...status !== 'passed' ? { error: status === 'environment_unavailable' ? 'runtime environment unavailable' : result.timedOut ? 'runtime timed out' : failed ? 'runtime output reported a crash or test failure' : `runtime exited with ${String(result.exitCode)}` } : {},
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(join(artifactDir, 'runtime.stdout.txt'), '')
    await writeFile(join(artifactDir, 'runtime.stderr.txt'), redactSecrets(message))
    return {
      status: 'environment_unavailable',
      durationMs: performance.now() - startedAt,
      exitCode: null,
      timedOut: false,
      checks: [check('server GameTest process', false, message)],
      error: message,
    }
  }
}

export function estimateCost(metrics: EfficiencyMetrics, prices: PriceTable | undefined): number | undefined {
  if (prices === undefined) return undefined
  const pairs = [
    [metrics.tokens.input, prices.input],
    [metrics.tokens.output, prices.output],
    [metrics.tokens.cacheRead, prices.cacheRead ?? prices.cache],
    [metrics.tokens.cacheWrite, prices.cacheWrite],
    [metrics.tokens.reasoning, prices.reasoning],
  ] as const
  if (pairs.every(([tokens, price]) => tokens === undefined || price === undefined)) return undefined
  return pairs.reduce((sum, [tokens, price]) => sum + (tokens ?? 0) * (price ?? 0) / 1_000_000, 0)
}

async function runOne(options: Options, prompt: BenchmarkPrompt, run: number, baselineDigest: string): Promise<RunResult> {
  const runRoot = join(options.output, 'runs', prompt.id, String(run))
  const workspace = join(runRoot, 'workspace')
  const control = join(runRoot, 'control')
  await mkdir(control, { recursive: true })
  await copyFixture(options.fixture, workspace)
  const copiedDigest = await directoryDigest(workspace)
  if (copiedDigest !== baselineDigest) throw new Error(`${prompt.id} run ${run}: copied fixture digest differs from baseline`)

  const tsxLoader = import.meta.resolve('tsx/esm')
  const startedAt = performance.now()
  const patchArgs = options.agentPatches.flatMap(path => ['--patch', path])
  const agent = await execa(process.execPath, ['--import', tsxLoader, DSH_BIN, '--profile', 'mcmod', ...patchArgs, prompt.text], {
    cwd: workspace,
    reject: false,
    timeout: options.agentTimeoutMs,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      DSH_HOME: join(control, 'dsh-home'),
      DSH_AGENTS_HOME: join(control, 'agents-home'),
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
      TSX_TSCONFIG_PATH: TSCONFIG,
    },
  })
  const durationMs = performance.now() - startedAt
  await writeFile(join(runRoot, 'agent.stdout.txt'), agent.stdout)
  await writeFile(join(runRoot, 'agent.stderr.txt'), agent.stderr)

  let session: { raw: string; fileCount: number }
  let captureError: string | undefined
  try {
    session = await sessionText(join(control, 'dsh-home'))
  } catch (error) {
    session = { raw: '', fileCount: 0 }
    captureError = error instanceof Error ? error.message : String(error)
  }
  await writeFile(join(runRoot, 'session.jsonl'), redactSecrets(session.raw))
  const capture = sessionCapture(session.raw, session.fileCount, captureError)
  const efficiency = parseEfficiencyMetrics(session.raw)
  const timeline = parseTimelineMetrics(session.raw)
  const acceptance = await evaluateProject(workspace, prompt.id)
  await injectRuntimeTest(workspace, prompt)
  await configureRuntimeNamespaces(workspace, prompt.id === 'accuracy' ? 'agent_accuracy_test' : prompt.id === 'speed' ? 'agent_speed_test' : 'agent_complex_test')
  const build = await independentBuild(workspace, options.buildTimeoutMs, runRoot)
  const runtime = build.passed
    ? await runRuntime(workspace, options.runtimeTimeoutMs, runRoot)
    : {
      status: 'not_run' as const,
      durationMs: 0,
      exitCode: null,
      timedOut: false,
      checks: [check('server GameTest process', false, 'not run because independent build failed')],
    }
  await writeFile(join(runRoot, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`)
  const acceptancePassed = acceptance.checks.filter(item => item.passed).length
  const automatedSuccess = agent.exitCode === 0 && !agent.timedOut && build.passed
    && acceptancePassed === acceptance.checks.length && runtime.status === 'passed'
  const verdict: BenchmarkVerdict = build.environmentUnavailable || runtime.status === 'environment_unavailable'
    ? 'inconclusive'
    : automatedSuccess ? 'passed' : 'failed'
  const estimatedCost = estimateCost(efficiency, options.prices)
  const result: RunResult = {
    scenario: prompt.id,
    scenarioName: prompt.name,
    run,
    automatedSuccess,
    verdict,
    acceptancePassed,
    acceptanceTotal: acceptance.checks.length,
    acceptance,
    agentExitCode: agent.exitCode ?? null,
    agentTimedOut: agent.timedOut,
    durationMs,
    build,
    efficiency,
    timeline,
    sessionCapture: capture,
    runtime,
    agentClaims: parseAgentClaims(agent.stdout),
    usage: efficiency.tokens,
    ...estimatedCost === undefined ? {} : { estimatedCost },
    workspace,
  }
  await writeFile(join(runRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function formatMs(value: number | undefined): string {
  return value === undefined ? 'N/A' : `${(value / 1_000).toFixed(2)}s`
}

function tokenTotal(result: RunResult): number | undefined {
  const values = [
    result.efficiency.tokens.input,
    result.efficiency.tokens.output,
    result.efficiency.tokens.cacheRead,
    result.efficiency.tokens.cacheWrite,
    result.efficiency.tokens.reasoning,
  ]
    .filter((value): value is number => value !== undefined)
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0)
}

function tokenBreakdown(result: RunResult): string {
  const tokens = result.efficiency.tokens
  return `in ${tokens.input ?? 'N/A'} / out ${tokens.output ?? 'N/A'} / cache-r ${tokens.cacheRead ?? 'N/A'} / cache-w ${tokens.cacheWrite ?? 'N/A'} / reasoning ${tokens.reasoning ?? 'N/A'}`
}

/** Render the human-readable benchmark report. */
export function renderReport(meta: ReportMeta, results: RunResult[]): string {
  const lines = [
    '# Minecraft Agent Benchmark',
    '',
    `- Agent version: \`${meta.agentLabel}\``,
    `- Harness revision: \`${meta.gitRevision}${meta.dirty ? ' (dirty)' : ''}\``,
    `- Baseline digest: \`${meta.baselineDigest}\``,
    `- Baseline build: passed in ${formatMs(meta.baselineBuildDurationMs)}`,
    `- Agent patches: ${meta.agentPatches.length === 0 ? 'none' : meta.agentPatches.map(path => `\`${path}\``).join(', ')}`,
    `- Repetitions per task: ${meta.runs}`,
    '- Success rule: independent `gradlew build`, benchmark-owned server GameTest, and every automated static check pass.',
    '- Runtime environment failures are reported as `inconclusive`; they are not counted as agent failures.',
    ...meta.prices === undefined ? [] : [`- Price table: ${meta.prices.provider ?? 'unknown provider'} / ${meta.prices.model ?? 'unknown model'} (${meta.prices.currency})`],
    '',
    '## Summary',
    '',
    '| Task | Passed | Failed | Inconclusive | Pass@1 | Pass@3 | Success variance | Avg duration | Avg tokens | Avg tools | Recovery rate |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const scenario of ['accuracy', 'speed', 'complex'] as const) {
    const rows = results.filter(result => result.scenario === scenario)
    const success: number[] = rows.map(row => row.automatedSuccess ? 1 : 0)
    const rate = mean(success)
    const recoverable = rows.filter(row => row.timeline.buildAttempts > 1)
    const recovered = recoverable.filter(row => row.timeline.firstBuildSuccessMs !== undefined)
    const passAt3 = success.slice(0, 3).some(Boolean) ? 1 : 0
    lines.push(`| ${rows[0]?.scenarioName ?? scenario} | ${rows.filter(row => row.verdict === 'passed').length}/${rows.length} | ${rows.filter(row => row.verdict === 'failed').length} | ${rows.filter(row => row.verdict === 'inconclusive').length} | ${success[0] ?? 0} | ${passAt3} | ${(rate * (1 - rate)).toFixed(3)} | ${formatMs(mean(rows.map(row => row.durationMs)))} | ${Math.round(mean(rows.flatMap(row => tokenTotal(row) ?? [])))} | ${mean(rows.map(row => row.efficiency.toolCalls)).toFixed(1)} | ${recoverable.length === 0 ? 'N/A' : `${recovered.length}/${recoverable.length}`} |`)
  }
  lines.push('', '## Runs', '', '| Task | Run | Verdict | Static | Build | Runtime | Session | Agent claims | Agent duration | TTFT | Avg tool time | First build success | Build attempts | Tool success | Retries | Steps | Token breakdown | Total tokens | Duplicate reads | Repeated validation | Cost |', '| --- | ---: | --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---:')
  for (const result of results) {
    const totalTokens = tokenTotal(result)
    const successfulTools = result.efficiency.toolCalls - result.timeline.toolFailures
    const toolSuccess = result.efficiency.toolCalls === 0 ? 'N/A' : `${(successfulTools / result.efficiency.toolCalls * 100).toFixed(1)}%`
    const cost = result.estimatedCost === undefined ? 'N/A' : `${meta.prices?.currency ?? ''}${result.estimatedCost.toFixed(6)}`
    const claims = `${result.agentClaims.verifiedSection ? 'V' : '-'}${result.agentClaims.unverifiedSection ? 'U' : '-'} (${result.agentClaims.commandMentionCount} cmds)`
    lines.push(`| ${result.scenarioName} | ${result.run} | ${result.verdict} | ${result.acceptancePassed}/${result.acceptanceTotal} | ${result.build.passed ? 1 : 0} | ${result.runtime.status} | ${result.sessionCapture.status} (${result.sessionCapture.eventCount}) | ${claims} | ${formatMs(result.durationMs)} | ${formatMs(result.timeline.ttftMs)} | ${formatMs(result.timeline.averageToolDurationMs)} | ${formatMs(result.timeline.firstBuildSuccessMs)} | ${result.timeline.buildAttempts} | ${toolSuccess} | ${result.efficiency.retries} | ${result.timeline.steps} | ${tokenBreakdown(result)} | ${totalTokens ?? 'N/A'} | ${result.efficiency.duplicateReads} | ${result.efficiency.repeatedValidationCalls} | ${cost} |`)
  }
  lines.push('', '## Acceptance evidence', '')
  for (const result of results) {
    const failed = result.acceptance.checks.filter(item => !item.passed)
    lines.push(`### ${result.scenarioName}, run ${result.run}`, '', `Verdict: **${result.verdict}**. Static checks: ${result.acceptancePassed}/${result.acceptanceTotal}. Independent build: ${result.build.passed ? 'passed' : 'failed'}. Server GameTest: ${result.runtime.status}. Session capture: ${result.sessionCapture.status} (${result.sessionCapture.eventCount} events).`, '')
    lines.push(failed.length === 0 ? '- Failed checks: none.' : `- Failed checks: ${failed.map(item => `${item.name} (${item.evidence})`).join('; ')}.`)
    lines.push(`- Agent claim sections: Verified=${result.agentClaims.verifiedSection ? 'present' : 'missing'}, Unverified=${result.agentClaims.unverifiedSection ? 'present' : 'missing'}; claims never affect the verdict.`, `- Unverified: ${result.acceptance.unverified.join('; ')}.`, '')
  }
  if (meta.actualCost !== undefined) {
    const estimated = results.map(result => result.estimatedCost ?? 0).reduce((a, b) => a + b, 0)
    const actual = meta.actualCost
    lines.push('', '## Cost reconciliation', '', '| Calculated estimate | Actual paid | Difference | Currency |', '| ---: | ---: | ---: | --- |', `| ${estimated.toFixed(6)} | ${actual.toFixed(6)} | ${(actual - estimated).toFixed(6)} | ${meta.actualCostCurrency ?? meta.prices?.currency ?? 'configured actual-cost currency'} |`)
  }
  lines.push('## Interpretation', '', '`Pass@1` is the first repetition result. `Pass@3` is 1 when at least one of the first three repetitions succeeds. Token fields are disjoint for reporting; cache-read remains separately visible and is not silently added to ordinary input. Agent final claims are diagnostic only. Runtime behavior is accepted only from the benchmark-owned server GameTest.', '')
  return lines.join('\n')
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function valuesAfter(args: string[], name: string): string[] {
  return args.flatMap((value, index) => {
    const next = args[index + 1]
    return value === name && next !== undefined ? [next] : []
  })
}

function positiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

async function gitState(): Promise<{ revision: string; dirty: boolean }> {
  const revision = (await execa('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT })).stdout.trim()
  const status = (await execa('git', ['status', '--porcelain', '--', '.', ':(exclude)vendor/**'], { cwd: REPO_ROOT })).stdout
  return { revision, dirty: status.trim() !== '' }
}

async function parseOptions(argv: string[]): Promise<Options> {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: pnpm run benchmark:mcmod-agent -- --fixture <NeoForge-MDK> [--prompt-source prompts.md] [--runs 3] [--agent-patch patch.yml] [--output dir] [--agent-label label] [--prices prices.json] [--actual-cost amount] [--currency CNY] [--allow-dirty]\n')
    process.exit(0)
  }
  const fixture = valueAfter(argv, '--fixture')
  const promptSource = valueAfter(argv, '--prompt-source') ?? DEFAULT_BENCHMARK_PROMPT_SOURCE
  if (fixture === undefined) throw new Error('--fixture is required')
  const runs = positiveInteger(valueAfter(argv, '--runs'), 3, '--runs')
  if (runs < 3) throw new Error('--runs must be at least 3')
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-')
  const output = resolve(valueAfter(argv, '--output') ?? join(REPO_ROOT, '.artifacts', 'mcmod-agent-benchmark', stamp))
  try { await stat(output); throw new Error(`output directory already exists: ${output}`) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const allowDirty = argv.includes('--allow-dirty')
  const state = await gitState()
  const agentLabel = valueAfter(argv, '--agent-label') ?? state.revision.slice(0, 12)
  if (state.dirty && !allowDirty) throw new Error('agent source tree is dirty; commit it or pass --allow-dirty with an explicit --agent-label')
  if (state.dirty && valueAfter(argv, '--agent-label') === undefined) throw new Error('--agent-label is required with --allow-dirty')
  const pricePath = valueAfter(argv, '--prices')
  const prices = pricePath === undefined ? undefined : JSON.parse(await readFile(resolve(pricePath), 'utf8')) as PriceTable
  if (prices !== undefined && (typeof prices.currency !== 'string' || prices.currency.trim() === '')) {
    throw new Error('price table must include a non-empty currency')
  }
  const actualCostRaw = valueAfter(argv, '--actual-cost')
  const actualCost = actualCostRaw === undefined ? prices?.actualCost : Number(actualCostRaw)
  if (actualCost !== undefined && (!Number.isFinite(actualCost) || actualCost < 0)) throw new Error('--actual-cost must be a non-negative number')
  const actualCostCurrency = valueAfter(argv, '--currency') ?? prices?.actualCostCurrency ?? prices?.currency
  if (actualCost !== undefined && (actualCostCurrency === undefined || actualCostCurrency.trim() === '')) throw new Error('--currency is required with --actual-cost')
  try {
    process.loadEnvFile(join(REPO_ROOT, '.env'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw new Error(`failed to load .env: ${String(error)}`)
  }
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required for the live-agent benchmark')
  return {
    fixture: resolve(fixture), promptSource: resolve(promptSource), runs, output, agentLabel, allowDirty,
    agentTimeoutMs: positiveInteger(valueAfter(argv, '--agent-timeout-minutes'), 45, '--agent-timeout-minutes') * 60_000,
    buildTimeoutMs: positiveInteger(valueAfter(argv, '--build-timeout-minutes'), 15, '--build-timeout-minutes') * 60_000,
    runtimeTimeoutMs: positiveInteger(valueAfter(argv, '--runtime-timeout-minutes'), 10, '--runtime-timeout-minutes') * 60_000,
    ...prices === undefined ? {} : { prices },
    ...actualCost === undefined ? {} : { actualCost },
    ...actualCostCurrency === undefined ? {} : { actualCostCurrency },
    agentPatches: valuesAfter(argv, '--agent-patch').map(path => resolve(path)),
  }
}

async function main(): Promise<void> {
  const options = await parseOptions(process.argv.slice(2))
  const state = await gitState()
  const prompts = parseBenchmarkPrompts(await readFile(options.promptSource, 'utf8'))
  const baselineDigest = await directoryDigest(options.fixture)
  await mkdir(options.output, { recursive: true })
  if (options.agentPatches.length > 0) {
    const patchRoot = join(options.output, 'agent-patches')
    await mkdir(patchRoot, { recursive: true })
    options.agentPatches = await Promise.all(options.agentPatches.map(async (source, index) => {
      const target = join(patchRoot, `${index + 1}.cordis.yml`)
      await writeFile(target, await readFile(source))
      return target
    }))
  }
  const preflightRoot = join(options.output, 'baseline-preflight')
  const preflightWorkspace = join(preflightRoot, 'workspace')
  await mkdir(preflightRoot, { recursive: true })
  await copyFixture(options.fixture, preflightWorkspace)
  const baselineBuild = await independentBuild(preflightWorkspace, options.buildTimeoutMs, preflightRoot)
  if (!baselineBuild.passed) {
    throw new Error(`baseline Gradle build failed; inspect ${join(preflightRoot, 'independent-build.stderr.txt')}`)
  }
  await writeFile(join(options.output, 'prompts.json'), `${JSON.stringify(prompts, null, 2)}\n`)
  const results: RunResult[] = []
  for (const prompt of prompts) {
    for (let run = 1; run <= options.runs; run++) {
      process.stdout.write(`[mcmod benchmark] ${prompt.id} run ${run}/${options.runs}\n`)
      results.push(await runOne(options, prompt, run, baselineDigest))
    }
  }
  const meta = {
    agentLabel: options.agentLabel,
    gitRevision: state.revision,
    dirty: state.dirty,
    baselineDigest,
    runs: options.runs,
    agentPatches: options.agentPatches,
    baselineBuildDurationMs: baselineBuild.durationMs,
    ...options.prices === undefined ? {} : { prices: options.prices },
    ...options.actualCost === undefined ? {} : { actualCost: options.actualCost },
    ...options.actualCostCurrency === undefined ? {} : { actualCostCurrency: options.actualCostCurrency },
  }
  await writeFile(join(options.output, 'report.json'), `${JSON.stringify({ meta, results }, null, 2)}\n`)
  await writeFile(join(options.output, 'report.md'), renderReport(meta, results))
  process.stdout.write(`[mcmod benchmark] report: ${join(options.output, 'report.md')}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(`mcmod-agent-benchmark: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
