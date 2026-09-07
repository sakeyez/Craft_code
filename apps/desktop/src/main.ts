/** Electron development shell over the existing loopback `dsh web` runtime. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type NativeImage, type WebContents } from 'electron'
import { startBackend, type BackendHandle } from './backend.ts'
import {
  desktopGameMenuState, executeDesktopCommand, onDesktopGameEvent, onDesktopGameLifecycle, stopActiveCommands,
} from './commands.ts'
import { decodeEmbeddedPng } from './icon.ts'
import {
  DESKTOP_GAME_MENU_ITEM_ID, DESKTOP_MENU_ITEM_IDS, desktopGameMenuPresentation,
  desktopMenuTemplate, trustedDesktopMenuOpenRequest,
  type DesktopMenuAction,
} from './menu.ts'
import type { DesktopCommandRequest, DesktopCommandResult } from './preload.ts'
import { resolveDesktopRuntime } from './runtime.ts'
import { desktopAppUserModelId, desktopWindowOptions, navigationDisposition } from './window.ts'
import {
  createGameCaptureProvider, type GameCaptureProvider, type GameCaptureSnapshot, type GameCaptureState,
} from './game-capture.ts'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DESKTOP_ICON_PATH = fileURLToPath(new URL('./CraftCode.ico', import.meta.url))
// Sandboxed Electron preloads are loaded as CommonJS scripts. The build copies
// the dedicated CJS bridge next to the compiled main process.
const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))

let backend: BackendHandle | undefined
let mainWindow: BrowserWindow | undefined
let shutdown: Promise<void> | undefined
let gameCapture: GameCaptureProvider | undefined

app.setName('CraftCode')
const appUserModelId = desktopAppUserModelId(app.isPackaged)
if (appUserModelId !== undefined) app.setAppUserModelId(appUserModelId)

const DESKTOP_COMMAND_KINDS: ReadonlySet<string> = new Set([
  'project-settings-read', 'project-settings-write', 'export-jar', 'game-toggle',
  'git-status', 'git-diff', 'git-log', 'git-branch', 'git-commit', 'git-push', 'git-pull',
])

function canonicalProjectCwd(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/u.test(value)) return undefined
  return resolve(value)
}

/** Append one credential-free lifecycle line to Electron's writable log directory. */
function desktopLog(line: string): void {
  const logs = app.getPath('logs')
  mkdirSync(logs, { recursive: true })
  appendFileSync(join(logs, 'desktop.log'), `${new Date().toISOString()} ${line}\n`)
}

function openExternal(target: string): void {
  try {
    const url = new URL(target)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return
    void shell.openExternal(url.href)
  } catch { /* malformed external navigation is denied */ }
}

/** Load the desktop title-bar icon from the Web application's canonical brand asset. */
function loadDesktopIcon(): NativeImage {
  if (existsSync(DESKTOP_ICON_PATH)) {
    const packagedIcon = nativeImage.createFromPath(DESKTOP_ICON_PATH)
    if (!packagedIcon.isEmpty()) return packagedIcon
  }
  const favicon = readFileSync(join(REPOSITORY_ROOT, 'apps', 'web', 'public', 'favicon.svg'), 'utf8')
  const icon = nativeImage.createFromBuffer(decodeEmbeddedPng(favicon))
  if (icon.isEmpty()) throw new Error('Web favicon could not be decoded as a desktop icon')
  return icon
}

/** Apply the origin boundary to one window and every child it creates. */
function installNavigationPolicy(contents: WebContents, allowedOrigin: string, icon: NativeImage): void {
  contents.setWindowOpenHandler(({ url: target }) => {
    const disposition = navigationDisposition(target, allowedOrigin)
    if (disposition === 'allow') {
      return { action: 'allow', overrideBrowserWindowOptions: desktopWindowOptions(icon, PRELOAD_PATH) }
    }
    if (disposition === 'external') openExternal(target)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, target) => {
    const disposition = navigationDisposition(target, allowedOrigin)
    if (disposition === 'allow') return
    event.preventDefault()
    if (disposition === 'external') openExternal(target)
  })
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
  contents.on('did-create-window', (child) => {
    if (process.platform !== 'darwin') child.setMenuBarVisibility(false)
    installNavigationPolicy(child.webContents, allowedOrigin, icon)
  })
}

/** Build a Node-free renderer window after the complete Web tree is ready. */
async function createWindow(url: string): Promise<BrowserWindow> {
  const allowedOrigin = new URL(url).origin
  const icon = loadDesktopIcon()
  const window = new BrowserWindow(desktopWindowOptions(icon, PRELOAD_PATH, false))
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false)
  const publishMaximized = (): void => {
    if (!window.isDestroyed()) window.webContents.send('desktop:window-maximized', window.isMaximized())
  }
  window.on('maximize', publishMaximized)
  window.on('unmaximize', publishMaximized)
  installNavigationPolicy(window.webContents, allowedOrigin, icon)
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
  try {
    await window.loadURL(url)
    window.show()
  } catch (error) {
    window.destroy()
    throw error
  }
  return window
}

/** Stop the backend exactly once before allowing Electron to exit. */
function shutdownAndQuit(): Promise<void> {
  shutdown ??= (async () => {
    const active = backend
    backend = undefined
    try {
      await gameCapture?.dispose()
      gameCapture = undefined
      await stopActiveCommands()
      await active?.stop()
    } catch (error) {
      desktopLog(`backend shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      app.quit()
    }
  })()
  return shutdown
}

app.on('before-quit', (event) => {
  if (shutdown !== undefined || backend === undefined) return
  event.preventDefault()
  void shutdownAndQuit()
})

app.on('window-all-closed', () => { void shutdownAndQuit() })

/** Start the supervised Web profile after Electron finishes initialization. */
async function startDesktop(): Promise<void> {
  let activeProjectCwd: string | undefined
  const knownProjects = new Set<string>()
  const applicationMenu = Menu.buildFromTemplate(desktopMenuTemplate(
    (action: DesktopMenuAction) => {
      desktopLog(`menu action=${action}`)
      if (mainWindow === undefined) {
        desktopLog(`menu action dropped before window ready action=${action}`)
        return
      }
      mainWindow.webContents.send('desktop:menu-action', action)
    },
    openExternal,
  ))
  Menu.setApplicationMenu(applicationMenu)
  const refreshGameMenu = (cwd: string | undefined): void => {
    const gameItem = applicationMenu.getMenuItemById(DESKTOP_GAME_MENU_ITEM_ID)
    if (gameItem === null) return
    const presentation = desktopGameMenuPresentation(desktopGameMenuState(cwd))
    gameItem.label = presentation.label
    gameItem.enabled = presentation.enabled
  }
  onDesktopGameEvent((event) => {
    refreshGameMenu(activeProjectCwd)
    const window = mainWindow
    if (window !== undefined && !window.isDestroyed()) window.webContents.send('desktop:game-event', event)
  })
  onDesktopGameLifecycle((event) => {
    const capture = gameCapture
    if (capture === undefined) return
    if (event.type === 'spawned') {
      knownProjects.add(event.cwd)
      void capture.start(event.cwd, event.rootPid).catch((error: unknown) => {
        desktopLog(`game capture start failed cwd=${event.cwd} error=${error instanceof Error ? error.message : String(error)}`)
      })
      return
    }
    void capture.stop(event.cwd).catch((error: unknown) => {
      desktopLog(`game capture stop failed cwd=${event.cwd} error=${error instanceof Error ? error.message : String(error)}`)
    })
  })
  ipcMain.removeHandler('desktop:open-menu')
  ipcMain.handle('desktop:open-menu', async (event, rawRequest: unknown): Promise<void> => {
    const window = mainWindow
    if (window === undefined) throw new Error('Invalid desktop menu request')
    const request = trustedDesktopMenuOpenRequest(
      event.sender,
      window.webContents,
      rawRequest,
      window.getContentBounds(),
    )
    if (request === undefined) throw new Error('Invalid desktop menu request')
    if (request.menu === 'project') {
      activeProjectCwd = canonicalProjectCwd(request.cwd)
      if (activeProjectCwd !== undefined) knownProjects.add(activeProjectCwd)
      refreshGameMenu(activeProjectCwd)
      await gameCapture?.select(activeProjectCwd)
    }
    const submenu = applicationMenu.getMenuItemById(DESKTOP_MENU_ITEM_IDS[request.menu])?.submenu
    if (submenu === undefined) throw new Error('Desktop menu is unavailable')
    await new Promise<void>((resolve) => {
      submenu.popup({
        window,
        x: request.anchor.x,
        y: request.anchor.y,
        callback: resolve,
      })
    })
  })
  ipcMain.removeHandler('desktop:set-active-project')
  ipcMain.handle('desktop:set-active-project', async (event, cwd: unknown): Promise<void> => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) throw new Error('Invalid desktop project request')
    if (cwd !== undefined && canonicalProjectCwd(cwd) === undefined) throw new Error('Invalid desktop project request')
    activeProjectCwd = canonicalProjectCwd(cwd)
    if (activeProjectCwd !== undefined) knownProjects.add(activeProjectCwd)
    refreshGameMenu(activeProjectCwd)
    await gameCapture?.select(activeProjectCwd)
  })
  ipcMain.removeHandler('desktop:window-minimize')
  ipcMain.handle('desktop:window-minimize', (event): void => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) throw new Error('Invalid desktop window request')
    mainWindow.minimize()
  })
  ipcMain.removeHandler('desktop:window-toggle-maximize')
  ipcMain.handle('desktop:window-toggle-maximize', (event): void => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) throw new Error('Invalid desktop window request')
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.removeHandler('desktop:window-close')
  ipcMain.handle('desktop:window-close', (event): void => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) throw new Error('Invalid desktop window request')
    mainWindow.close()
  })
  ipcMain.removeHandler('desktop:window-is-maximized')
  ipcMain.handle('desktop:window-is-maximized', (event): boolean => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) throw new Error('Invalid desktop window request')
    return mainWindow.isMaximized()
  })
  ipcMain.removeHandler('desktop:game-surface-reconnect')
  ipcMain.handle('desktop:game-surface-reconnect', async (event, cwd: unknown): Promise<GameCaptureState> => {
    const canonical = canonicalProjectCwd(cwd)
    if (mainWindow === undefined || event.sender !== mainWindow.webContents || canonical === undefined
      || canonical !== activeProjectCwd || !knownProjects.has(canonical) || gameCapture === undefined) {
      return { status: 'failed', error: '请求来源或项目无效。' }
    }
    return gameCapture.reconnect(canonical)
  })
  ipcMain.removeHandler('desktop:game-annotation-begin')
  ipcMain.handle('desktop:game-annotation-begin', async (event, cwd: unknown): Promise<GameCaptureSnapshot> => {
    const canonical = canonicalProjectCwd(cwd)
    if (mainWindow === undefined || event.sender !== mainWindow.webContents || canonical === undefined
      || canonical !== activeProjectCwd || !knownProjects.has(canonical) || gameCapture === undefined) throw new Error('请求来源或项目无效。')
    return gameCapture.beginAnnotation(canonical)
  })
  ipcMain.removeHandler('desktop:game-annotation-end')
  ipcMain.handle('desktop:game-annotation-end', async (event, cwd: unknown): Promise<void> => {
    const canonical = canonicalProjectCwd(cwd)
    if (mainWindow === undefined || event.sender !== mainWindow.webContents || canonical === undefined
      || !knownProjects.has(canonical) || gameCapture === undefined) throw new Error('请求来源或项目无效。')
    await gameCapture.endAnnotation(canonical)
  })
  ipcMain.removeHandler('desktop:game-companion-reposition')
  ipcMain.handle('desktop:game-companion-reposition', async (event, cwd: unknown): Promise<void> => {
    const canonical = canonicalProjectCwd(cwd)
    if (mainWindow === undefined || event.sender !== mainWindow.webContents || canonical === undefined
      || canonical !== activeProjectCwd || !knownProjects.has(canonical) || gameCapture === undefined) throw new Error('请求来源或项目无效。')
    await gameCapture.select(canonical)
  })
  ipcMain.removeHandler('desktop:command')
  ipcMain.handle('desktop:command', async (event, rawRequest: unknown): Promise<DesktopCommandResult> => {
    if (mainWindow === undefined || event.sender !== mainWindow.webContents) {
      return { ok: false, title: '桌面命令', message: '请求来源无效。' }
    }
    if (rawRequest === null || typeof rawRequest !== 'object' || !('kind' in rawRequest)
      || typeof rawRequest.kind !== 'string' || !DESKTOP_COMMAND_KINDS.has(rawRequest.kind)) {
      return { ok: false, title: '桌面命令', message: '不支持的桌面命令。' }
    }
    const request = rawRequest as DesktopCommandRequest
    try {
      const canonical = canonicalProjectCwd(request.cwd)
      if (canonical !== undefined) knownProjects.add(canonical)
      let result = await executeDesktopCommand(request)
      if (request.kind === 'game-toggle') refreshGameMenu(activeProjectCwd)
      if (request.kind === 'export-jar' && result.ok && result.path !== undefined && result.artifacts !== undefined && result.artifacts.length > 0) {
        let selected = result.artifacts[0] ?? 'artifact.jar'
        if (result.artifacts.length > 1) {
          const choice = await dialog.showMessageBox(mainWindow, {
            type: 'question', title: '选择 JAR', message: '请选择要导出的构建产物。', buttons: [...result.artifacts, '取消'], defaultId: 0, cancelId: result.artifacts.length,
          })
          if (choice.response >= result.artifacts.length) return { ok: false, title: '导出 JAR', message: '已取消 JAR 导出。' }
          selected = result.artifacts[choice.response] ?? selected
        }
        const destination = await dialog.showSaveDialog(mainWindow, { defaultPath: selected, filters: [{ name: 'JAR', extensions: ['jar'] }] })
        if (destination.canceled) return { ok: false, title: '导出 JAR', message: '已取消保存位置选择。' }
        copyFileSync(join(result.path, selected), destination.filePath)
        result = { ...result, path: destination.filePath, message: `JAR 已导出到 ${destination.filePath}` }
      }
      return result
    } catch (error) {
      return { ok: false, title: '桌面命令失败', message: error instanceof Error ? error.message : String(error) }
    }
  })
  try {
    const runtime = resolveDesktopRuntime({
      packaged: app.isPackaged,
      repositoryRoot: REPOSITORY_ROOT,
      nodeExecutable: process.env.npm_node_execpath,
      environment: process.env,
      log: desktopLog,
    })
    desktopLog(`desktop start packaged=${String(app.isPackaged)} repository=${REPOSITORY_ROOT}`)
    backend = await startBackend(runtime)
    desktopLog(`backend ready pid=${String(backend.child.pid)} url=${backend.url}`)
    mainWindow = await createWindow(backend.url)
    gameCapture = await createGameCaptureProvider({
      window: mainWindow,
      publish: (gameEvent) => {
        const window = mainWindow
        if (window !== undefined && !window.isDestroyed()) window.webContents.send('desktop:game-surface-state', gameEvent)
      },
      log: desktopLog,
    })
    await gameCapture.select(activeProjectCwd)
    void backend.exited.then(({ code, signal }) => {
      desktopLog(`backend exit code=${String(code)} signal=${String(signal)}`)
      if (shutdown !== undefined) return
      dialog.showErrorBox('Desktop backend stopped', `dsh web exited unexpectedly (${String(code ?? signal)}).`)
      mainWindow?.destroy()
      void shutdownAndQuit()
    }, (error: unknown) => {
      desktopLog(`backend process error: ${error instanceof Error ? error.message : String(error)}`)
      if (shutdown !== undefined) return
      dialog.showErrorBox('Desktop backend stopped', error instanceof Error ? error.message : String(error))
      mainWindow?.destroy()
      void shutdownAndQuit()
    })
  } catch (error) {
    desktopLog(`desktop startup failed: ${error instanceof Error ? error.message : String(error)}`)
    dialog.showErrorBox('Desktop startup failed', error instanceof Error ? error.message : String(error))
    await shutdownAndQuit()
  }
}

void app.whenReady().then(startDesktop)
