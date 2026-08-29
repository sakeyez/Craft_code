/** Resolve the repository-backed runtime used by the desktop development shell. */
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BackendOptions } from './backend.ts'

/** Inputs Electron owns after application initialization. */
export interface DesktopRuntimeOptions {
  packaged: boolean
  repositoryRoot: string
  nodeExecutable: string | undefined
  environment: NodeJS.ProcessEnv
  log?: (line: string) => void
}

/** Resolve development backend paths without probing PATH or mutating process.env. */
export function resolveDesktopRuntime(options: DesktopRuntimeOptions): BackendOptions {
  if (options.packaged) {
    throw new Error('desktop packaging is not implemented; run the development shell with pnpm desktop:dev')
  }
  if (options.nodeExecutable === undefined || !isAbsolute(options.nodeExecutable)) {
    throw new Error('desktop development requires the Node.js executable inherited from pnpm; run pnpm desktop:dev')
  }
  const cliEntry = join(options.repositoryRoot, 'apps', 'cli', 'src', 'bin.ts')
  if (!existsSync(cliEntry)) throw new Error(`desktop development CLI entry is missing: ${cliEntry}`)
  const env = { ...options.environment }
  env.TSX_TSCONFIG_PATH ??= join(options.repositoryRoot, 'tsconfig.json')
  return {
    nodeExecutable: options.nodeExecutable,
    cliEntry,
    entryMode: 'source',
    cwd: options.repositoryRoot,
    env,
    ...options.log === undefined ? {} : { log: options.log },
  }
}
