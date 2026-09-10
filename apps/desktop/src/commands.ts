import { spawn } from 'node:child_process'
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseGradleTaskNames, runtimeTaskCandidates } from '@deepseek-ai/dsh-tool-mc-project/gradle-tasks'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { DesktopGameMenuState } from './menu.ts'
import type { DesktopCommandRequest, DesktopCommandResult, DesktopGameEvent } from './preload.ts'

const PROJECT_CONFIG = '.dsh/project.yaml'
const MAX_OUTPUT_BYTES = 32_000
const COMMAND_TIMEOUT_MS = 120_000
const GAME_STOP_GRACE_MS = 5_000
const GRADLE_ROOT_FILES = ['build.gradle', 'build.gradle.kts'] as const

interface OutputTail {
  buffer: Buffer
  truncated: boolean
}

interface ProcessResult extends DesktopCommandResult {
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

interface ActiveGame {
  cwd: string
  phase: 'starting' | 'running' | 'stopping'
  child?: ChildProcessWithoutNullStreams
  stdout: OutputTail
  stderr: OutputTail
  stopRequested: boolean
  started: boolean
  settled: Promise<void>
  resolveSettled: () => void
}

const activeCommands = new Set<ChildProcess>()
const activeGames = new Map<string, ActiveGame>()
const gameEventListeners = new Set<(event: DesktopGameEvent) => void>()
const gameLifecycleListeners = new Set<(event: DesktopGameLifecycleEvent) => void>()
let acceptingCommands = true

/** Main-process-only lifecycle used to attach native windows to Gradle launches. */
export type DesktopGameLifecycleEvent =
  | { type: 'spawned'; cwd: string; rootPid: number }
  | { type: 'exited'; cwd: string }

function isAcceptingCommands(): boolean {
  return acceptingCommands
}

function emptyTail(): OutputTail {
  return { buffer: Buffer.alloc(0), truncated: false }
}

function appendTail(tail: OutputTail, chunk: Buffer | string): void {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  const next = Buffer.concat([tail.buffer, bytes])
  if (next.byteLength <= MAX_OUTPUT_BYTES) {
    tail.buffer = next
    return
  }
  tail.buffer = next.subarray(next.byteLength - MAX_OUTPUT_BYTES)
  tail.truncated = true
}

function tailText(tail: OutputTail): string {
  return tail.buffer.toString('utf8')
}

function validateCwd(cwd: string): string {
  if (typeof cwd !== 'string' || !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(cwd)) throw new Error('项目路径必须是绝对路径')
  const canonical = resolve(cwd)
  if (!existsSync(canonical) || !statSync(canonical).isDirectory()) throw new Error('当前项目目录不存在')
  return canonical
}

function result(title: string, message: string, extra: Partial<DesktopCommandResult> = {}): DesktopCommandResult {
  return { ok: true, title, message, ...extra }
}

function parseSettings(cwd: string): DesktopCommandResult {
  const file = join(cwd, PROJECT_CONFIG)
  if (!existsSync(file)) return result('项目设置', '尚未保存项目设置。', { settings: { prerequisites: [], systemPrompt: '' } })
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<NonNullable<DesktopCommandResult['settings']>>
    return result('项目设置', '已读取项目设置。', {
      settings: {
        prerequisites: Array.isArray(parsed.prerequisites)
          ? parsed.prerequisites.filter(row => typeof row.name === 'string' && typeof row.path === 'string')
          : [],
        systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
      },
    })
  } catch (error) {
    throw new Error(`项目设置格式无效: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function saveSettings(cwd: string, settings: NonNullable<DesktopCommandRequest['settings']>): DesktopCommandResult {
  const directory = join(cwd, '.dsh')
  mkdirSync(directory, { recursive: true })
  const normalized = {
    version: 1,
    prerequisites: settings.prerequisites.map(row => ({ name: row.name.trim(), path: resolve(row.path) })),
    systemPrompt: settings.systemPrompt,
  }
  writeFileSync(join(cwd, PROJECT_CONFIG), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return result('项目设置', '项目设置已保存。')
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...scrubbedParentEnv(), GIT_TERMINAL_PROMPT: '0' },
    })
    activeCommands.add(child)
    const stdout = emptyTail()
    const stderr = emptyTail()
    let settled = false
    child.stdout.on('data', (chunk: Buffer) => { appendTail(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { appendTail(stderr, chunk) })
    const cleanup = (timer: ReturnType<typeof setTimeout>): void => {
      activeCommands.delete(child)
      clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void terminateProcessTree(child, true).finally(() => {
        cleanup(timer)
        reject(new Error(`${command} 执行超时`))
      })
    }, timeoutMs)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      cleanup(timer)
      const ok = code === 0
      resolveResult({
        ok,
        title: command,
        message: ok ? '命令执行成功。' : `命令退出码 ${String(code)}`,
        stdout: tailText(stdout),
        stderr: tailText(stderr),
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      })
    })
  })
}

/** Build a fixed Gradle invocation without exposing arbitrary renderer arguments. */
export function gradleInvocation(
  cwd: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comSpec = process.env.ComSpec ?? 'cmd.exe',
): { command: string; args: string[] } {
  if (platform === 'win32') {
    return {
      command: comSpec,
      args: ['/d', '/c', existsSync(join(cwd, 'gradlew.bat')) ? 'gradlew.bat' : 'gradle', ...args],
    }
  }
  return {
    command: existsSync(join(cwd, 'gradlew')) ? './gradlew' : 'gradle',
    args: [...args],
  }
}

function gitArgs(request: DesktopCommandRequest): { command: string; args: string[]; title: string } {
  switch (request.kind) {
    case 'git-status': return { command: 'git', args: ['status', '--short', '--branch'], title: 'Git 状态' }
    case 'git-diff': return { command: 'git', args: ['diff', '--'], title: 'Git 差异' }
    case 'git-log': return { command: 'git', args: ['log', '--oneline', '--decorate', '-20'], title: 'Git 日志' }
    case 'git-branch': return request.createBranch
      ? { command: 'git', args: ['switch', '-c', request.branch ?? ''], title: '创建分支' }
      : request.switchBranch
        ? { command: 'git', args: ['switch', request.branch ?? ''], title: '切换分支' }
        : { command: 'git', args: ['branch', '--all'], title: 'Git 分支' }
    case 'git-commit': return { command: 'git', args: ['add', '-A'], title: 'Git 暂存' }
    case 'git-push': return { command: 'git', args: ['push'], title: 'Git Push' }
    case 'git-pull': return { command: 'git', args: ['pull'], title: 'Git Pull' }
    default: throw new Error('不是 Git 命令')
  }
}

function emitGameEvent(event: DesktopGameEvent): void {
  for (const listener of gameEventListeners) listener(event)
}

/** Subscribe to completed game processes; the returned disposer removes only this listener. */
export function onDesktopGameEvent(listener: (event: DesktopGameEvent) => void): () => void {
  gameEventListeners.add(listener)
  return () => { gameEventListeners.delete(listener) }
}

/** Subscribe to Gradle process ownership without exposing process ids to the renderer. */
export function onDesktopGameLifecycle(listener: (event: DesktopGameLifecycleEvent) => void): () => void {
  gameLifecycleListeners.add(listener)
  return () => { gameLifecycleListeners.delete(listener) }
}

function emitGameLifecycle(event: DesktopGameLifecycleEvent): void {
  for (const listener of gameLifecycleListeners) listener(event)
}

/** Return the native menu state for the currently selected project path. */
export function desktopGameMenuState(cwd: string | undefined): DesktopGameMenuState {
  if (cwd === undefined) return 'unavailable'
  let canonical: string
  try {
    canonical = validateCwd(cwd)
  } catch {
    return 'unavailable'
  }
  return activeGames.get(canonical)?.phase ?? 'idle'
}

function waitForSettlement(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveWait) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolveWait(false)
    }, timeoutMs)
    void promise.then(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveWait(true)
    })
  })
}

function runTreeKill(command: string, args: string[]): Promise<void> {
  return new Promise((resolveKill) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' })
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveKill()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish()
    }, GAME_STOP_GRACE_MS)
    child.once('error', finish)
    child.once('exit', finish)
  })
}

async function terminateProcessTree(child: ChildProcess, force: boolean): Promise<void> {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    await runTreeKill('taskkill.exe', ['/pid', String(child.pid), '/t', ...force ? ['/f'] : []])
    return
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(force ? 'SIGKILL' : 'SIGTERM')
  }
}

function gameResult(entry: ActiveGame, ok: boolean, title: string, message: string): DesktopCommandResult {
  const stdout = tailText(entry.stdout)
  const stderr = tailText(entry.stderr)
  return {
    ok,
    title,
    message,
    ...(stdout === '' ? {} : { stdout }),
    ...(stderr === '' ? {} : { stderr }),
  }
}

function attachGameLifecycle(entry: ActiveGame, child: ChildProcessWithoutNullStreams): Promise<void> {
  let finished = false
  const finish = (value: { code: number | null; signal: NodeJS.Signals | null; error?: Error }): void => {
    if (finished) return
    finished = true
    if (activeGames.get(entry.cwd) === entry) activeGames.delete(entry.cwd)
    entry.resolveSettled()
    if (entry.started) emitGameLifecycle({ type: 'exited', cwd: entry.cwd })
    if (!entry.started || entry.stopRequested || !acceptingCommands) return
    const ok = value.error === undefined && value.code === 0
    const message = value.error !== undefined
      ? value.error.message
      : ok
        ? 'Minecraft 开发客户端已关闭。'
        : `Gradle 客户端进程退出码 ${String(value.code ?? value.signal)}`
    emitGameEvent({
      cwd: entry.cwd,
      result: ok
        ? result('游戏已关闭', message)
        : gameResult(entry, false, '游戏运行失败', message),
    })
  }
  child.stdout.on('data', (chunk: Buffer) => { appendTail(entry.stdout, chunk) })
  child.stderr.on('data', (chunk: Buffer) => { appendTail(entry.stderr, chunk) })
  child.once('error', (error) => { finish({ code: null, signal: null, error }) })
  child.once('exit', (code, signal) => { finish({ code, signal }) })
  return new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', () => {
      entry.started = true
      if (child.pid === undefined) {
        rejectSpawn(new Error('Gradle 进程没有可用的进程 ID。'))
        return
      }
      emitGameLifecycle({ type: 'spawned', cwd: entry.cwd, rootPid: child.pid })
      resolveSpawn()
    })
    child.once('error', rejectSpawn)
  })
}

async function discoverClientTask(cwd: string): Promise<{ task?: string; failure?: DesktopCommandResult }> {
  if (!GRADLE_ROOT_FILES.some(file => existsSync(join(cwd, file)))) {
    return { failure: { ok: false, title: '启动游戏', message: '当前项目没有根 Gradle 构建文件。' } }
  }
  const invocation = gradleInvocation(cwd, ['--no-daemon', 'tasks', '--all', '--console=plain'])
  const listed = await runProcess(invocation.command, invocation.args, cwd)
  if (!listed.ok) return { failure: { ...listed, title: '启动游戏', message: '无法读取当前项目的 Gradle 任务。' } }
  if (listed.stdoutTruncated) {
    return {
      failure: {
        ok: false,
        title: '启动游戏',
        message: `Gradle 任务输出超过 ${String(MAX_OUTPUT_BYTES)} 字节，未选择运行任务。`,
        ...(listed.stdout === undefined ? {} : { stdout: listed.stdout }),
        ...(listed.stderr === undefined ? {} : { stderr: listed.stderr }),
      },
    }
  }
  const candidates = runtimeTaskCandidates('client', parseGradleTaskNames(listed.stdout ?? ''))
  if (candidates.length === 0) {
    return { failure: { ok: false, title: '启动游戏', message: '当前项目没有可用的 runClient 或 runGame 根任务。' } }
  }
  if (candidates.length > 1) {
    return {
      failure: {
        ok: false,
        title: '启动游戏',
        message: `当前项目存在多个客户端运行任务：${candidates.join(', ')}。请保留一个明确的根任务。`,
      },
    }
  }
  const task = candidates[0]
  if (task === undefined) throw new Error('runtime task candidate disappeared')
  return { task }
}

async function stopGame(entry: ActiveGame): Promise<DesktopCommandResult> {
  if (entry.child === undefined) {
    return { ok: false, title: '停止游戏', message: '游戏仍在准备启动，请稍后再试。' }
  }
  entry.phase = 'stopping'
  entry.stopRequested = true
  await terminateProcessTree(entry.child, false)
  if (!await waitForSettlement(entry.settled, GAME_STOP_GRACE_MS)) {
    await terminateProcessTree(entry.child, true)
  }
  if (!await waitForSettlement(entry.settled, GAME_STOP_GRACE_MS)) {
    entry.phase = 'running'
    entry.stopRequested = false
    return { ok: false, title: '停止游戏', message: 'Minecraft 进程未能在停止期限内退出。' }
  }
  return result('停止游戏', 'Minecraft 开发客户端已停止。')
}

async function toggleGame(cwd: string): Promise<DesktopCommandResult> {
  const current = activeGames.get(cwd)
  if (current !== undefined) {
    if (current.phase === 'running') return stopGame(current)
    return {
      ok: false,
      title: current.phase === 'starting' ? '启动游戏' : '停止游戏',
      message: current.phase === 'starting' ? '游戏正在启动。' : '游戏正在停止。',
    }
  }
  if (!acceptingCommands) return { ok: false, title: '启动游戏', message: 'CraftCode 正在关闭，无法启动游戏。' }

  let resolveSettled = (): void => {}
  const settled = new Promise<void>((resolveGame) => { resolveSettled = resolveGame })
  const entry: ActiveGame = {
    cwd,
    phase: 'starting',
    stdout: emptyTail(),
    stderr: emptyTail(),
    stopRequested: false,
    started: false,
    settled,
    resolveSettled,
  }
  activeGames.set(cwd, entry)
  try {
    const discovery = await discoverClientTask(cwd)
    if (discovery.failure !== undefined) {
      activeGames.delete(cwd)
      entry.resolveSettled()
      return discovery.failure
    }
    if (!isAcceptingCommands() || activeGames.get(cwd) !== entry) {
      entry.resolveSettled()
      return { ok: false, title: '启动游戏', message: '游戏启动已取消。' }
    }
    const invocation = gradleInvocation(cwd, ['--no-daemon', discovery.task as string, '--console=plain'])
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...scrubbedParentEnv(), GIT_TERMINAL_PROMPT: '0' },
    })
    entry.child = child
    await attachGameLifecycle(entry, child)
    if (activeGames.get(cwd) !== entry) {
      return gameResult(entry, false, '启动游戏', 'Gradle 客户端进程在启动时退出。')
    }
    entry.phase = 'running'
    return result('启动游戏', '正在通过 Gradle 启动 Minecraft 开发客户端。')
  } catch (error) {
    if (activeGames.get(cwd) === entry) activeGames.delete(cwd)
    entry.resolveSettled()
    return {
      ok: false,
      title: '启动游戏',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Stop every command and game process owned by the desktop application. */
export async function stopActiveCommands(): Promise<void> {
  acceptingCommands = false
  const commands = [...activeCommands]
  const games = [...activeGames.values()]
  for (const entry of games) {
    entry.stopRequested = true
    if (entry.child === undefined) activeGames.delete(entry.cwd)
  }
  await Promise.all([
    ...commands.map(child => terminateProcessTree(child, true)),
    ...games.filter((entry): entry is ActiveGame & { child: ChildProcessWithoutNullStreams } => entry.child !== undefined)
      .map(async (entry) => {
        entry.phase = 'stopping'
        await terminateProcessTree(entry.child, false)
        if (!await waitForSettlement(entry.settled, GAME_STOP_GRACE_MS)) {
          await terminateProcessTree(entry.child, true)
          await waitForSettlement(entry.settled, GAME_STOP_GRACE_MS)
        }
      }),
  ])
}

export async function executeDesktopCommand(request: DesktopCommandRequest): Promise<DesktopCommandResult> {
  const cwd = validateCwd(request.cwd)
  switch (request.kind) {
    case 'project-settings-read': return parseSettings(cwd)
    case 'project-settings-write':
      if (request.settings === undefined) throw new Error('缺少项目设置')
      return saveSettings(cwd, request.settings)
    case 'game-toggle': return toggleGame(cwd)
    case 'export-jar': {
      const invocation = gradleInvocation(cwd, ['--no-daemon', 'build'])
      const built = await runProcess(invocation.command, invocation.args, cwd)
      if (!built.ok) return { ...built, title: '导出 JAR' }
      const libs = join(cwd, 'build', 'libs')
      const jars = existsSync(libs) ? readdirSync(libs).filter(name => name.endsWith('.jar')) : []
      return { ...built, title: '导出 JAR', message: jars.length === 0 ? '构建完成，但未找到 JAR。' : `构建完成：${jars.join(', ')}`, path: libs, artifacts: jars }
    }
    default: {
      const git = gitArgs(request)
      if (request.kind === 'git-commit') {
        if (!request.message?.trim()) throw new Error('Commit message 不能为空')
        const staged = await runProcess('git', ['add', '-A'], cwd)
        if (!staged.ok) return staged
        return runProcess(git.command, ['commit', '-m', request.message.trim()], cwd)
      }
      return runProcess(git.command, git.args, cwd)
    }
  }
}
