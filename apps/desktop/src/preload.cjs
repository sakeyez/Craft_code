// CommonJS is required for Electron's sandboxed preload execution path.
const { contextBridge, ipcRenderer } = require('electron')

const DESKTOP_MENU_ACTIONS = new Set([
  'project:new', 'project:export-jar', 'project:settings',
  'editor:find-current', 'editor:find-project',
  'git:status', 'git:diff', 'git:log', 'git:branch', 'git:commit', 'git:push', 'git:pull',
  'help:docs', 'help:sponsor',
])

function isDesktopMenuAction(value) {
  return typeof value === 'string' && DESKTOP_MENU_ACTIONS.has(value)
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
  openMenu(menu, anchor) {
    return ipcRenderer.invoke('desktop:open-menu', { menu, anchor })
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
})
