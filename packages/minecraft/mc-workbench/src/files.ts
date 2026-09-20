/** Bounded project text access; writes compare the user's read revision before committing. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, realpath, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, dirname } from 'node:path'
import type { FileEntry, SearchHit, TextFile } from './types.ts'

/**
 * Maximum UTF-8 byte size accepted by the lightweight editor.
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024
const EXCLUDED = new Set(['.git', '.gradle', '.dsh', 'build', 'node_modules'])
/**
 * Compute the SHA-256 revision used for file conflicts and artifact identity.
 * @param bytes - Archive or text bytes to inspect.
 * @returns Compute the SHA-256 revision used for file conflicts and artifact identity.
 */
export const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/**
 * Resolve an existing absolute workspace, rejecting filesystem aliases at the boundary.
 * @param cwd - Absolute project directory.
 * @returns Resolve an existing absolute workspace, rejecting filesystem aliases at the boundary.
 */
export async function projectRoot(cwd: string): Promise<string> {
  if (!isAbsolute(cwd)) throw new Error('项目路径必须是绝对路径。')
  const root = await realpath(cwd)
  if (!(await lstat(root)).isDirectory()) throw new Error('项目目录不存在。')
  return root
}

/**
 * Resolve a workspace-relative path without traversing symlinks, including the final component.
 * @param root - Validated absolute workspace root.
 * @param path - Workspace-relative path within the selected project or source root.
 * @param missing - Whether safe not-yet-created path components are allowed.
 * @returns Resolve a workspace-relative path without traversing symlinks, including the final component.
 */
export async function projectPath(root: string, path: string, missing: boolean = false): Promise<string> {
  if (isAbsolute(path) || /[\u0000:]/u.test(path)) throw new Error('文件路径必须位于当前项目内。')
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
    throw new Error('文件路径超出项目目录。')
  let current = root
  const parts = rel.split(/[\\/]/u).filter(Boolean)
  for (const part of parts) {
    current = join(current, part)
    const stat = await lstat(current).catch((error: unknown) => {
      if (missing && error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (stat?.isSymbolicLink()) throw new Error(`不支持通过符号链接访问：${path}`)
    if (!stat && missing) break
  }
  return target
}

/**
 * Read bounded UTF-8 text with a content revision; reject binary files and path escapes.
 * @param root - Validated absolute project or source directory.
 * @param path - Relative path within that directory.
 * @param readonly - Whether the consumer must disable editing.
 * @returns Text, content hash and editing permission.
 */
export async function readText(root: string, path: string, readonly: boolean = false): Promise<TextFile> {
  const file = await projectPath(root, path)
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) throw new Error('此文件过大或不是普通文件，请在外部编辑器中打开。')
  const bytes = await readFile(file)
  if (bytes.includes(0)) throw new Error('二进制文件不能作为文本编辑。')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('此文件不是 UTF-8 文本，请使用外部编辑器。')
  }
  return {
    path,
    text,
    revision: hash(bytes),
    readonly: readonly || /(?:^|\/)(?:generated|generated-resources)(?:\/|$)/u.test(path),
  }
}

/**
 * Write a sibling temporary file and atomically replace only the revision that was read.
 * @param root - Validated absolute workspace root.
 * @param path - Workspace-relative path within the selected project or source root.
 * @param text - Actual UTF-8 content to write or inspect.
 * @param revision - SHA-256 revision captured when the file was read.
 * @returns Write a sibling temporary file and atomically replace only the revision that was read.
 */
export async function saveText(root: string, path: string, text: string, revision: string): Promise<TextFile> {
  if (path.split(/[\\/]/u).some(part => EXCLUDED.has(part)))
    throw new Error('不能通过代码编辑器修改缓存或版本控制文件。')
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('文件超过编辑大小限制。')
  const current = await readText(root, path)
  if (current.readonly) throw new Error('生成资源只读，请修改对应生成源。')
  if (current.revision !== revision) throw new Error('文件已被助手或其他程序修改。请查看磁盘差异后重新保存。')
  const file = await projectPath(root, path)
  const temporary = join(dirname(file), `.craftcode-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: (await lstat(file)).mode })
    if ((await readText(root, path)).revision !== revision) throw new Error('文件已变化，未覆盖磁盘内容。')
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch(() => {})
  }
  return readText(root, path)
}

/**
 * List ordinary files and directories, excluding generated/private state and symlinks.
 * @param root - Validated absolute project or source directory.
 * @param path - Relative directory to list.
 * @returns Sorted directory entries.
 */
export async function listFiles(root: string, path: string = ''): Promise<FileEntry[]> {
  const directory = await projectPath(root, path)
  const rows = await readdir(directory, { withFileTypes: true })
  if (rows.length > 5000) throw new Error('目录条目过多，请打开更具体的目录。')
  return rows
    .filter(row => !row.isSymbolicLink() && !EXCLUDED.has(row.name) && (row.isDirectory() || row.isFile()))
    .map(row => ({
      path: [path, row.name].filter(Boolean).join('/'),
      name: row.name,
      directory: row.isDirectory(),
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

/**
 * Search project UTF-8 text with bounded file and result counts; report incomplete scans.
 * @param root - Validated absolute project or source directory.
 * @param query - Literal case-insensitive text to find.
 * @returns Matching lines and whether the scan reached its bounds.
 */
export async function searchFiles(root: string, query: string): Promise<{ hits: SearchHit[]; truncated: boolean }> {
  if (!query.trim() || query.length > 256) throw new Error('请输入 1–256 字符的搜索内容。')
  const pending = ['']
  const hits: SearchHit[] = []
  let files = 0
  while (pending.length && hits.length < 200 && files < 5000) {
    for (const entry of await listFiles(root, pending.pop())) {
      if (entry.directory) {
        pending.push(entry.path)
        continue
      }
      files++
      const file = await readText(root, entry.path).catch(() => undefined)
      if (!file) continue
      file.text.split(/\r?\n/u).forEach((line, index) => {
        if (hits.length < 200 && line.toLowerCase().includes(query.toLowerCase()))
          hits.push({ path: entry.path, line: index + 1, text: line.slice(0, 500) })
      })
      if (hits.length >= 200 || files >= 5000) break
    }
  }
  return { hits, truncated: hits.length >= 200 || files >= 5000 }
}
