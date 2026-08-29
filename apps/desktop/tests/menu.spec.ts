import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_MENU_ACTIONS,
  DESKTOP_MENU_ITEM_IDS,
  desktopMenuTemplate,
  HELP_URLS,
  isDesktopMenuAction,
  parseDesktopMenuOpenRequest,
  trustedDesktopMenuOpenRequest,
} from '../src/menu.ts'
import type { DesktopMenuAction } from '../src/menu.ts'

describe('desktop application menu', () => {
  it('has exactly the four product menus and fixed actions', () => {
    const send = vi.fn<(action: DesktopMenuAction) => void>()
    const external = vi.fn()
    const template = desktopMenuTemplate(send, external)
    expect(template.map(item => item.label)).toEqual(['项目', '编辑', 'Git', '帮助'])
    expect(template.map(item => item.id)).toEqual([
      DESKTOP_MENU_ITEM_IDS.project,
      DESKTOP_MENU_ITEM_IDS.editor,
      DESKTOP_MENU_ITEM_IDS.git,
      DESKTOP_MENU_ITEM_IDS.help,
    ])
    expect(DESKTOP_MENU_ACTIONS).toHaveLength(14)
    const help = template[3]?.submenu as Array<{ click?: () => void }> | undefined
    help?.[0]?.click?.()
    expect(external).toHaveBeenCalledWith(HELP_URLS.docs)
  })

  it('maps product items to the action allowlist and accelerators', () => {
    const send = vi.fn<(action: DesktopMenuAction) => void>()
    const template = desktopMenuTemplate(send, vi.fn())
    const project = template[0]?.submenu as Array<{ label?: string; type?: string; accelerator?: string; click?: () => void }>
    expect(project.map(item => item.label ?? item.type)).toEqual(['新建', '导出 JAR', 'separator', '项目设置'])
    project[0]?.click?.()
    project[1]?.click?.()
    expect(send.mock.calls.map(([action]) => action)).toEqual(['project:new', 'project:export-jar'])
    expect(project[0]?.accelerator).toBe('Ctrl+N')
    expect(project[1]?.accelerator).toBeUndefined()
  })

  it('rejects menu actions outside the runtime allowlist', () => {
    expect(isDesktopMenuAction('project:save')).toBe(false)
    expect(isDesktopMenuAction('project:save-as')).toBe(false)
    expect(isDesktopMenuAction('desktop:exec')).toBe(false)
    expect(isDesktopMenuAction(null)).toBe(false)
  })

  it('accepts only trusted menu popup requests inside the content bounds', () => {
    const sender = {}
    const request = { menu: 'git', anchor: { x: 96, y: 40 } }
    expect(trustedDesktopMenuOpenRequest(sender, sender, request, { width: 900, height: 640 })).toEqual(request)
    expect(trustedDesktopMenuOpenRequest({}, sender, request, { width: 900, height: 640 })).toBeUndefined()
    expect(parseDesktopMenuOpenRequest({ ...request, menu: 'tools' }, { width: 900, height: 640 })).toBeUndefined()
    expect(parseDesktopMenuOpenRequest({ menu: 'git', anchor: { x: Number.NaN, y: 40 } }, { width: 900, height: 640 })).toBeUndefined()
    expect(parseDesktopMenuOpenRequest({ menu: 'git', anchor: { x: 901, y: 40 } }, { width: 900, height: 640 })).toBeUndefined()
    expect(parseDesktopMenuOpenRequest({ menu: 'git', anchor: { x: 96.5, y: 40 } }, { width: 900, height: 640 })).toBeUndefined()
  })
})
