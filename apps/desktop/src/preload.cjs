// CommonJS is required for Electron's sandboxed preload execution path.
const { contextBridge, ipcRenderer } = require('electron')

const DESKTOP_MENU_ACTIONS = new Set([
  'project:new', 'project:export-jar', 'project:toggle-game', 'project:settings',
  'editor:find-current', 'editor:find-project',
  'git:status', 'git:diff', 'git:log', 'git:branch', 'git:commit', 'git:push', 'git:pull',
  'help:docs', 'help:sponsor',
])

function isDesktopMenuAction(value) {
  return typeof value === 'string' && DESKTOP_MENU_ACTIONS.has(value)
}

function isDesktopGameEvent(value) {
  if (value === null || typeof value !== 'object' || typeof value.cwd !== 'string'
    || value.result === null || typeof value.result !== 'object') return false
  return typeof value.result.ok === 'boolean'
    && typeof value.result.title === 'string'
    && typeof value.result.message === 'string'
    && (value.result.stdout === undefined || typeof value.result.stdout === 'string')
    && (value.result.stderr === undefined || typeof value.result.stderr === 'string')
}

function isGameCaptureState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.status !== 'string') return false
  const keys = Object.keys(value)
  const only = allowed => keys.every(key => allowed.includes(key))
  const named = value.gameName === undefined || typeof value.gameName === 'string'
  if (value.status === 'idle') return only(['status'])
  if (value.status === 'starting' || value.status === 'reconnecting') return named && only(['status', 'gameName'])
  if (value.status === 'connected') return named && value.surfaceKind === 'external-window' && only(['status', 'gameName', 'surfaceKind'])
  if (value.status === 'failed' || value.status === 'disconnected' || value.status === 'unsupported') {
    return named && typeof value.error === 'string' && only(['status', 'gameName', 'error'])
  }
  return false
}

function isGameCaptureEvent(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => ['cwd', 'state'].includes(key))
    && typeof value.cwd === 'string' && /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(value.cwd)
    && isGameCaptureState(value.state)
}

function isGameCaptureSnapshot(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => ['dataUrl', 'width', 'height'].includes(key))
    && typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:image/jpeg;base64,') && value.dataUrl.length <= 4000000
    && Number.isInteger(value.width) && value.width > 0 && value.width <= 1920
    && Number.isInteger(value.height) && value.height > 0 && value.height <= 1080
}

contextBridge.exposeInMainWorld('craftCodeDesktop', {
  menuPresentation: process.platform === 'darwin' ? 'native' : 'web',
  onMenuAction(listener) {
    const wrapped = (_event, action) => {
      if (isDesktopMenuAction(action)) listener(action)
    }
    ipcRenderer.on('desktop:menu-action', wrapped)
    return () => { ipcRenderer.removeListener('desktop:menu-action', wrapped) }
  },
  openMenu(menu, anchor, cwd) {
    return ipcRenderer.invoke('desktop:open-menu', { menu, anchor, ...(cwd === undefined ? {} : { cwd }) })
  },
  setActiveProject(cwd) {
    return ipcRenderer.invoke('desktop:set-active-project', cwd)
  },
  onGameEvent(listener) {
    const wrapped = (_event, value) => {
      if (isDesktopGameEvent(value)) listener(value)
    }
    ipcRenderer.on('desktop:game-event', wrapped)
    return () => { ipcRenderer.removeListener('desktop:game-event', wrapped) }
  },
  minimizeWindow() {
    return ipcRenderer.invoke('desktop:window-minimize')
  },
  toggleMaximizeWindow() {
    return ipcRenderer.invoke('desktop:window-toggle-maximize')
  },
  closeWindow() {
    return ipcRenderer.invoke('desktop:window-close')
  },
  isMaximized() {
    return ipcRenderer.invoke('desktop:window-is-maximized')
  },
  onMaximizedChange(listener) {
    const wrapped = (_event, maximized) => {
      if (typeof maximized === 'boolean') listener(maximized)
    }
    ipcRenderer.on('desktop:window-maximized', wrapped)
    return () => { ipcRenderer.removeListener('desktop:window-maximized', wrapped) }
  },
  invokeProjectCommand(request) {
    return ipcRenderer.invoke('desktop:command', request)
  },
  onGameSurfaceState(listener) {
    const wrapped = (_event, value) => {
      if (isGameCaptureEvent(value)) listener(value)
    }
    ipcRenderer.on('desktop:game-surface-state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:game-surface-state', wrapped) }
  },
  async reconnectGameSurface(cwd) {
    const value = await ipcRenderer.invoke('desktop:game-surface-reconnect', cwd)
    if (!isGameCaptureState(value)) throw new Error('主进程返回了无效的游戏状态。')
    return value
  },
  async beginGameAnnotation(cwd) {
    const value = await ipcRenderer.invoke('desktop:game-annotation-begin', cwd)
    if (!isGameCaptureSnapshot(value)) throw new Error('主进程返回了无效的游戏截图。')
    return value
  },
  endGameAnnotation(cwd) { return ipcRenderer.invoke('desktop:game-annotation-end', cwd) },
  repositionGameCompanion(cwd) { return ipcRenderer.invoke('desktop:game-companion-reposition', cwd) },
})
