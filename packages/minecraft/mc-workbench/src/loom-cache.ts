/** Recover only a malformed Loom manifest from an already valid local manifest. */
import { readFile, writeFile, rename, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'

const manifestSchema = z.object({
  versions: z.array(z.object({ id: z.string(), url: z.url(), sha1: z.string().regex(/^[a-f\d]{40}$/u) })).min(1),
})

/**
 * Preserve corrupt bytes and replace only unchanged, malformed metadata; never remove Loom locks.
 * @param gradleUserHome - Selected Gradle cache root.
 * @returns Whether a malformed manifest was replaced from validated local metadata.
 */
export async function repairLoomManifest(gradleUserHome: string): Promise<boolean> {
  const root = join(gradleUserHome, 'caches', 'fabric-loom')
  const rows = await Promise.all(['mojang_versions_manifest.json', 'versions_manifest.json'].map(async (name) => {
    const path = join(root, name)
    const info = await lstat(path).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (!info?.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) return undefined
    const bytes = await readFile(path)
    let valid = false
    try {
      const data = manifestSchema.parse(JSON.parse(bytes.toString('utf8')))
      valid = data.versions.every((row) => {
        const url = new URL(row.url)
        return url.protocol === 'https:' && !url.username && !url.password &&
          ['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(url.hostname)
      })
    } catch { /* A malformed manifest is repairable only with a validated local alternative. */ }
    return { path, bytes, valid }
  }))
  const source = rows.find(row => row?.valid)
  if (!source) return false
  let repaired = false
  for (const row of rows) {
    if (!row || row.valid) continue
    const suffix = createHash('sha256').update(row.bytes).digest('hex')
    await writeFile(`${row.path}.corrupt-${suffix}`, row.bytes)
    const temporary = `${row.path}.${randomUUID()}.tmp`
    await writeFile(temporary, source.bytes, { flag: 'wx' })
    if (!(await readFile(row.path)).equals(row.bytes)) throw new Error('Loom 版本清单已被其他进程修改，修复已停止。')
    await rename(temporary, row.path)
    repaired = true
  }
  return repaired
}
