import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { MinecraftRuns } from '../src/runtime.ts'
import type { ProcessOptions, ProcessRunner } from '../src/process.ts'
import type { ShellExecSpec } from '@deepseek-ai/dsh-shell'

vi.mock('../src/environment.ts', () => ({
  findJava: async () => ({ major: 21, executable: 'java', managed: false, available: true }),
  ensureJava: async () => ({ major: 21, executable: 'java', managed: false, available: true }),
  javaEnv: () => ({}),
  requiredJava: () => 21,
  probe: async (_ctx: unknown, executable: string, major: number) => ({ major, executable, managed: false, available: true }),
}))
let root: string
let ctx: Context
let runs: MinecraftRuns
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craftcode-lifecycle-'))
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  runs = new MinecraftRuns(ctx)
  await mkdir(join(root, 'src/main/resources'), { recursive: true })
  await mkdir(join(root, 'gradle/wrapper'), { recursive: true })
  await writeFile(
    join(root, 'build.gradle'),
    'plugins { id "fabric-loom" version "1.7.4" }\ndependencies { minecraft "com.mojang:minecraft:1.21.1" }\n',
  )
  await writeFile(
    join(root, 'src/main/resources/fabric.mod.json'),
    '{"schemaVersion":1,"id":"example","version":"1.0.0","depends":{"minecraft":"1.21.1"}}',
  )
  await writeFile(
    join(root, 'gradle/wrapper/gradle-wrapper.properties'),
    'distributionUrl=https://services.gradle.org/distributions/gradle-8.8-bin.zip',
  )
  await writeFile(join(root, 'gradlew'), '')
  await writeFile(join(root, 'gradlew.bat'), '')
})
afterEach(async () => {
  await runs.dispose()
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

it('prepares without launching, rejects duplicate starts and drains output on cancellation', async () => {
  const commands: string[][] = []
  const runner: ProcessRunner = async (options) => {
    commands.push(options.argv)
    if (options.argv.includes('tasks'))
      return { exitCode: 0, text: 'runClient - client\nrunServer - server\n', truncated: false }
    await options.output?.('准备中文输出\n', 'stdout')
    await new Promise<void>((resolve) => {
      options.signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    await options.output?.('取消前最后一行\n', 'stdout')
    options.signal.throwIfAborted()
    return { exitCode: 0, text: '', truncated: false }
  }
  const operation = await runs.start(root, 'prepare', runner)
  await expect(runs.start(root, 'client', runner)).rejects.toThrow('已有运行任务')
  await expect.poll(() => commands.length).toBe(2)
  await runs.stop(root, operation.id)
  expect((await runs.history(root))[0]?.phase).toBe('cancelled')
  expect((await runs.logs(root, operation.id, 0)).text).toContain('取消前最后一行')
  expect(commands.flat()).not.toContain('runClient')
  expect(commands.flat()).not.toContain('classes')
  expect(commands[1]).toContain('--init-script')
  expect(commands.every(command => !command.includes('--no-daemon'))).toBe(true)
})

it('runs only the runtime task and preserves its compilation failure', async () => {
  const commands: string[][] = []
  const runner: ProcessRunner = async (options: ProcessOptions) => {
    commands.push(options.argv)
    if (options.argv.includes('tasks')) return { exitCode: 0, text: 'runClient - client\n', truncated: false }
    await options.output?.('ERROR compile failed\n', 'stderr')
    return { exitCode: 1, text: 'ERROR compile failed', truncated: false }
  }
  const operation = await runs.start(root, 'client', runner)
  await expect.poll(async () => (await runs.history(root))[0]?.phase).toBe('failed')
  expect(commands.flat()).toContain('runClient')
  expect(commands.flat()).not.toContain('build')
  expect(commands.flat()).not.toContain('test')
  expect((await runs.logs(root, operation.id, 0)).text).toContain('ERROR compile failed')
})

it('keeps model probes inside the mounted shell and retains sandbox denial output', async () => {
  const commands: ShellExecSpec[] = []
  ctx.provide('shell', {
    resolve: request => ({
      ...request,
      workdir: root,
      stdoutMaxBytes: 1024,
      timeoutMs: 1000,
      sandboxPolicy: undefined,
    }),
    start: (spec) => {
      commands.push(spec)
      let read = false
      return {
        status: 'completed',
        exitCode: 1,
        signal: null,
        done: Promise.resolve(),
        sandbox: { mode: 'read-only', denied: true },
        readOutput: () => {
          const delta = read ? '' : '拒绝执行 Gradle\n'
          read = true
          return { delta, lossy: false }
        },
        kill: () => false,
      }
    },
  } as Context['shell'])
  const result = await runs.check(root, 'client', new AbortController().signal)
  expect(result.failedStep).toBe('startup')
  expect(commands).toHaveLength(1)
  expect(commands[0]?.command).toContain(process.platform === 'win32' ? "& '.\\gradlew.bat'" : "'./gradlew'")
  const run = (await runs.history(root))[0]!
  expect(run.phase).toBe('failed')
  expect((await runs.logs(root, run.id, 0)).text).toContain('shell 沙箱拒绝运行')
  expect(result.steps[0]?.stdout.spillPath).toContain('output.log')
})

it.each(['fabric', 'neoforge'] as const)(
  'launches %s without additional gates and drains output before stopping',
  async (loader) => {
    if (loader === 'neoforge') {
      await unlink(join(root, 'src/main/resources/fabric.mod.json'))
      await mkdir(join(root, 'src/main/resources/META-INF'))
      await writeFile(
        join(root, 'build.gradle'),
        'plugins { id "net.neoforged.gradle.userdev" version "7.0.145" }\ndependencies { implementation "net.neoforged:neoforge:21.1.1" }\n',
      )
      await writeFile(join(root, 'gradle.properties'), 'minecraft_version=1.21.1\n')
      await writeFile(
        join(root, 'src/main/resources/META-INF/neoforge.mods.toml'),
        'modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="example"\nversion="1.0.0"\n',
      )
    }
    const commands: string[][] = []
    const runner: ProcessRunner = async (options) => {
      commands.push(options.argv)
      if (options.argv.includes('tasks')) return { exitCode: 0, text: 'runServer - server\n', truncated: false }
      if (options.argv.some(arg => arg.startsWith('craftcodeInspect'))) {
        const script = options.argv.find(arg => arg.endsWith('/inspect.gradle'))!
        await writeFile(
          join(root, dirname(script), 'build-facts.json'),
          JSON.stringify({ artifacts: [], modules: [], classpath: [] }),
        )
      }
      if (!options.argv.includes('runServer')) return { exitCode: 0, text: 'BUILD SUCCESSFUL', truncated: false }
      await options.output?.(
        '[Server thread/INFO] [minecraft/DedicatedServer]: Done (2.5s)! For help, type "help"\n',
        'stdout',
      )
      await new Promise<void>((resolve) => {
        options.signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      await options.output?.('保存世界完成\n', 'stdout')
      options.signal.throwIfAborted()
      return { exitCode: 0, text: '', truncated: false }
    }
    const operation = await runs.start(root, 'server', runner)
    await expect.poll(async () => (await runs.history(root))[0]?.phase).toBe('ready')
    expect(commands.flat()).not.toContain('build')
    expect(commands.flat()).not.toContain('test')
    expect(commands.flat()).not.toContain('datagen')
    expect(commands.flat()).toContain('runServer')
    await runs.stop(root, operation.id)
    expect((await runs.history(root))[0]?.phase).toBe('cancelled')
    expect((await runs.logs(root, operation.id, 0)).text).toContain('保存世界完成')
  },
)

it('reuses discovered runtime tasks and passes offline mode without adding checks', async () => {
  const commands: string[][] = []
  const runner: ProcessRunner = async (options) => {
    commands.push(options.argv)
    return { exitCode: 0, text: options.argv.includes('tasks') ? 'runClient - client\n' : '', truncated: false }
  }
  await runs.start(root, 'client', runner)
  await expect.poll(async () => (await runs.history(root))[0]?.phase).toBe('exited')
  const offline = await runs.start(root, 'client', runner, { offline: true })
  await expect.poll(async () => (await runs.history(root)).find(run => run.id === offline.id)?.phase).toBe('exited')
  expect(commands.filter(args => args.includes('tasks'))).toHaveLength(1)
  expect(commands.at(-1)).toContain('--offline')
  expect(commands.at(-1)).toContain('runClient')
  expect(commands.flat()).not.toContain('build')
  expect(commands.flat()).not.toContain('test')
})

it('keeps world readiness unknown when an initialized client reaches the probe deadline', async () => {
  ctx.provide('shell', {
    resolve: request => ({ ...request, workdir: root, stdoutMaxBytes: 1024, timeoutMs: 20 }),
    start: (spec) => {
      const discovery = spec.command.includes("'tasks'")
      let consumed = false
      return {
        status: 'completed', exitCode: discovery ? 0 : null, signal: null,
        done: discovery ? Promise.resolve() : new Promise<void>((resolve) => {
          spec.signal?.addEventListener('abort', () => { resolve() }, { once: true })
        }),
        readOutput: () => {
          const delta = consumed ? '' : discovery ? 'runClient - client\n' : '[Render thread/INFO] Setting user: Dev\n'
          consumed = true
          return { delta, lossy: false }
        },
        kill: () => false,
      }
    },
  } as Context['shell'])
  const result = await runs.check(root, 'client', new AbortController().signal, 20)
  expect(result.steps[0]?.status).toBe('skipped')
  expect(result.steps[0]?.timedOut).toBe(true)
  expect(result.failedStep).toBeNull()
  const record = (await runs.history(root))[0]
  expect(record?.evidence?.processStartedAt).toBeDefined()
  expect(record?.evidence?.worldReadyAt).toBeUndefined()
  expect(record?.evidence?.gameplay).toBe('unverified')
})
