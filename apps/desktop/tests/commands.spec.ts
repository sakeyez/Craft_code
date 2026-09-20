import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  executeDesktopCommand, gradleInvocation,
} from '../src/commands.ts'

const roots: string[] = []
beforeEach(() => {
  vi.stubEnv('CRAFTCODE_DUMMY_SECRET', 'synthetic-only')
  vi.stubEnv('DSH_REVIEW_CONTEXT', 'parent-session')
  vi.stubEnv('CRAFTCODE_TEST_MARKER', 'ready')
})
afterEach(() => { vi.unstubAllEnvs() })
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function project(): string {
  const root = join(tmpdir(), `dsh-desktop-command-${randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return root
}

describe('desktop project commands', () => {
  it('persists normalized project settings', async () => {
    const cwd = project()
    const result = await executeDesktopCommand({
      kind: 'project-settings-write', cwd,
      settings: { systemPrompt: 'Use project conventions.', prerequisites: [{ name: ' API ', path: cwd }] },
    })
    expect(result.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(cwd, '.dsh', 'project.yaml'), 'utf8'))).toMatchObject({
      version: 1, systemPrompt: 'Use project conventions.', prerequisites: [{ name: 'API', path: cwd }],
    })
  })

  it('requires the workbench host for verified exports', async () => {
    await expect(executeDesktopCommand({ kind: 'export-jar', cwd: project() })).resolves.toMatchObject({ ok: false, title: '导出模组', message: expect.stringContaining('工作台宿主') as string })
  })

  it('builds fixed wrapper and global Gradle invocations for each platform', () => {
    const cwd = project()
    writeFileSync(join(cwd, 'gradlew.bat'), '')
    expect(gradleInvocation(cwd, ['--no-daemon', 'runClient'], 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe', args: ['/d', '/c', 'gradlew.bat', '--no-daemon', 'runClient'],
    })
    expect(gradleInvocation(cwd, ['tasks'], 'linux')).toEqual({ command: 'gradle', args: ['tasks'] })
  })

  it('requires the workbench host for game launches', async () => {
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd: project() })).resolves.toMatchObject({ ok: false, message: expect.stringContaining('工作台宿主') as string })
  })
})
