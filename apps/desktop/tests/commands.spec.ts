import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { executeDesktopCommand } from '../src/commands.ts'

const roots: string[] = []
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

  it('builds through the platform wrapper and discovers the generated JAR', async () => {
    const cwd = project()
    if (process.platform === 'win32') {
      writeFileSync(join(cwd, 'gradlew.bat'), [
        '@echo off',
        'if not "%~1"=="--no-daemon" exit /b 41',
        'if not "%~2"=="build" exit /b 42',
        'mkdir build\\libs',
        'type nul > build\\libs\\fixture.jar',
      ].join('\r\n'))
    } else {
      const wrapper = join(cwd, 'gradlew')
      writeFileSync(wrapper, [
        '#!/bin/sh',
        '[ "$1" = "--no-daemon" ] || exit 41',
        '[ "$2" = "build" ] || exit 42',
        'mkdir -p build/libs',
        ': > build/libs/fixture.jar',
      ].join('\n'))
      chmodSync(wrapper, 0o755)
    }

    await expect(executeDesktopCommand({ kind: 'export-jar', cwd })).resolves.toMatchObject({
      ok: true,
      title: '导出 JAR',
      artifacts: ['fixture.jar'],
      path: join(cwd, 'build', 'libs'),
    })
  })
})
