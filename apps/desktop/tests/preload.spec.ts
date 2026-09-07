import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  isDesktopGameEvent, isGameCaptureEvent, isGameCaptureSnapshot, isGameCaptureState,
} from '../src/preload-validation.ts'

describe('desktop preload boundary', () => {
  it('accepts only structurally valid game process events', () => {
    expect(isDesktopGameEvent({
      cwd: 'C:\\fixture',
      result: { ok: false, title: '游戏运行失败', message: '退出码 7', stderr: 'failure' },
    })).toBe(true)
    expect(isDesktopGameEvent({
      cwd: 'C:\\fixture',
      result: { ok: false, title: '游戏运行失败', message: '退出码 7', stderr: 7 },
    })).toBe(false)
    expect(isDesktopGameEvent({ cwd: 'C:\\fixture', result: { ok: true, title: '游戏已关闭' } })).toBe(false)
  })

  it('exposes only the fixed bridge methods and channels', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/preload.ts', import.meta.url)), 'utf8')
    expect(source).toContain('contextBridge.exposeInMainWorld')
    expect(source).toContain('onMenuAction')
    expect(source).toContain('menuPresentation')
    expect(source).toContain('openMenu')
    expect(source).toContain('desktop:open-menu')
    expect(source).toContain('setActiveProject')
    expect(source).toContain('desktop:set-active-project')
    expect(source).toContain('onGameEvent')
    expect(source).toContain('desktop:game-event')
    expect(source).toContain('minimizeWindow')
    expect(source).toContain('toggleMaximizeWindow')
    expect(source).toContain('closeWindow')
    expect(source).toContain('isMaximized')
    expect(source).toContain('onMaximizedChange')
    expect(source).toContain('desktop:window-maximized')
    expect(source).toContain('invokeProjectCommand')
    expect(source).not.toContain('onCommandResult')
    expect(source).not.toContain('desktop:command-result')
    expect(source).not.toContain('require(')
    expect(source).not.toContain('desktop:exec')
    expect(source).not.toContain('project:save')
    expect(source).not.toContain('project-save')
  })

  it('accepts only strict project-scoped game states and bounded JPEG snapshots', () => {
    expect(isGameCaptureState({ status: 'connected', surfaceKind: 'external-window', gameName: 'Minecraft' })).toBe(true)
    expect(isGameCaptureState({ status: 'connected' })).toBe(false)
    expect(isGameCaptureState({ status: 'anything' })).toBe(false)
    expect(isGameCaptureState({ status: 'idle', error: 'extra' })).toBe(false)
    expect(isGameCaptureEvent({ cwd: 'C:\\project', state: { status: 'starting' } })).toBe(true)
    expect(isGameCaptureEvent({ cwd: 'relative', state: { status: 'starting' } })).toBe(false)
    expect(isGameCaptureSnapshot({ dataUrl: 'data:image/jpeg;base64,AA==', width: 1920, height: 1080 })).toBe(true)
    expect(isGameCaptureSnapshot({ dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1 })).toBe(false)
    expect(isGameCaptureSnapshot({ dataUrl: 'data:image/jpeg;base64,AA==', width: 1921, height: 1 })).toBe(false)
  })

  it('keeps the sandbox runtime preload limited to Electron primitives', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/preload.cjs', import.meta.url)), 'utf8')
    expect(source).toContain("require('electron')")
    expect(source).toContain('menuPresentation')
    expect(source).toContain('openMenu')
    expect(source).toContain('desktop:open-menu')
    expect(source).toContain('setActiveProject')
    expect(source).toContain('desktop:set-active-project')
    expect(source).toContain('onGameEvent')
    expect(source).toContain('desktop:game-event')
    expect(source).toContain('minimizeWindow')
    expect(source).toContain('toggleMaximizeWindow')
    expect(source).toContain('closeWindow')
    expect(source).toContain('isMaximized')
    expect(source).toContain('onMaximizedChange')
    expect(source).toContain('desktop:window-maximized')
    expect(source).not.toContain('onCommandResult')
    expect(source).not.toContain('desktop:command-result')
    expect(source).not.toContain("require('node:")
    expect(source).not.toContain('desktop:exec')
    expect(source).not.toContain('project:save')
  })
})
