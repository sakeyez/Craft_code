import {
  networkJavaEnvironment,
  networkGradleArguments,
  isMinecraftNetworkFailure,
  automaticMinecraftNetwork,
} from './network.ts'
import { workbenchIdSchema } from './contracts.ts'
import { classifyFailure } from './failures.ts'
import { selectJava } from './java-selection.ts'
import { projectInputs } from './project-inputs.ts'
import { preparationScript } from './preparation.ts'
import { repairLoomManifest } from './loom-cache.ts'
import { developmentEnvironment, findDevelopmentJava, saveDevelopmentEnvironment } from './development-environment.ts'
import { acceptArtifact, buildFactsSchema, buildInspectionScript } from './artifact.ts'
import { prepareInstance } from './instances.ts'
import { syncInstanceMods } from './instance-mods.ts'
import { recordApiClasspath } from './api-query.ts'
/** Project-scoped development runs, reconnectable status and retained logs. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, appendFile, readdir, open, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { inspectMinecraftProject, validateMinecraftProject } from '@deepseek-ai/dsh-tool-mc-project'
import {
  parseGradleTaskNames,
  hasMinecraftReadiness,
  runtimeTaskCandidates,
} from '@deepseek-ai/dsh-tool-mc-project/gradle-tasks'
import { ensureJava, findJava, javaEnv, requiredJava, probe } from './environment.ts'
import { projectPath, projectRoot, readText } from './files.ts'
import { runProcess } from './process.ts'
import type { ProcessRunner } from './process.ts'
import type { CheckResult } from '@deepseek-ai/dsh-tool-mc-project'
import type {} from '@deepseek-ai/dsh-shell'
import { runSchema } from './contracts.ts'
import type { JavaEnvironment, LogChunk, ProjectFacts, RunAction, RunSnapshot, RunOptions } from './types.ts'

const TERMINAL = new Set(['exited', 'failed', 'cancelled', 'interrupted'])
interface Operation {
  snapshot: RunSnapshot
  controller: AbortController
  done: Promise<void>
  writes: Promise<void>
  runner: ProcessRunner
  ready: boolean
  pid?: number
  loader?: string
  javaPaths?: string[]
  gradleUserHome?: string
}

/**
 * Owns every Minecraft development process launched by menus, tools and the test page.
 */
export class MinecraftRuns {
  private readonly operations = new Map<string, Operation>()
  private readonly reserved = new Set<string>()
  constructor(private readonly ctx: Context) {}

  /**
   * Hold a project idle while a dependency transaction changes its build inputs.
   * @param cwd - Absolute project directory.
   * @param action - Awaited mutation, including rollback on failure.
   * @returns The committed mutation result.
   */
  async whileIdle<T>(cwd: string, action: () => Promise<T>): Promise<T> {
    const root = await projectRoot(cwd)
    if (
      this.reserved.has(root) ||
      [...this.operations.values()].some(op => op.snapshot.cwd === root && !TERMINAL.has(op.snapshot.phase))
    )
      throw new Error('请停止当前项目运行后再修改依赖。')
    this.reserved.add(root)
    try {
      return await action()
    } finally {
      this.reserved.delete(root)
    }
  }

  /**
   * Discover project facts, toolchain pins and supported layout constraints.
   * @param cwd - Absolute project directory.
   * @param signal - Cancellation signal for the caller-owned operation.
   * @returns Discover project facts, toolchain pins and supported layout constraints.
   */
  async inspect(cwd: string, signal?: AbortSignal): Promise<ProjectFacts> {
    const root = await projectRoot(cwd)
    const project = await inspectMinecraftProject(this.ctx, root, signal)
    let reason: string | undefined
    let major = 21
    if (project.loaderSupport !== 'supported') reason = '仅支持 Fabric 和 NeoForge Java 模组。'
    else if (!project.scanComplete) reason = '项目扫描不完整，请先解决检测警告。'
    else if (project.minecraftVersion.status !== 'determined' || project.minecraftVersion.classification !== 'exact')
      reason = '无法确定唯一 Minecraft 版本，请检查 Gradle 和模组元数据。'
    else {
      try {
        major = requiredJava(project.minecraftVersion.value)
      } catch (error) {
        reason = String(error)
      }
    }
    for (const name of ['settings.gradle', 'settings.gradle.kts']) {
      const settings = await readText(root, name).catch(() => undefined)
      if (settings && /\binclude(?:Build|Flat)?\s*(?:\(|["'])/u.test(settings.text))
        reason = '多模块和 included-build 项目需要人工配置测试任务。'
    }
    const wrapper = await readText(root, 'gradle/wrapper/gradle-wrapper.properties').catch(() => undefined)
    if (!wrapper) reason ??= '缺少项目 Gradle Wrapper，请先恢复 Wrapper 文件。'
    const gradleVersion = wrapper && /gradle-([\d.]+)-(?:bin|all)\.zip/u.exec(wrapper.text)?.[1]
    let javaRoles: ProjectFacts['javaRoles']
    if (!reason && project.minecraftVersion.status === 'determined') {
      try {
        const binding = await developmentEnvironment(root, project.inspected.gradleFiles)
        const selected = await selectJava(
          root,
          project.minecraftVersion.value,
          gradleVersion,
          project.inspected.gradleFiles,
          binding.gradleUserHome,
        )
        const environments = new Map<number, JavaEnvironment>()
        for (const value of new Set([selected.gradle, selected.compiler, selected.game]))
          environments.set(value, await findDevelopmentJava(this.ctx, binding, value, signal ?? new AbortController().signal))
        const gradle = selected.gradleHome
          ? await probe(
            this.ctx,
            join(selected.gradleHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
            selected.gradle,
            signal ?? new AbortController().signal,
            false,
          )
          : environments.get(selected.gradle)
        const compiler = environments.get(selected.compiler)
        const game = environments.get(selected.game)
        if (!gradle || !compiler || !game) throw new Error('Java 角色未解析完整。')
        javaRoles = {
          gradle,
          compiler,
          game,
          basis: selected.basis,
        }
        major = selected.gradle
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error)
      }
    }
    return {
      project,
      java: javaRoles?.gradle ?? (await findJava(this.ctx, major, signal)),
      ...(javaRoles ? { javaRoles } : {}),
      ...(gradleVersion ? { gradleVersion } : {}),
      supported: !reason,
      ...(reason ? { reason } : {}),
    }
  }

  /**
   * Read retained runs and classify old live records as interrupted.
   * @param cwd - Absolute project directory.
   * @returns Read retained runs and classify old live records as interrupted.
   */
  async history(cwd: string): Promise<RunSnapshot[]> {
    const root = await projectRoot(cwd)
    const directory = await projectPath(root, '.dsh/runs', true)
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    })
    const rows: RunSnapshot[] = []
    for (const entry of entries.slice(-100)) {
      if (!entry.isDirectory() || !/^[a-f\d-]{36}$/u.test(entry.name)) continue
      const live = this.operations.get(entry.name)
      if (live) {
        rows.push(live.snapshot)
        continue
      }
      const path = await projectPath(root, `.dsh/runs/${entry.name}/state.json`)
      const value = await readFile(path, 'utf8')
        .then(text => runSchema.parse(JSON.parse(text)))
        .catch(() => undefined)
      if (
        !value ||
        value.id !== entry.name ||
        value.cwd !== root ||
        typeof value.phase !== 'string' ||
        typeof value.startedAt !== 'string'
      )
        continue
      if (value.action === 'client' && value.format !== 4 && value.evidence?.worldReadyAt)
        value.evidence = { ...value.evidence, worldReadyAt: undefined }
      rows.push(
        TERMINAL.has(value.phase)
          ? value
          : { ...value, phase: 'interrupted', message: '宿主已重启；此运行没有自动恢复。' },
      )
    }
    return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30)
  }

  /**
   * Reserve a project and launch one host-owned development operation.
   * @param cwd - Absolute project directory.
   * @param action - Preparation, build or explicitly authorized runtime action.
   * @param runner - Optional execution provider retaining its existing shell policy.
   * @returns Reserve a project and launch one host-owned development operation.
   * @param options - Development/artifact mode and dependency selection.
   */
  async start(cwd: string, action: RunAction, runner?: ProcessRunner, options: RunOptions = {}): Promise<RunSnapshot> {
    const root = await projectRoot(cwd)
    if (
      this.reserved.has(root) ||
      [...this.operations.values()].some(op => op.snapshot.cwd === root && !TERMINAL.has(op.snapshot.phase))
    )
      throw new Error('当前项目已有运行任务，请先停止或等待完成。')
    this.reserved.add(root)
    try {
      const id = workbenchIdSchema.parse(randomUUID())
      const startedAt = new Date().toISOString()
      const directory = await projectPath(root, `.dsh/runs/${id}`, true)
      await mkdir(directory, { recursive: true })
      const snapshot: RunSnapshot = {
        format: 4,
        offline: options.offline ?? false,
        mode: options.mode ?? 'development',
        dependencies: options.dependencies ?? 'selected',
        id,
        cwd: root,
        action,
        phase: 'preparing',
        startedAt,
        updatedAt: startedAt,
        message: '正在检查项目环境',
        logPath: `.dsh/runs/${id}/output.log`,
        steps: [],
      }
      await writeFile(join(root, snapshot.logPath), '')
      const operation: Operation = {
        snapshot,
        controller: new AbortController(),
        done: Promise.resolve(),
        writes: Promise.resolve(),
        runner: runner ?? (options => runProcess(this.ctx, options)),
        ready: false,
      }
      this.operations.set(id, operation)
      await this.update(operation, {})
      operation.done = (
        this.ctx.get('minecraftWorkbench')?.network.run(() => this.execute(operation)) ?? this.execute(operation)
      ).catch(async (error: unknown) => {
        await this.log(operation, `[失败] ${error instanceof Error ? error.message : String(error)}\n`)
        await this.update(operation, {
          phase: operation.controller.signal.aborted ? 'cancelled' : 'failed',
          message: error instanceof Error ? error.message : String(error),
          failure: classifyFailure(error),
          ...(operation.snapshot.evidence
            ? {
              evidence: {
                ...operation.snapshot.evidence,
                exitReason: operation.controller.signal.aborted ? 'cancelled' : 'failure',
              },
            }
            : {}),
        })
      })
      // Errors caused by a full/unwritable log volume still settle the operation.
      void operation.done.catch((error: unknown) => {
        operation.snapshot = { ...operation.snapshot, phase: 'failed', message: String(error) }
      })
      return operation.snapshot
    } finally {
      this.reserved.delete(root)
    }
  }

  /**
   * Start a new attempt after rechecking facts; historical tasks never resume a process automatically.
   * @param cwd - Absolute project root.
   * @param id - Identity returned by the owning operation.
   * @returns Fresh run identity with rechecked inputs.
   */
  async retry(cwd: string, id: string): Promise<RunSnapshot> {
    const previous = (await this.history(cwd)).find(run => run.id === id)
    if (
      !previous ||
      !TERMINAL.has(previous.phase) ||
      !(previous.failure?.retryable || previous.phase === 'interrupted' || previous.phase === 'cancelled')
    )
      throw new Error('此任务不能重试，请修正项目后重新构建。')
    return this.start(cwd, previous.action, undefined, {
      mode: previous.mode ?? 'development',
      dependencies: previous.dependencies ?? 'selected',
      offline: previous.offline ?? false,
    })
  }

  /**
   * Use the same lifecycle for approved model probes while retaining the mounted shell policy.
   * @param cwd - Absolute project directory.
   * @param mode - Requested runtime side or comparison mode.
   * @param signal - Cancellation signal for the caller-owned operation.
   * @param timeoutMs - Maximum command duration in milliseconds.
   * @returns Use the same lifecycle for approved model probes while retaining the mounted shell policy.
   * @param testMode - Development tasks or isolated artifact test; defaults to development.
   */
  async check(
    cwd: string,
    mode: 'client' | 'server',
    signal: AbortSignal,
    timeoutMs: number = 120_000,
    testMode: 'development' | 'artifact' = 'development',
  ): Promise<CheckResult> {
    const shell = this.ctx.get('shell')
    if (!shell) throw new Error('模型运行验证需要已挂载的 shell。')
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30 * 60 * 1000)
      throw new Error('运行超时必须介于 1 毫秒与 30 分钟之间。')
    const commands: string[] = []
    const probe = { timedOut: false }
    const runner: ProcessRunner = async (options) => {
      const wrapper =
        process.platform === 'win32' ? options.argv[3] === 'gradlew.bat' : options.argv[0]?.endsWith('/gradlew')
      const args = wrapper
        ? [
          process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew',
          ...options.argv.slice(process.platform === 'win32' ? 4 : 1),
        ]
        : options.argv
      const command =
        process.platform === 'win32'
          ? '& ' + args.map(arg => "'" + arg.replaceAll("'", "''") + "'").join(' ')
          : args.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(' ')
      commands.push(command)
      const env = Object.fromEntries(
        Object.entries(options.env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      const deadlineSignal = AbortSignal.timeout(timeoutMs)
      const child = shell.start(
        shell.resolve({
          command,
          workdir: options.cwd,
          env,
          signal: AbortSignal.any([signal, options.signal, deadlineSignal]),
          timeoutMs,
          stdoutMaxBytes: 1024 * 1024,
        }),
      )
      let text = ''
      let truncated = false
      let pending = Promise.resolve()
      let outputError: unknown
      const drain = async (): Promise<void> => {
        const chunk = child.readOutput()
        truncated ||= chunk.lossy
        text += chunk.delta
        if (Buffer.byteLength(text) > 1024 * 1024) {
          text = text.slice(-256_000)
          truncated = true
        }
        await options.output?.(chunk.delta, 'stdout')
        if (chunk.lossy)
          await options.output?.(
            `\n[完整 shell 日志] ${chunk.stdoutSpillPath ?? ''} ${chunk.stderrSpillPath ?? ''}\n`,
            'stdout',
          )
      }
      const timer = setInterval(() => {
        pending = pending.then(drain).catch((error: unknown) => {
          outputError = error
          child.kill()
        })
      }, 100)
      try {
        await child.done
        probe.timedOut ||= deadlineSignal.aborted
        clearInterval(timer)
        await pending
        if (outputError) throw new Error('运行日志写入失败。', { cause: outputError })
        await drain()
        if (child.sandbox?.denied) throw new Error(`shell 沙箱拒绝运行：${child.sandbox.mode}`)
        return { exitCode: child.exitCode, text, truncated }
      } finally {
        clearInterval(timer)
        child.kill()
        await child.done
      }
    }
    const started = await this.start(cwd, mode, runner, { mode: testMode })
    const operation = this.operations.get(started.id)
    if (!operation) throw new Error('运行任务未登记。')
    const abort = (): void => {
      operation.controller.abort(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      while (!TERMINAL.has(operation.snapshot.phase) && !operation.ready)
        await Promise.race([operation.done, new Promise(resolve => setTimeout(resolve, 100))])
      if (operation.ready) await this.stop(cwd, started.id)
      await operation.done
      const passed = operation.ready && !signal.aborted
      if (passed)
        await this.update(operation, {
          phase: 'exited',
          exitCode: 0,
          message: '启动验证已发现世界就绪日志，验证进程已停止。',
        })
      const waitingForWorld = mode === 'client' && !passed && !signal.aborted && probe.timedOut &&
        !!operation.snapshot.evidence?.processStartedAt
      if (waitingForWorld) await this.update(operation, {
        phase: 'exited', failure: undefined,
        message: '客户端已初始化；限时探测结束，世界就绪与玩法未验证。',
        evidence: { ...operation.snapshot.evidence, gameplay: 'unverified', exitReason: 'probe-timeout' },
      })
      const snapshot = operation.snapshot
      return {
        commands,
        exitCode: passed ? 0 : (snapshot.exitCode ?? null),
        steps: [
          {
            step: 'startup',
            status: passed ? 'passed' : waitingForWorld ? 'skipped' : 'failed',
            exitCode: passed ? 0 : (snapshot.exitCode ?? null),
            stdout: { text: '', truncated: true, spillPath: join(cwd, snapshot.logPath) },
            stderr: { text: '', truncated: false },
            timedOut: probe.timedOut && !signal.aborted,
            aborted: signal.aborted,
            signal: null,
            message: snapshot.message,
          },
        ],
        failedStep: passed || waitingForWorld ? null : 'startup',
        suggestedNextAction: waitingForWorld ? 'Client initialized; world readiness and gameplay remain unverified.' : passed
          ? null
          : 'Inspect the retained run log, fix the failing phase and repeat the startup check.',
      }
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }

  /**
   * Cancel the selected operation and wait for process-tree and log drain.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   */
  async stop(cwd: string, id: string): Promise<void> {
    const root = await projectRoot(cwd)
    const operation = this.operations.get(id)
    if (!operation || operation.snapshot.cwd !== root) throw new Error('运行任务不属于当前项目或已结束。')
    if (TERMINAL.has(operation.snapshot.phase)) return
    await this.update(operation, { phase: 'stopping', message: '正在停止进程树' })
    operation.controller.abort(new Error('用户取消运行'))
    await operation.done
  }

  /**
   * Read a bounded UTF-8 log chunk at the requested byte cursor.
   * @param cwd - Absolute project directory.
   * @param id - Identifier returned by the owning operation.
   * @param cursor - UTF-8 byte offset returned by the previous log read.
   * @returns Read a bounded UTF-8 log chunk at the requested byte cursor.
   */
  async logs(cwd: string, id: string, cursor: number): Promise<LogChunk> {
    if (!/^[a-f\d-]{36}$/u.test(id) || !Number.isSafeInteger(cursor) || cursor < 0) throw new Error('日志请求无效。')
    const root = await projectRoot(cwd)
    const file = await projectPath(root, `.dsh/runs/${id}/output.log`)
    const handle = await open(file, 'r')
    try {
      const size = (await handle.stat()).size
      if (cursor > size) cursor = 0
      const bytes = Buffer.alloc(Math.min(64 * 1024, size - cursor))
      const read = await handle.read(bytes, 0, bytes.length, cursor)
      let end = read.bytesRead
      if (cursor + end < size) {
        while (end > 0 && (bytes.readUInt8(end - 1) & 0xc0) === 0x80) end--
        if (end > 0 && bytes.readUInt8(end - 1) >= 0xc0) end--
      }
      const next = cursor + end
      return { text: bytes.subarray(0, end).toString('utf8'), cursor: next, complete: next >= size }
    } finally {
      await handle.close()
    }
  }

  /**
   * Expose a live client process identity to the trusted desktop host.
   * @param cwd - Absolute project directory.
   * @returns Expose a live client process identity to the trusted desktop host.
   */
  nativeState(cwd: string): { id: string; pid: number } | undefined {
    const operation = [...this.operations.values()].find(
      op => op.snapshot.cwd === cwd && op.snapshot.action === 'client' && !TERMINAL.has(op.snapshot.phase) && op.pid,
    )
    return operation?.pid ? { id: operation.snapshot.id, pid: operation.pid } : undefined
  }

  /**
   * Write acceptance only to a recognized pending server EULA file.
   * @param cwd - Absolute project directory.
   * @param path - Workspace-relative path within the selected project or source root.
   */
  async acceptEula(cwd: string, path: string): Promise<void> {
    const root = await projectRoot(cwd)
    if (
      !/^(?:run|runs\/server|run-server|\.dsh\/instances\/(?:fabric|neoforge)-[\w.+-]+\/server)\/eula\.txt$/u.test(path)
    )
      throw new Error('未识别的服务端 EULA 路径。')
    const file = await projectPath(root, path)
    const prior = await readFile(file, 'utf8')
    if (!/^eula=false\s*$/mu.test(prior)) throw new Error('此文件没有待接受的 EULA 声明。')
    await writeFile(file, prior.replace(/^eula=false\s*$/mu, 'eula=true'))
  }

  /**
   * Cancel and settle all owned project operations during host teardown.
   */
  async dispose(): Promise<void> {
    for (const operation of this.operations.values()) operation.controller.abort(new Error('宿主关闭'))
    await Promise.allSettled([...this.operations.values()].map(operation => operation.done))
  }

  private async update(operation: Operation, patch: Partial<RunSnapshot>): Promise<void> {
    const at = new Date().toISOString()
    const next = { ...operation.snapshot, ...patch, updatedAt: at }
    if (
      !next.steps?.length ||
      (patch.phase && patch.phase !== operation.snapshot.phase) ||
      (patch.message && patch.message !== operation.snapshot.message)
    ) {
      next.steps = [...(next.steps ?? []), { phase: next.phase, message: next.message.slice(0, 4096), at }].slice(-64)
    }
    operation.snapshot = next
    const snapshot = operation.snapshot
    operation.writes = operation.writes.then(async () => {
      const path = await projectPath(snapshot.cwd, `.dsh/runs/${snapshot.id}/state.json`, true)
      const temporary = path + '.tmp'
      await writeFile(temporary, JSON.stringify(snapshot))
      await rename(temporary, path)
    })
    await operation.writes
  }

  private async log(operation: Operation, text: string): Promise<void> {
    await appendFile(await projectPath(operation.snapshot.cwd, operation.snapshot.logPath), text)
  }

  private async gradle(
    operation: Operation,
    java: JavaEnvironment,
    args: string[],
    runtime: boolean = false,
    officialOnly = operation.snapshot.mode !== 'artifact',
    directFallback = false,
    deadline = Date.now() + 30 * 60 * 1000,
  ): Promise<{ text: string; truncated: boolean; exitCode: number | null }> {
    const { cwd } = operation.snapshot
    const wrapper = await projectPath(cwd, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
    const networkArgs = await networkGradleArguments(operation.loader ?? 'unknown', officialOnly)
    if (operation.snapshot.offline) networkArgs.push('--offline')
    if (operation.javaPaths?.length)
      networkArgs.push(`-Porg.gradle.java.installations.paths=${operation.javaPaths.join(',')}`)
    const argv =
      process.platform === 'win32'
        ? [
          process.env.ComSpec ?? 'cmd.exe',
          '/d',
          '/c',
          'gradlew.bat',
          ...args,
          ...networkArgs,
          '--console=plain',
          '--stacktrace',
          ...(runtime ? ['--no-daemon'] : []),
        ]
        : [wrapper, ...args, ...networkArgs, '--console=plain', '--stacktrace', ...(runtime ? ['--no-daemon'] : [])]
    await this.log(operation, `\n[${runtime ? '游戏' : '构建'}] Gradle ${args.join(' ')}\n`)
    const signal = runtime
      ? operation.controller.signal
      : AbortSignal.any([operation.controller.signal, AbortSignal.timeout(Math.max(1, deadline - Date.now()))])
    let readiness = ''
    const result = await operation.runner({
      cwd,
      argv,
      signal,
      env: {
        ...javaEnv(java),
        ...(operation.gradleUserHome ? { GRADLE_USER_HOME: operation.gradleUserHome } : {}),
        ...(await networkJavaEnvironment(directFallback)),
      },
      spawned: (child) => {
        if (runtime) operation.pid = child.pid
      },
      output: async (text, stream) => {
        await this.log(operation, `${stream === 'stderr' ? '[stderr] ' : ''}${text}`)
        if (runtime && operation.snapshot.phase === 'starting')
          await this.update(operation, { phase: 'running', message: '正在执行运行任务；等待游戏就绪日志' })
        readiness = (readiness + text).slice(-8192)
        if (runtime && !operation.snapshot.evidence?.processStartedAt &&
          /\[Render thread\/|Starting minecraft server version/u.test(readiness)) {
          await this.update(operation, { evidence: { ...operation.snapshot.evidence, gameplay: 'unverified', processStartedAt: new Date().toISOString() } })
        }
        const ready = hasMinecraftReadiness(operation.snapshot.action === 'server' ? 'server' : 'client', readiness)
        if (runtime && operation.snapshot.phase === 'running' && ready) {
          operation.ready = true
          await this.update(operation, {
            phase: 'ready',
            message: '世界就绪；玩法未验证。',
            evidence: { ...operation.snapshot.evidence, gameplay: 'unverified', worldReadyAt: new Date().toISOString() },
          })
        }
      },
    })
    if (!runtime && !directFallback && result.exitCode !== 0 && !signal.aborted && operation.loader === 'fabric' &&
      operation.gradleUserHome && /MalformedJsonException:[^\n]* path \$\.versions\[/u.test(result.text) &&
      await repairLoomManifest(operation.gradleUserHome)) {
      await this.log(operation, '[缓存] 已从有效本地清单修复损坏的 Loom 元数据；原文件已保留。\n')
      return this.gradle(operation, java, args, false, true, true, deadline)
    }
    if (
      !runtime &&
      !operation.snapshot.offline &&
      !directFallback &&
      result.exitCode !== 0 &&
      !signal.aborted &&
      isMinecraftNetworkFailure(result.text)
    ) {
      if (!officialOnly) {
        await this.log(operation, '[网络] 下载失败，保留缓存并使用官方源重试。\n')
        return this.gradle(operation, java, args, false, true, false, deadline)
      }
      if (automaticMinecraftNetwork()) {
        await this.log(operation, '[网络] 官方源仍不可达，尝试直连；如仍失败，请打开网络设置检测连接。\n')
        return this.gradle(operation, java, args, false, true, true, deadline)
      }
    }
    return result
  }

  private async execute(operation: Operation): Promise<void> {
    const { cwd, action } = operation.snapshot
    if (operation.snapshot.offline && operation.snapshot.mode === 'artifact') throw new Error('离线选项仅适用于开发任务。')
    const signal = operation.controller.signal
    const facts = await this.inspect(cwd, signal)
    if (!facts.supported) throw new Error(facts.reason)
    operation.loader = facts.project.loader
    let lastProgress = 0
    const progress = (received: number, total?: number): void => {
      if (Date.now() - lastProgress < 1000 && received !== total) return
      lastProgress = Date.now()
      const steps = [...(operation.snapshot.steps ?? [])]
      const step = steps.at(-1)
      if (step) steps[steps.length - 1] = { ...step, received, ...(total ? { total } : {}) }
      void this.update(operation, { steps }).catch((error: unknown) => {
        operation.controller.abort(error)
      })
    }
    if (operation.snapshot.offline && (!facts.java.available ||
      [facts.javaRoles?.compiler, facts.javaRoles?.game].some(jdk => jdk && !jdk.available)))
      throw new Error('离线模式缺少所需 JDK，请联网准备环境。')
    const java = facts.java.available
      ? facts.java
      : await ensureJava(this.ctx, facts.java.major, signal, text => this.log(operation, text), progress)
    const jdks = [java]
    for (const major of new Set([facts.javaRoles?.compiler.major, facts.javaRoles?.game.major])) {
      if (major && !jdks.some(jdk => jdk.major === major))
        jdks.push([facts.javaRoles?.compiler, facts.javaRoles?.game].find(jdk => jdk?.major === major && jdk.available)
          ?? await ensureJava(this.ctx, major, signal, text => this.log(operation, text), progress))
    }
    const binding = await developmentEnvironment(cwd, facts.project.inspected.gradleFiles)
    operation.gradleUserHome = binding.gradleUserHome
    await saveDevelopmentEnvironment(cwd, binding, jdks)
    operation.javaPaths = jdks.flatMap(jdk => (jdk.executable ? [dirname(dirname(jdk.executable))] : []))
    await this.log(operation, `[Java] ${JSON.stringify(facts.javaRoles?.basis ?? { gradle: facts.java.major })}\n`)
    let names = binding.tasks
    if (!names) {
      const tasks = await this.gradle(operation, java, ['tasks', '--all'])
      if (tasks.exitCode !== 0 || tasks.truncated) throw Object.assign(new Error('Gradle 任务发现失败或输出不完整，请查看日志。'), {
        code: isMinecraftNetworkFailure(tasks.text) ? 'NETWORK' : 'COMPILE',
      })
      names = parseGradleTaskNames(tasks.text)
      await saveDevelopmentEnvironment(cwd, { ...binding, tasks: names }, jdks)
    }
    if (action === 'prepare') {
      const candidates = runtimeTaskCandidates('client', names)
      const runtimeTask = candidates[0]
      if (candidates.length !== 1 || !runtimeTask) throw new Error(`无法确定客户端任务：${candidates.join('、') || '未发现任务'}。`)
      const task = 'craftcodePrepareRun'
      const script = `.dsh/runs/${operation.snapshot.id}/prepare.gradle`
      const destination = `.dsh/runs/${operation.snapshot.id}/preparation.json`
      const inputs = await projectInputs(cwd, signal)
      await writeFile(await projectPath(cwd, script, true), preparationScript(runtimeTask, destination))
      await this.update(operation, { message: `正在准备 ${candidates[0]} 的运行依赖` })
      const prepared = await this.gradle(operation, java, ['--init-script', script, task])
      if (prepared.exitCode !== 0) throw new Error('运行依赖准备失败，请查看具体 Gradle 日志。')
      if ((await projectInputs(cwd, signal)).fingerprint !== inputs.fingerprint)
        throw new Error('准备期间项目输入已变化，请重新准备。')
      const evidence = JSON.parse(await readFile(await projectPath(cwd, destination), 'utf8')) as unknown
      if (!evidence || typeof evidence !== 'object' || !('verified' in evidence) || evidence.verified !== true)
        throw new Error('运行输入未验证；可直接启动项目运行任务。')
      await this.update(operation, { phase: 'exited', exitCode: 0, message: '客户端运行依赖已准备；离线启动尚未验证。' })
      return
    }
    if (operation.snapshot.mode !== 'artifact' && action !== 'build') {
      const candidates = runtimeTaskCandidates(action, names)
      const runtimeTask = candidates[0]
      if (candidates.length !== 1 || !runtimeTask) throw new Error(`无法确定运行任务：${candidates.join('、') || '未发现任务'}。`)
      await this.update(operation, { phase: 'starting', message: `正在执行 ${candidates[0]}`, evidence: { gameplay: 'unverified' } })
      const result = await this.gradle(operation, java, [runtimeTask], true)
      delete operation.pid
      let eulaPath: string | undefined
      if (action === 'server') {
        for (const directory of ['run', 'runs/server', 'run-server']) {
          const path = `${directory}/eula.txt`
          const content = await readText(cwd, path).catch(() => undefined)
          if (content && /^eula=false\s*$/mu.test(content.text)) { eulaPath = path; break }
        }
      }
      await this.update(operation, {
        phase: result.exitCode === 0 && !eulaPath ? 'exited' : 'failed', exitCode: result.exitCode,
        ...(eulaPath ? { eulaPath } : {}),
        message: eulaPath ? '服务端要求阅读并接受 Minecraft EULA。' : `运行已退出（${String(result.exitCode)}）；玩法未验证。`,
        ...(result.exitCode !== 0 ? { failure: classifyFailure(Object.assign(new Error(result.text.slice(-4096)), {
          code: isMinecraftNetworkFailure(result.text) ? 'NETWORK' : 'COMPILE',
        })) } : {}),
        evidence: { ...operation.snapshot.evidence, gameplay: 'unverified', exitReason: result.exitCode === 0 ? 'process-exit' : 'process-failure' },
      })
      return
    }
    if (operation.snapshot.mode === 'artifact') {
      if (facts.project.datagenClues.length) {
        const datagen = names.filter(name => /^(?:runDatagen|runData|runDataGenerator)$/u.test(name))
        if (datagen.length !== 1) throw new Error('项目包含 datagen 配置，但无法确定唯一生成任务。')
        const task = datagen[0]
        if (!task) throw new Error('未发现 datagen 任务。')
        const generated = await this.gradle(operation, java, [task])
        if (generated.exitCode !== 0) throw new Error('资源生成失败，未启动游戏。')
      }
      await this.update(operation, { phase: 'validating', message: '正在校验 Minecraft 资源' })
      const validation = await validateMinecraftProject(this.ctx, cwd, signal)
      await this.log(operation, `[资源校验] ${JSON.stringify(validation)}\n`)
      if (validation.errors.length || !validation.scanComplete) throw new Error('资源校验失败或扫描不完整。')
    }
    await this.update(operation, { phase: 'building', message: '正在构建项目' })
    const inputs = await projectInputs(cwd, signal)
    const build = await this.gradle(operation, java, operation.snapshot.mode === 'artifact' ? ['processResources', 'test', 'build'] : ['build'])
    if (build.exitCode !== 0)
      throw Object.assign(new Error('构建失败，未启动游戏。'), {
        code: isMinecraftNetworkFailure(build.text) ? 'NETWORK' : 'COMPILE',
      })
    {
      const task = `craftcodeInspect${operation.snapshot.id.replaceAll('-', '')}`
      const destination = `.dsh/runs/${operation.snapshot.id}/build-facts.json`
      const script = `.dsh/runs/${operation.snapshot.id}/inspect.gradle`
      await writeFile(await projectPath(cwd, script, true), buildInspectionScript(task, destination))
      const inspected = await this.gradle(operation, java, ['--init-script', script, task])
      if (inspected.exitCode !== 0) throw new Error('Gradle 产物与加载器解析失败，请查看日志。')
      const buildFacts = buildFactsSchema.parse(JSON.parse(await readFile(await projectPath(cwd, destination), 'utf8')))
      if ((await projectInputs(cwd, signal)).fingerprint !== inputs.fingerprint)
        throw new Error('构建期间项目输入已变化，请重新构建。')
      await recordApiClasspath(
        cwd,
        buildFacts,
        facts.project,
        inputs.fingerprint,
        facts.javaRoles?.compiler.major ?? java.major,
      )
      {
        const artifact = await acceptArtifact(cwd, facts.project, buildFacts, inputs.fingerprint)
        await this.update(operation, { artifact, evidence: { gameplay: 'unverified' } })
        if (action !== 'build') {
          const gameJava = jdks.find(jdk => jdk.major === facts.javaRoles?.game.major) ?? java
          if (!gameJava.executable) throw new Error('游戏 Java 未就绪。')
          await this.update(operation, { phase: 'preparing', message: '正在安装成品测试实例' })
          const instance = await prepareInstance(
            cwd,
            artifact,
            action,
            gameJava.executable,
            operation.controller,
            operation.runner,
            text => this.log(operation, text),
            progress,
          )
          const workbench = this.ctx.get('minecraftWorkbench')
          if (!workbench) throw new Error('成品测试需要 Minecraft 工作台依赖服务。')
          await syncInstanceMods(
            cwd,
            instance.directory,
            artifact,
            (await workbench.dependencies.read(cwd)).dependencies,
            action,
            operation.snapshot.dependencies ?? 'selected',
            gameJava.major,
          )
          await this.update(operation, { instance: instance.relative })
          if (
            action === 'server' &&
            !/^eula=true\s*$/mu.test(await readFile(join(instance.directory, 'eula.txt'), 'utf8'))
          ) {
            await this.update(operation, {
              phase: 'failed',
              eulaPath: `${instance.relative}/eula.txt`,
              message: '服务端要求阅读并接受 Minecraft EULA。',
            })
            return
          }
          await this.update(operation, { phase: 'starting', message: '正在启动成品游戏' })
          let readiness = ''
          const result = await operation.runner({
            cwd: instance.directory,
            argv: instance.argv,
            signal,
            env: javaEnv(gameJava),
            spawned: (child) => {
              operation.pid = child.pid
              void this.update(operation, {
                evidence: {
                  ...operation.snapshot.evidence,
                  gameplay: 'unverified',
                  processStartedAt: new Date().toISOString(),
                },
              }).catch((error: unknown) => {
                operation.controller.abort(error)
              })
            },
            output: async (text, stream) => {
              await this.log(operation, `${stream === 'stderr' ? '[stderr] ' : ''}${text}`)
              readiness = (readiness + text).slice(-8192)
              if (!operation.ready && hasMinecraftReadiness(action, readiness)) {
                operation.ready = true
                await this.update(operation, {
                  phase: 'ready',
                  message: '世界就绪；玩法未验证。',
                  evidence: {
                    ...operation.snapshot.evidence,
                    gameplay: 'unverified',
                    worldReadyAt: new Date().toISOString(),
                  },
                })
              } else if (operation.snapshot.phase === 'starting')
                await this.update(operation, { phase: 'running', message: '等待游戏就绪日志' })
            },
          })
          delete operation.pid
          await this.update(operation, {
            phase: result.exitCode === 0 ? 'exited' : 'failed',
            exitCode: result.exitCode,
            message: `游戏已退出（${String(result.exitCode)}）；玩法未验证。`,
            evidence: {
              ...operation.snapshot.evidence,
              gameplay: 'unverified',
              exitReason: result.exitCode === 0 ? 'process-exit' : 'process-failure',
            },
          })
          return
        }
      }
    }
    await this.update(operation, { phase: 'exited', exitCode: 0, message: '构建通过。' })
  }
}
