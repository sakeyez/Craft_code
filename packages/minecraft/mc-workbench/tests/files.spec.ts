import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listFiles, projectPath, readText, saveText, searchFiles } from '../src/files.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-files-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
describe('project text access', () => {
  it('saves UTF-8 drafts and rejects concurrent changes without overwriting them', async () => {
    await writeFile(join(root, 'Example.java'), 'class Example {}\n')
    const file = await readText(root, 'Example.java')
    const saved = await saveText(root, file.path, '// 中文\nclass Example {}\n', file.revision)
    expect(saved.text).toContain('中文')
    await writeFile(join(root, file.path), '// external change\n')
    await expect(saveText(root, file.path, 'stale draft', saved.revision)).rejects.toThrow('文件已被')
    expect(await readFile(join(root, file.path), 'utf8')).toBe('// external change\n')
  })
  it('rejects parent escapes, linked directories and binary files', async () => {
    await expect(projectPath(root, '../outside.txt', true)).rejects.toThrow('超出')
    await mkdir(join(root, 'real'))
    await symlink(join(root, 'real'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(projectPath(root, 'link/file.txt', true)).rejects.toThrow('符号链接')
    await writeFile(join(root, 'binary.jar'), Buffer.from([0, 1, 2]))
    await expect(readText(root, 'binary.jar')).rejects.toThrow('二进制')
  })
  it('searches project text while excluding generated and private state', async () => {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, '.dsh'))
    await writeFile(join(root, 'src', 'Example.java'), 'line one\nneedle 中文\n')
    await writeFile(join(root, '.dsh', 'log'), 'needle')
    expect((await listFiles(root)).map(file => file.name)).toEqual(['src'])
    expect(await searchFiles(root, 'needle')).toEqual({
      hits: [{ path: 'src/Example.java', line: 2, text: 'needle 中文' }],
      truncated: false,
    })
  })
})
