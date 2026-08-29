// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import type { DesktopAction, DesktopMenuInjected } from '../src/client/contract.ts'

afterEach(() => { delete window.craftCodeDesktop })

describe('ui-desktop-menu plugin', () => {
  it('stays inert without the Electron preload bridge', () => {
    delete window.craftCodeDesktop
    const register = vi.fn()
    apply({ slots: { register } } as never)
    expect(register).not.toHaveBeenCalled()
  })

  it('registers one overlay entry and publishes preload actions through its hook source', async () => {
    let menuListener: ((action: DesktopAction) => void) | undefined
    const invokeProjectCommand = vi.fn(async () => ({ ok: true, title: 'Git', message: 'ok' }))
    window.craftCodeDesktop = {
      menuPresentation: 'web',
      onMenuAction(listener) { menuListener = listener; return () => { menuListener = undefined } },
      openMenu: vi.fn(async () => {}),
      minimizeWindow: vi.fn(async () => {}),
      toggleMaximizeWindow: vi.fn(async () => {}),
      closeWindow: vi.fn(async () => {}),
      isMaximized: vi.fn(async () => false),
      onMaximizedChange: () => () => {},
      invokeProjectCommand,
    }
    const registrations: Array<{ name?: string; inject?: () => DesktopMenuInjected; id?: string; order?: number }> = []
    const effectDisposers: (() => void)[] = []
    const ctx = {
      effect(effect: () => undefined | (() => void)) {
        const dispose = effect()
        if (dispose !== undefined) effectDisposers.push(dispose)
      },
      slots: {
        inject(_name: string, register: () => void) { register() },
        register(value: typeof registrations[number]) { registrations.push(value); return () => {} },
      },
      workspaces: {},
      sessions: {},
    }
    apply(ctx as never)
    expect(registrations.map(value => value.name)).toEqual(['shell.topbar', 'shell.overlay'])
    const options = registrations.find(value => value.name === 'shell.overlay')
    expect(options).toMatchObject({ id: 'desktop-menu', order: 20 })
    const face = options?.inject?.()
    expect(face).toBeDefined()
    const changed = vi.fn()
    face?.hooks.desktopMenu.subscribe(changed)
    menuListener?.('git:status')
    expect(changed).toHaveBeenCalledOnce()
    expect(face?.hooks.desktopMenu.getSnapshot()).toEqual({ sequence: 1, action: 'git:status' })
    await face?.invoke({ kind: 'git-status', cwd: '/project' })
    expect(invokeProjectCommand).toHaveBeenCalledWith({ kind: 'git-status', cwd: '/project' })
    for (const dispose of effectDisposers) dispose()
    expect(menuListener).toBeUndefined()
  })

  it('keeps macOS on the native application menu without a duplicate topbar', () => {
    window.craftCodeDesktop = {
      menuPresentation: 'native',
      onMenuAction: () => () => {},
      openMenu: vi.fn(async () => {}),
      minimizeWindow: vi.fn(async () => {}),
      toggleMaximizeWindow: vi.fn(async () => {}),
      closeWindow: vi.fn(async () => {}),
      isMaximized: vi.fn(async () => false),
      onMaximizedChange: () => () => {},
      invokeProjectCommand: vi.fn(async () => ({ ok: true, title: 'Git', message: 'ok' })),
    }
    const registrations: string[] = []
    apply({
      effect(effect: () => undefined | (() => void)) { effect() },
      slots: {
        inject(_name: string, register: () => void) { register() },
        register(value: { name: string }) { registrations.push(value.name); return () => {} },
      },
      workspaces: {},
      sessions: {},
    } as never)
    expect(registrations).toEqual(['shell.overlay'])
  })
})
