/** Project-local Java selection and verified Adoptium installation. */
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readdir, rename, readFile, writeFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { x as untar } from 'tar'
import { runProcess } from './process.ts'
import { fetchJson } from './download.ts'
import { downloadArtifact } from './transfer.ts'
import { extractZipFile } from './archive.ts'
import type { JavaEnvironment } from './types.ts'

/**
 * Locate application-managed Minecraft caches without using the project tree.
 * @returns Locate application-managed Minecraft caches without using the project tree.
 */
export const cacheRoot = (): string =>
  join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cache', 'minecraft-workbench')

/**
 * Select the supported Java major from an exact Minecraft release.
 * @param version - Exact supported Minecraft release.
 * @returns Select the supported Java major from an exact Minecraft release.
 */
export function requiredJava(version: string): 17 | 21 {
  if (/^1\.20\.[1-4]$/u.test(version)) return 17
  if (/^1\.20\.[5-6]$|^1\.21(?:\.\d+)?$/u.test(version)) return 21
  throw new Error(`尚未支持 Minecraft ${version} 的 Java 环境。`)
}

/**
 * Verify the declared executable and adjacent compiler without changing global Java settings.
 * @param ctx - Host context with filesystem and managed subprocess services.
 * @param executable - Explicit Java executable to validate.
 * @param major - Required JDK major.
 * @param signal - Caller cancellation signal.
 * @param managed - Whether the executable belongs to application-managed storage.
 * @returns Verified JDK identity, or undefined when unavailable or incompatible.
 */
export async function probe(
  ctx: Context,
  executable: string,
  major: number,
  signal: AbortSignal,
  managed: boolean,
): Promise<JavaEnvironment | undefined> {
  try {
    await access(join(dirname(executable), process.platform === 'win32' ? 'javac.exe' : 'javac'))
    const result = await runProcess(ctx, {
      argv: [executable, '-version'],
      cwd: homedir(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    const found = /(?:openjdk|java) version "(?:1\.)?(\d+)/u.exec(result.text)
    if (result.exitCode === 0 && Number(found?.[1]) === major) return { executable, major, managed, available: true }
  } catch {
    signal.throwIfAborted()
  }
  return undefined
}

/**
 * Locate an exact-major JDK; never change PATH or JAVA_HOME in the parent process.
 * @param ctx - Host context providing the required capabilities.
 * @param major - Required JDK major version.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @returns Locate an exact-major JDK without changing the parent environment.
 */
export async function findJava(
  ctx: Context,
  major: number,
  signal: AbortSignal = new AbortController().signal,
): Promise<JavaEnvironment> {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  const candidates = [
    process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', exe) : undefined,
    await ctx.subprocess.resolveExecutable('java', undefined, signal).catch(() => undefined),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const found = await probe(ctx, candidate, major, signal, false)
    if (found) return found
  }
  const path = await readFile(join(cacheRoot(), `java-${major}.json`), 'utf8')
    .then(text => JSON.parse(text) as unknown)
    .catch(() => undefined)
  if (typeof path === 'string' && path.startsWith(cacheRoot() + (process.platform === 'win32' ? '\\' : '/'))) {
    const found = await probe(ctx, path, major, signal, true)
    if (found) return found
  }
  return { major, managed: false, available: false }
}

/**
 * Download a verified JDK when none matches; cancellation leaves the previous installation intact.
 * @param ctx - Host context providing the required capabilities.
 * @param major - Required JDK major version.
 * @param signal - Cancellation signal for the caller-owned operation.
 * @param progress - Awaited environment progress callback.
 * @returns Reuse a matching JDK or install a hash-verified official Adoptium release.
 * @param bytes - Archive content or incremental download progress callback.
 */
export async function ensureJava(
  ctx: Context,
  major: number,
  signal: AbortSignal,
  progress: (text: string) => Promise<void>,
  bytes?: (received: number, total?: number) => void,
): Promise<JavaEnvironment> {
  const existing = await findJava(ctx, major, signal)
  if (existing.available) return existing
  return installJava(ctx, major, signal, progress, bytes)
}

async function installJava(
  ctx: Context,
  major: number,
  signal: AbortSignal,
  progress: (text: string) => Promise<void>,
  bytes?: (received: number, total?: number) => void,
): Promise<JavaEnvironment> {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'aarch64' : undefined
  if (!arch) throw new Error('当前架构不支持自动安装 Java，请手动配置 JDK。')
  await progress(`正在获取 Adoptium JDK ${major} (${os}/${arch})。\n`)
  const json = await fetchJson(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jdk&os=${os}&vendor=eclipse`,
    signal,
  )
  const first = Array.isArray(json)
    ? (json[0] as { binary?: { package?: { link?: unknown; checksum?: unknown } } })
    : undefined
  const artifact = first?.binary?.package
  if (typeof artifact?.link !== 'string' || typeof artifact.checksum !== 'string')
    throw new Error('Adoptium 未返回当前平台的 JDK。')
  const archive = await downloadArtifact({
    url: artifact.link,
    destination: join(cacheRoot(), 'downloads', artifact.checksum),
    digest: { algorithm: 'sha256', value: artifact.checksum },
    maxBytes: 512 * 1024 * 1024,
    signal,
    ...(bytes ? { progress: bytes } : {}),
  })
  signal.throwIfAborted()
  const destination = join(cacheRoot(), `jdk-${major}-${randomUUID()}`)
  await mkdir(destination, { recursive: true })
  if (os === 'windows') await extractZipFile(archive, destination, signal)
  else {
    await untar({
      file: archive,
      cwd: destination,
      strict: true,
      preservePaths: false,
      filter: (path, entry) =>
        !path.split('/').includes('..') &&
        !path.startsWith('/') &&
        'type' in entry &&
        ['File', 'Directory'].includes(entry.type),
    })
  }
  signal.throwIfAborted()
  const roots = await readdir(destination, { withFileTypes: true })
  for (const root of roots.filter(row => row.isDirectory())) {
    const executable = join(
      destination,
      root.name,
      ...(os === 'mac' ? ['Contents', 'Home'] : []),
      'bin',
      os === 'windows' ? 'java.exe' : 'java',
    )
    const found = await probe(ctx, executable, major, signal, true)
    if (!found) continue
    const marker = join(cacheRoot(), `java-${major}.json`)
    const temporary = join(dirname(marker), `${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(executable))
    await rename(temporary, marker)
    await progress(`JDK ${major} 已准备完成。\n`)
    return found
  }
  throw new Error('下载的 JDK 未通过运行验证，请检查解压目录。')
}

/**
 * Construct Java settings for the owned child process only.
 * @param java - Verified JDK identity used only for this child.
 * @returns Construct Java settings for the owned child process only.
 */
export function javaEnv(java: JavaEnvironment): NodeJS.ProcessEnv {
  if (!java.executable) throw new Error('Java 尚未就绪。')
  const bin = dirname(java.executable)
  return {
    JAVA_HOME: dirname(bin),
    PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  }
}
