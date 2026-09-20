import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { DesktopCommandRequest, DesktopCommandResult } from './preload.ts'

const PROJECT_CONFIG = '.dsh/project.yaml'
const MAX_OUTPUT_BYTES = 32_000
const COMMAND_TIMEOUT_MS = 120_000
const COMMAND_STOP_GRACE_MS = 5_000

interface OutputTail {
  buffer: Buffer
  truncated: boolean
}

interface ProcessResult extends DesktopCommandResult {
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

const activeCommands = new Set<ChildProcess>()
let acceptingCommands = true

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
    }, COMMAND_STOP_GRACE_MS)
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

/** Stop command processes owned by Electron; the backend disposes its Minecraft runs. */
export async function stopActiveCommands(): Promise<void> {
  acceptingCommands = false
  await Promise.all([...activeCommands].map(child => terminateProcessTree(child, true)))
}

export async function executeDesktopCommand(request: DesktopCommandRequest): Promise<DesktopCommandResult> {
  if (!acceptingCommands) throw new Error('桌面正在关闭。')
  const cwd = validateCwd(request.cwd)
  switch (request.kind) {
    case 'project-settings-read': return parseSettings(cwd)
    case 'project-settings-write':
      if (request.settings === undefined) throw new Error('缺少项目设置')
      return saveSettings(cwd, request.settings)
    case 'game-toggle': return { ok: false, title: '启动游戏', message: '游戏运行由工作台宿主管理，请连接宿主后重试。' }
    case 'export-jar': return { ok: false, title: '导出模组', message: '请连接工作台宿主后导出。' }
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
