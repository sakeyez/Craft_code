import { describe, expect, it } from 'vitest'
import {
  DESKTOP_APP_USER_MODEL_ID, DESKTOP_WEB_PREFERENCES, desktopAppUserModelId,
  desktopWindowOptions, navigationDisposition,
} from '../src/window.ts'

describe('desktop window policy', () => {
  it('keeps the renderer isolated from Node.js', () => {
    expect(DESKTOP_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })
    expect(desktopWindowOptions().webPreferences).toEqual(DESKTOP_WEB_PREFERENCES)
    expect(desktopWindowOptions().show).toBe(true)
    expect(desktopWindowOptions(undefined, undefined, false).show).toBe(false)
  })

  it('applies the supplied brand icon to the window', () => {
    const icon = { isEmpty: () => false }
    expect(desktopWindowOptions(icon as never).icon).toBe(icon)
  })

  it('uses a frameless window for Windows/Linux while retaining macOS chrome', () => {
    expect(desktopWindowOptions(undefined, undefined, true, 'win32').frame).toBe(false)
    expect(desktopWindowOptions(undefined, undefined, true, 'linux').frame).toBe(false)
    expect(desktopWindowOptions(undefined, undefined, true, 'darwin').frame).toBe(true)
  })

  it('reserves the stable Windows taskbar identity for packaged builds', () => {
    expect(desktopAppUserModelId(true, 'win32')).toBe(DESKTOP_APP_USER_MODEL_ID)
    expect(desktopAppUserModelId(false, 'win32')).toBeUndefined()
    expect(desktopAppUserModelId(true, 'linux')).toBeUndefined()
  })

  it('allows only the launch origin and hands external HTTP links to the OS', () => {
    const origin = 'http://127.0.0.1:43123'
    expect(navigationDisposition(`${origin}/session/1`, origin)).toBe('allow')
    expect(navigationDisposition('https://example.com/docs', origin)).toBe('external')
    expect(navigationDisposition('http://user:secret@127.0.0.1:43123/session/1', origin)).toBe('deny')
    expect(navigationDisposition('file:///C:/secret.txt', origin)).toBe('deny')
    expect(navigationDisposition('not a url', origin)).toBe('deny')
  })
})
