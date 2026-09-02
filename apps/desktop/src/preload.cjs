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
      if (value !== null && typeof value === 'object' && typeof value.status === 'string') listener(value)
    }
    ipcRenderer.on('desktop:game-surface-state', wrapped)
    return () => { ipcRenderer.removeListener('desktop:game-surface-state', wrapped) }
  },
  reconnectGameSurface(cwd) { return ipcRenderer.invoke('desktop:game-surface-reconnect', cwd) },
  stopGameSurface(cwd) { return ipcRenderer.invoke('desktop:game-surface-stop', cwd) },
  screenshotGameSurface(cwd) { return ipcRenderer.invoke('desktop:game-surface-screenshot', cwd) },
  setGameSurfaceBounds(cwd, bounds) { return ipcRenderer.invoke('desktop:game-surface-bounds', { cwd, bounds }) },
})
