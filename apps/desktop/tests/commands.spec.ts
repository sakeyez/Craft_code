import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopGameMenuState, executeDesktopCommand, gradleInvocation, onDesktopGameEvent, stopActiveCommands,
} from '../src/commands.ts'
import type { DesktopGameEvent } from '../src/preload.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function project(): string {
  const root = join(tmpdir(), `dsh-desktop-command-${randomUUID()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  return root
}

function gameWrapper(cwd: string, tasks = ['runClient']): void {
  writeFileSync(join(cwd, 'build.gradle'), '')
  if (process.platform === 'win32') {
    writeFileSync(join(cwd, 'gradlew.bat'), [
      '@echo off',
      'if "%~2"=="tasks" (',
      ...tasks.map(task => `  echo ${task} - Minecraft task`),
      '  exit /b 0',
      ')',
      'if not "%~2"=="runClient" exit /b 43',
      'echo started>game.started',
      ':wait',
      'ping -n 2 127.0.0.1 >nul',
      'goto wait',
    ].join('\r\n'))
    return
  }
  const wrapper = join(cwd, 'gradlew')
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$2" = "tasks" ]; then',
    ...tasks.map(task => `  echo "${task} - Minecraft task"`),
    '  exit 0',
    'fi',
    '[ "$2" = "runClient" ] || exit 43',
    ': > game.started',
    "trap 'exit 0' TERM INT",
    'while :; do sleep 1; done',
  ].join('\n'))
  chmodSync(wrapper, 0o755)
}

function failingGameWrapper(cwd: string): void {
  writeFileSync(join(cwd, 'build.gradle'), '')
  if (process.platform === 'win32') {
    writeFileSync(join(cwd, 'gradlew.bat'), [
      '@echo off',
      'if "%~2"=="tasks" (echo runClient - Minecraft task& exit /b 0)',
      'ping -n 2 127.0.0.1 >nul',
      'echo fixture failure 1>&2',
      'exit /b 7',
    ].join('\r\n'))
    return
  }
  const wrapper = join(cwd, 'gradlew')
  writeFileSync(wrapper, [
    '#!/bin/sh',
    'if [ "$2" = "tasks" ]; then echo "runClient - Minecraft task"; exit 0; fi',
    'sleep 0.2',
    'echo "fixture failure" >&2',
    'exit 7',
  ].join('\n'))
  chmodSync(wrapper, 0o755)
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`fixture did not create ${path}`)
    await new Promise((resolveWait) => { setTimeout(resolveWait, 25) })
  }
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

  it('builds fixed wrapper and global Gradle invocations for each platform', () => {
    const cwd = project()
    writeFileSync(join(cwd, 'gradlew.bat'), '')
    expect(gradleInvocation(cwd, ['--no-daemon', 'runClient'], 'win32', 'cmd.exe')).toEqual({
      command: 'cmd.exe', args: ['/d', '/c', 'gradlew.bat', '--no-daemon', 'runClient'],
    })
    expect(gradleInvocation(cwd, ['tasks'], 'linux')).toEqual({ command: 'gradle', args: ['tasks'] })
  })

  it('discovers, starts, and stops one development client for a project', async () => {
    const cwd = project()
    gameWrapper(cwd)
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd })).resolves.toMatchObject({
      ok: true,
      title: '启动游戏',
    })
    await waitForFile(join(cwd, 'game.started'))
    expect(desktopGameMenuState(cwd)).toBe('running')
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd })).resolves.toMatchObject({
      ok: true,
      title: '停止游戏',
    })
    expect(desktopGameMenuState(cwd)).toBe('idle')
  }, 20_000)

  it('rejects a duplicate launch while the same project is starting', async () => {
    const cwd = project()
    gameWrapper(cwd)
    const launch = executeDesktopCommand({ kind: 'game-toggle', cwd })
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd })).resolves.toMatchObject({
      ok: false,
      message: '游戏正在启动。',
    })
    await expect(launch).resolves.toMatchObject({ ok: true, title: '启动游戏' })
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd })).resolves.toMatchObject({
      ok: true,
      title: '停止游戏',
    })
  }, 20_000)

  it('runs development clients for different projects independently', async () => {
    const first = project()
    const second = project()
    gameWrapper(first)
    gameWrapper(second)
    await Promise.all([
      executeDesktopCommand({ kind: 'game-toggle', cwd: first }),
      executeDesktopCommand({ kind: 'game-toggle', cwd: second }),
    ])
    await Promise.all([
      waitForFile(join(first, 'game.started')),
      waitForFile(join(second, 'game.started')),
    ])
    expect(desktopGameMenuState(first)).toBe('running')
    expect(desktopGameMenuState(second)).toBe('running')
    await executeDesktopCommand({ kind: 'game-toggle', cwd: first })
    expect(desktopGameMenuState(first)).toBe('idle')
    expect(desktopGameMenuState(second)).toBe('running')
    await executeDesktopCommand({ kind: 'game-toggle', cwd: second })
  }, 20_000)

  it('refuses missing and ambiguous client tasks without launching a process', async () => {
    const missing = project()
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd: missing })).resolves.toMatchObject({
      ok: false,
      message: '当前项目没有根 Gradle 构建文件。',
    })

    const ambiguous = project()
    gameWrapper(ambiguous, ['runClient', 'runGame'])
    const ambiguousResult = await executeDesktopCommand({ kind: 'game-toggle', cwd: ambiguous })
    expect(ambiguousResult.ok).toBe(false)
    expect(ambiguousResult.message).toContain('多个客户端运行任务')
    expect(desktopGameMenuState(ambiguous)).toBe('idle')
  })

  it('reports an unexpected client exit with its bounded error output', async () => {
    const cwd = project()
    failingGameWrapper(cwd)
    const event = new Promise<DesktopGameEvent>((resolveEvent) => {
      const dispose = onDesktopGameEvent((value) => {
        dispose()
        resolveEvent(value)
      })
    })
    await expect(executeDesktopCommand({ kind: 'game-toggle', cwd })).resolves.toMatchObject({ ok: true })
    const exitEvent = await event
    expect(exitEvent).toMatchObject({
      cwd,
      result: {
        ok: false,
        title: '游戏运行失败',
        message: 'Gradle 客户端进程退出码 7',
      },
    })
    expect(exitEvent.result.stderr).toContain('fixture failure')
    expect(desktopGameMenuState(cwd)).toBe('idle')
  }, 10_000)

  it('stops every project client during desktop shutdown', async () => {
    const first = project()
    const second = project()
    gameWrapper(first)
    gameWrapper(second)
    await Promise.all([
      executeDesktopCommand({ kind: 'game-toggle', cwd: first }),
      executeDesktopCommand({ kind: 'game-toggle', cwd: second }),
    ])
    await stopActiveCommands()
    expect(desktopGameMenuState(first)).toBe('idle')
    expect(desktopGameMenuState(second)).toBe('idle')
  }, 20_000)
})
