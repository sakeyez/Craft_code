/** Native environment-file paths passed by the real credentialed Vitest configurations. */

import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const loadEnvFile = vi.fn<typeof process.loadEnvFile>()
const snapshotPath = '../vitest.snapshot.config.ts'
const configurations = [
  ['e2e', '../vitest.e2e.config.ts'],
  ['desktop-renderer', '../vitest.desktop-renderer.config.ts'],
  ['snapshot record', snapshotPath],
] as const

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DSH_SNAPSHOT', 'record')
  vi.stubEnv('DSH_E2E_MAX_WORKERS', '1')
  vi.stubEnv('DSH_SNAPSHOT_MAX_CONCURRENCY', '1')
  // Importing a real config must never load developer credentials into the test worker.
  loadEnvFile.mockReset()
  vi.spyOn(process, 'loadEnvFile').mockImplementation(loadEnvFile)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Vitest environment-file loading', () => {
  it.each(configurations)('%s passes the native repository path', async (_name, path) => {
    await import(path)
    expect(loadEnvFile).toHaveBeenCalledExactlyOnceWith(resolve(root, '.env'))
  })

  it.each(['replay', 'refresh'])('snapshot %s does not load an environment file', async (mode) => {
    vi.stubEnv('DSH_SNAPSHOT', mode)
    await import(snapshotPath)
    expect(loadEnvFile).not.toHaveBeenCalled()
  })
})
