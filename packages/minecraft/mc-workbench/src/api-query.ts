/** Exact-classpath API lookup; external mappings remain explicitly unverified. */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, delimiter } from 'node:path'
import { z } from 'zod'
import { hash, projectPath } from './files.ts'
import { fileDigest } from './transfer.ts'
import { projectInputs } from './project-inputs.ts'
import { findJava } from './environment.ts'
import { runProcess } from './process.ts'
import { networkFetch } from './network.ts'
import { cachedClassSource } from './sources.ts'
import type { BuildFacts } from './artifact.ts'
import type { DetectionResult } from '@deepseek-ai/dsh-tool-mc-project'

const inputSchema = z.object({
  symbol: z
    .string()
    .regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/u)
    .max(512),
  version: z.string().max(64).optional(),
  external: z.boolean().default(false),
})
const classpathSchema = z.object({
  format: z.literal(1),
  fingerprint: z.string(),
  minecraft: z.string(),
  namespace: z.string(),
  java: z.number().int(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() })).max(5000),
})
/** Query result provenance; a cached external symbol never becomes local proof. */
export interface ApiQueryResult {
  symbol: string
  version: string
  namespace: string
  verified: boolean
  source: string
  cached: boolean
  text: string
}
const resultSchema = z.object({
  symbol: z.string(),
  version: z.string(),
  namespace: z.string(),
  verified: z.boolean(),
  source: z.string(),
  cached: z.boolean(),
  text: z.string().max(24000),
})

/**
 * Record resolved classpath identities after a build, binding lookup to exact project inputs.
 * @param cwd - Absolute project root.
 * @param facts - Resolved Gradle archive and classpath facts.
 * @param project - Detected loader, version and mappings evidence.
 * @param fingerprint - Expected hash of the protected project input inventory.
 * @param java - Selected JVM executable or major required by this operation.
 */
export async function recordApiClasspath(
  cwd: string,
  facts: BuildFacts,
  project: DetectionResult,
  fingerprint: string,
  java: number,
): Promise<void> {
  if (project.minecraftVersion.status !== 'determined' || project.minecraftVersion.classification !== 'exact') return
  const files = []
  for (const path of facts.classpath) if (path.endsWith('.jar')) files.push({ path, sha256: await fileDigest(path) })
  const record = {
    format: 1,
    fingerprint,
    minecraft: project.minecraftVersion.value,
    namespace: project.mappings.status === 'determined' ? project.mappings.type : project.mappings.status,
    java,
    files,
  }
  await writeFile(await projectPath(cwd, '.dsh/api-classpath.json', true), JSON.stringify(record))
}

/**
 * Read method descriptors through javap from a verified classpath; never converts naming schemes.
 * @param ctx - Host context with filesystem and managed subprocess services.
 * @param cwd - Absolute project root.
 * @param input - Untrusted query or preview payload.
 * @param signal - Caller cancellation signal.
 * @returns Versioned API evidence with source and verification status.
 */
export async function queryMinecraftApi(
  ctx: Context,
  cwd: string,
  input: unknown,
  signal: AbortSignal,
): Promise<ApiQueryResult> {
  const query = inputSchema.parse(input)
  const data = await readFile(await projectPath(cwd, '.dsh/api-classpath.json', true), 'utf8')
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        throw new Error('尚无已解析的项目 classpath，请先构建项目。')
      throw error
    })
    .then(text => classpathSchema.parse(JSON.parse(text)))
  if (query.version && query.version !== data.minecraft)
    throw new Error(`查询版本 ${query.version} 与项目 ${data.minecraft} 不一致。`)
  if ((await projectInputs(cwd, signal)).fingerprint !== data.fingerprint)
    throw new Error('项目输入已变化，请重新构建后查询 API。')
  for (const file of data.files) {
    signal.throwIfAborted()
    if ((await fileDigest(file.path)) !== file.sha256) throw new Error('依赖 classpath 已变化，请重新构建。')
  }
  const key = hash(JSON.stringify({ data, symbol: query.symbol, external: query.external }))
  const directory = await projectPath(cwd, '.dsh/api-cache', true)
  const cache = join(directory, `${key}.json`)
  const cached = await readFile(cache, 'utf8')
    .then(text => resultSchema.parse(JSON.parse(text)))
    .catch(() => undefined)
  if (cached) return { ...cached, cached: true }
  const java = await findJava(ctx, data.java, signal)
  if (!java.executable) throw new Error(`缺少 JDK ${data.java} 的 javap；请准备环境。`)
  const javap = join(dirname(java.executable), process.platform === 'win32' ? 'javap.exe' : 'javap')
  const result = await runProcess(ctx, {
    cwd,
    argv: [javap, '-public', '-s', '-classpath', data.files.map(file => file.path).join(delimiter), query.symbol],
    signal,
    maxBytes: 24000,
  })
  let record: ApiQueryResult = {
    symbol: query.symbol,
    version: data.minecraft,
    namespace: data.namespace,
    verified: false,
    source: 'project-classpath',
    cached: false,
    text: '当前项目 classpath 未确认此符号。',
  }
  if (result.exitCode === 0 && !result.truncated) {
    const source = await cachedClassSource(cwd, new Set(data.files.map(file => file.sha256)), query.symbol)
    record = {
      ...record,
      verified: !['unknown', 'conflict'].includes(data.namespace),
      source: source ? `project-classpath; ${source.source}` : record.source,
      text: source ? `${result.text.slice(0, 11000)}\n\n${source.text}` : result.text.slice(0, 24000),
    }
  } else if (query.external) {
    const url = `https://mappings.dev/${encodeURIComponent(data.minecraft)}/${query.symbol.replaceAll('.', '/')}.html`
    const response = await networkFetch(url, { signal }, 2 * 1024 ** 2)
    const text = (await response.text())
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, '')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .slice(0, 24000)
    record = { ...record, namespace: 'mappings.dev (multiple namespaces; no conversion)', source: url, text }
  }
  await mkdir(directory, { recursive: true })
  await writeFile(cache, JSON.stringify(record))
  return record
}
