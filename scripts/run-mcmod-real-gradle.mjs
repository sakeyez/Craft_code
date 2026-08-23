import { spawnSync } from 'node:child_process'

const commandArgs = [
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.e2e.config.ts',
  'examples/headless-agent/tests/mcmod-real-gradle.e2e.ts',
]
const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', ['pnpm', ...commandArgs].join(' ')]
  : commandArgs
const result = spawnSync(executable, args, {
  env: { ...process.env, DSH_MCMOD_REAL_GRADLE: '1' },
  stdio: 'inherit',
})

if (result.error !== undefined) {
  console.error(result.error)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
