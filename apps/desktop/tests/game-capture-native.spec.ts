import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const run = process.platform === 'win32' ? it : it.skip
const electron = createRequire(import.meta.url)('electron') as string

describe('Windows external game window fixture', () => {
  run('tracks a top-level HWND without changing native state', () => {
    const fixture = fileURLToPath(new URL('./fixtures/game-capture-native.mjs', import.meta.url))
    const log = join(tmpdir(), `craftcode-native-${String(process.pid)}.log`)
    rmSync(log, { force: true })
    const result = spawnSync(electron, [fixture], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', CRAFTCODE_NATIVE_LOG: log },
    })
    const diagnostics = existsSync(log) ? readFileSync(log, 'utf8') : result.stderr
    rmSync(log, { force: true })
    expect(result.status, `${diagnostics}\n${result.error?.message ?? ''}`).toBe(0)
  }, 25_000)
})
