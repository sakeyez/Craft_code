import type { MenuItemConstructorOptions } from 'electron'

export const DESKTOP_MENU_ACTIONS = [
  'project:new', 'project:export-jar', 'project:toggle-game', 'project:settings',
  'editor:find-current', 'editor:find-project',
  'git:status', 'git:diff', 'git:log', 'git:branch', 'git:commit', 'git:push', 'git:pull',
  'help:docs', 'help:sponsor',
] as const

export type DesktopMenuAction = typeof DESKTOP_MENU_ACTIONS[number]

export const DESKTOP_MENU_IDS = ['project', 'editor', 'git', 'help'] as const
export type DesktopMenuId = typeof DESKTOP_MENU_IDS[number]

export const DESKTOP_MENU_ITEM_IDS: Readonly<Record<DesktopMenuId, string>> = Object.freeze({
  project: 'desktop-menu-project',
  editor: 'desktop-menu-editor',
  git: 'desktop-menu-git',
  help: 'desktop-menu-help',
})

export const DESKTOP_GAME_MENU_ITEM_ID = 'desktop-menu-project-game'

export interface DesktopMenuOpenRequest {
  menu: DesktopMenuId
  anchor: { x: number; y: number }
  cwd?: string
}

export function isDesktopMenuAction(value: unknown): value is DesktopMenuAction {
  return typeof value === 'string' && (DESKTOP_MENU_ACTIONS as readonly string[]).includes(value)
}

export function isDesktopMenuId(value: unknown): value is DesktopMenuId {
  return typeof value === 'string' && (DESKTOP_MENU_IDS as readonly string[]).includes(value)
}

/** Validate a renderer popup request against the current content bounds. */
export function parseDesktopMenuOpenRequest(
  value: unknown,
  bounds: { width: number; height: number },
): DesktopMenuOpenRequest | undefined {
  if (value === null || typeof value !== 'object' || !('menu' in value) || !('anchor' in value)
    || !isDesktopMenuId(value.menu) || value.anchor === null || typeof value.anchor !== 'object'
    || !('x' in value.anchor) || !('y' in value.anchor)) return undefined
  const { x, y } = value.anchor
  if (typeof x !== 'number' || typeof y !== 'number'
    || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)
    || x < 0 || y < 0 || x > bounds.width || y > bounds.height) return undefined
  const cwd = 'cwd' in value ? value.cwd : undefined
  if (cwd !== undefined && typeof cwd !== 'string') return undefined
  return { menu: value.menu, anchor: { x, y }, ...(cwd === undefined ? {} : { cwd }) }
}

export type DesktopGameMenuState = 'unavailable' | 'idle' | 'starting' | 'running' | 'stopping'

/** Derive the native menu label and availability from the current project's game process. */
export function desktopGameMenuPresentation(state: DesktopGameMenuState): { label: string; enabled: boolean } {
  switch (state) {
    case 'unavailable': return { label: '启动游戏', enabled: false }
    case 'idle': return { label: '启动游戏', enabled: true }
    case 'starting': return { label: '正在启动…', enabled: false }
    case 'running': return { label: '停止游戏', enabled: true }
    case 'stopping': return { label: '正在停止…', enabled: false }
  }
}

/** Apply both sender identity and payload validation at the IPC boundary. */
export function trustedDesktopMenuOpenRequest(
  sender: unknown,
  expectedSender: unknown,
  value: unknown,
  bounds: { width: number; height: number },
): DesktopMenuOpenRequest | undefined {
  return sender === expectedSender ? parseDesktopMenuOpenRequest(value, bounds) : undefined
}

export const HELP_URLS = Object.freeze({
  docs: 'https://example.com/craftcode/docs',
  sponsor: 'https://example.com/craftcode/sponsor',
})

export function desktopMenuTemplate(
  send: (action: DesktopMenuAction) => void,
  openExternal: (url: string) => void,
): MenuItemConstructorOptions[] {
  const sendItem = (label: string, action: DesktopMenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator === undefined ? {} : { accelerator }),
    click: () => { send(action) },
  })
  return [
    {
      id: DESKTOP_MENU_ITEM_IDS.project,
      label: '项目',
      submenu: [
        sendItem('新建', 'project:new', 'Ctrl+N'),
        sendItem('导出 JAR', 'project:export-jar'),
        { id: DESKTOP_GAME_MENU_ITEM_ID, ...sendItem('启动游戏', 'project:toggle-game') },
        { type: 'separator' },
        sendItem('项目设置', 'project:settings'),
      ],
    },
    {
      id: DESKTOP_MENU_ITEM_IDS.editor,
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销', accelerator: 'Ctrl+Z' },
        { role: 'redo', label: '重做', accelerator: 'Ctrl+Y' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { type: 'separator' },
        sendItem('查找当前对话', 'editor:find-current', 'Ctrl+F'),
        sendItem('查找项目对话', 'editor:find-project', 'Ctrl+Shift+F'),
      ],
    },
    {
      id: DESKTOP_MENU_ITEM_IDS.git,
      label: 'Git',
      submenu: [
        sendItem('状态', 'git:status'),
        sendItem('差异', 'git:diff'),
        sendItem('日志', 'git:log'),
        sendItem('分支管理', 'git:branch'),
        { type: 'separator' },
        sendItem('Commit', 'git:commit'),
        sendItem('Push', 'git:push'),
        sendItem('Pull', 'git:pull'),
      ],
    },
    {
      id: DESKTOP_MENU_ITEM_IDS.help,
      label: '帮助',
      submenu: [
        { label: '文档', click: () => { openExternal(HELP_URLS.docs) } },
        { label: '赞助作者', click: () => { openExternal(HELP_URLS.sponsor) } },
      ],
    },
  ]
}
