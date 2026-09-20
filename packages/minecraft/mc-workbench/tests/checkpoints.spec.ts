import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { MinecraftCheckpoints } from '../src/checkpoints.ts'
import { hash } from '../src/files.ts'

let root: string
let checkpoints: MinecraftCheckpoints
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-recovery-'))
  checkpoints = new MinecraftCheckpoints()
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/A.java'), 'original')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('restores additions, removals and text edits while preserving credentials and recording the current state', async () => {
  await writeFile(join(root, '.env'), 'secret')
  const saved = await checkpoints.create(root, 'manual', 'source')
  expect(saved.files).toEqual({ 'src/A.java': hash('original') })
  await writeFile(join(root, 'src/A.java'), 'changed')
  await writeFile(join(root, 'src/B.java'), 'new')
  const preview = await checkpoints.preview(root, saved.id)
  expect(preview.changes[0]).toMatchObject({ path: 'src/A.java', beforeText: 'changed', afterText: 'original' })
  await checkpoints.restore(root, saved.id, preview.fingerprint)
  expect(await readFile(join(root, 'src/A.java'), 'utf8')).toBe('original')
  await expect(readFile(join(root, 'src/B.java'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, '.env'), 'utf8')).toBe('secret')
  expect((await checkpoints.list(root)).some(row => row.kind === 'before-restore')).toBe(true)
})

it('blocks stale previews and corrupt objects without replacing source files', async () => {
  const saved = await checkpoints.create(root, 'manual', 'source')
  await writeFile(join(root, 'src/A.java'), 'changed')
  const preview = await checkpoints.preview(root, saved.id)
  await writeFile(join(root, 'src/B.java'), 'external')
  await expect(checkpoints.restore(root, saved.id, preview.fingerprint)).rejects.toThrow('预览后已变化')
  await writeFile(join(root, '.dsh/checkpoints/objects', hash('original')), 'corrupt')
  await expect(checkpoints.preview(root, saved.id)).rejects.toThrow('校验失败')
  expect(await readFile(join(root, 'src/A.java'), 'utf8')).toBe('changed')
})

it('recovers a journal after restart and stops at external edits', async () => {
  const saved = await checkpoints.create(root, 'manual', 'source')
  const journal = join(root, '.dsh/recovery-transaction.json')
  await writeFile(join(root, 'src/A.java'), 'after')
  await writeFile(
    journal,
    JSON.stringify({ id: saved.id, changes: [{ path: 'src/A.java', before: hash('original'), after: hash('after') }] }),
  )
  await new MinecraftCheckpoints().create(root, 'automatic', 'next')
  expect(await readFile(join(root, 'src/A.java'), 'utf8')).toBe('original')
  await writeFile(
    journal,
    JSON.stringify({ id: saved.id, changes: [{ path: 'src/A.java', before: hash('original'), after: hash('after') }] }),
  )
  await writeFile(join(root, 'src/A.java'), 'external')
  await expect(checkpoints.create(root, 'automatic', 'blocked')).rejects.toThrow('外部修改')
  expect(await readFile(join(root, 'src/A.java'), 'utf8')).toBe('external')
})

it('deduplicates content and retains twenty automatic records plus manual records', async () => {
  await checkpoints.create(root, 'manual', 'keep')
  for (let i = 0; i < 22; i++) await checkpoints.create(root, 'automatic', String(i))
  const rows = await checkpoints.list(root)
  expect(rows.filter(row => row.kind === 'automatic')).toHaveLength(20)
  expect(rows.filter(row => row.kind === 'manual')).toHaveLength(1)
  expect(await readdir(join(root, '.dsh/checkpoints/objects'))).toHaveLength(1)
})
