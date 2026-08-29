import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import type { DesktopCommandRequest, DesktopCommandResult } from './preload.ts'

const PROJECT_CONFIG = '.dsh/project.yaml'
const MAX_OUTPUT = 32_000
const activeCommands = new Set<ReturnType<typeof spawn>>()

/** Stop Git and Gradle commands owned by the closing desktop process. */
export function stopActiveCommands(): void {
  for (const child of activeCommands) child.kill('SIGTERM')
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

function runProcess(command: string, args: string[], cwd: string): Promise<DesktopCommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    activeCommands.add(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${String(chunk)}`.slice(-MAX_OUTPUT) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-MAX_OUTPUT) })
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`${command} 执行超时`)) }, 120_000)
    child.once('error', (error) => { activeCommands.delete(child); clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      activeCommands.delete(child)
      clearTimeout(timer)
      const ok = code === 0
      resolveResult({ ok, title: command, message: ok ? '命令执行成功。' : `命令退出码 ${String(code)}`, stdout, stderr })
    })
  })
}

function gradleInvocation(cwd: string): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/c', existsSync(join(cwd, 'gradlew.bat')) ? 'gradlew.bat' : 'gradle', '--no-daemon', 'build'],
    }
  }
  return {
    command: existsSync(join(cwd, 'gradlew')) ? './gradlew' : 'gradle',
    args: ['--no-daemon', 'build'],
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

export async function executeDesktopCommand(request: DesktopCommandRequest): Promise<DesktopCommandResult> {
  const cwd = validateCwd(request.cwd)
  switch (request.kind) {
    case 'project-settings-read': return parseSettings(cwd)
    case 'project-settings-write':
      if (request.settings === undefined) throw new Error('缺少项目设置')
      return saveSettings(cwd, request.settings)
    case 'export-jar': {
      const invocation = gradleInvocation(cwd)
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
