/** Persist project-selected JDK paths; input changes invalidate the selection, never the Gradle cache. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { findJava, probe } from './environment.ts'
import { projectPath, readText } from './files.ts'
import type { JavaEnvironment } from './types.ts'

const bindingSchema = z.object({
  format: z.literal(1),
  fingerprint: z.string().regex(/^[a-f\d]{64}$/u),
  gradleUserHome: z.string(),
  tasks: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9:_-]*$/u)).max(10000).optional(),
  jdks: z.array(z.object({ major: z.number().int(), executable: z.string(), managed: z.boolean() })).max(3),
})
/** Project-owned cache identity and derived JDK/task selection. */
export type DevelopmentEnvironment = z.infer<typeof bindingSchema>

/**
 * Fingerprint build and environment inputs without retaining credential-bearing property values.
 * @param cwd - Project root.
 * @param files - Detected build files to fingerprint.
 * @param preferredHome - Bootstrap-selected cache location, preserved for later development.
 * @returns Matching persisted selection or a fresh selection retaining the cache location.
 */
export async function developmentEnvironment(
  cwd: string, files: readonly string[], preferredHome?: string,
): Promise<DevelopmentEnvironment> {
  const path = await projectPath(cwd, '.dsh/environment.json', true)
  const prior = await readFile(path, 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  const binding = prior === undefined ? undefined : bindingSchema.parse(JSON.parse(prior))
  const gradleUserHome = resolve(preferredHome ?? binding?.gradleUserHome ?? process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'))
  const digest = createHash('sha256').update(JSON.stringify([gradleUserHome, process.env.JAVA_HOME ?? '']))
  for (const path of [...new Set([...files, 'gradle/wrapper/gradle-wrapper.properties', 'gradle/gradle-daemon-jvm.properties'])].sort()) {
    const file = await readText(cwd, path).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    digest.update(path).update(file?.text ?? '<missing>')
  }
  const global = await readFile(join(gradleUserHome, 'gradle.properties'), 'utf8').catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  })
  digest.update(global)
  const fingerprint = digest.digest('hex')
  if (binding?.fingerprint === fingerprint) return binding
  return { format: 1, fingerprint, gradleUserHome, jdks: [] }
}

/**
 * A missing previously selected JDK blocks execution instead of silently changing environments.
 * @param ctx - Host subprocess services.
 * @param binding - Validated project environment record.
 * @param major - Required Java major.
 * @param signal - Caller cancellation.
 * @returns Verified pinned JDK or a discovery result for a new selection.
 */
export async function findDevelopmentJava(
  ctx: Context, binding: DevelopmentEnvironment, major: number, signal: AbortSignal,
): Promise<JavaEnvironment> {
  const pinned = binding.jdks.find(jdk => jdk.major === major)
  if (!pinned) return findJava(ctx, major, signal)
  const found = await probe(ctx, pinned.executable, major, signal, pinned.managed)
  if (!found) throw new Error(`项目已选 JDK ${major} 不可用：${pinned.executable}。请恢复 JDK 或更新项目 Java 配置。`)
  return found
}

/**
 * Commit verified paths before preparing, building or launching with this environment.
 * @param cwd - Project root.
 * @param binding - Environment identity and task discovery.
 * @param jdks - Verified JDK executables for this operation.
 */
export async function saveDevelopmentEnvironment(
  cwd: string, binding: DevelopmentEnvironment, jdks: readonly JavaEnvironment[],
): Promise<void> {
  const value = bindingSchema.parse({ ...binding, jdks: jdks.map(({ major, executable, managed }) => ({ major, executable, managed })) })
  const path = await projectPath(cwd, '.dsh/environment.json', true)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path + '.tmp', JSON.stringify(value))
  await rename(path + '.tmp', path)
}
