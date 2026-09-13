// Real Windows registration and keyboard delivery, using a fixture window in place of Minecraft.
import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import { GameAnnotationController } from '../../lib/game-annotation.js'
import { GameAnnotationShortcut } from '../../lib/game-annotation-shortcut.js'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function run() {
  await app.whenReady()
  const koffi = (await import('koffi')).default
  const user32 = koffi.load('user32.dll')
  const key = user32.func('__stdcall', 'keybd_event', 'void', ['uint8', 'uint8', 'uint32', 'uintptr'])
  const foreground = user32.func('__stdcall', 'GetForegroundWindow', 'void *', [])
  const keyState = user32.func('__stdcall', 'GetAsyncKeyState', 'int16', ['int'])
  const release = () => { for (const vk of [0x50, 0x10, 0x11]) key(vk, 0, 2, 0) }
  const press = () => { for (const vk of [0x11, 0x10, 0x50]) key(vk, 0, 0, 0) }
  let shortcut, annotation
  try {
    const game = new BrowserWindow({ width: 700, height: 480, title: 'CraftCode shortcut fixture',
      webPreferences: { sandbox: true, contextIsolation: true, preload: fileURLToPath(new URL('../../lib/preload.cjs', import.meta.url)) } })
    await game.loadURL('data:text/html,<h1>Shortcut fixture</h1>')
    const hwnd = game.getNativeWindowHandle().readBigUInt64LE()
    const provider = {
      annotationTarget: async () => ({ bounds: game.getBounds(), valid: () => true }),
      annotationShortcutHeld: async () => (Number(keyState(0x50)) & 0x8000) !== 0,
      isAnnotationForeground: async () => foreground() === hwnd,
    }
    annotation = new GameAnnotationController(game.webContents)
    shortcut = new GameAnnotationShortcut(game.webContents, provider, annotation, () => process.cwd())
    ipcMain.handle('desktop:annotation-shortcut-bind', (_event, request, token) => shortcut.bind(request, token))
    await game.webContents.executeJavaScript(`window.shortcutCount=0; window.shortcutErrors=[];
      window.unbindShortcut=window.craftCodeDesktop.bindGameAnnotationShortcut({cwd:${JSON.stringify(process.cwd())},sessionId:'native',operationId:'native-token',labels:[]},error=>{if(error)window.shortcutErrors.push(error);else window.shortcutCount++}); void 0`)
    await pause(800)
    game.focus()
    await pause(250)
    if (foreground() !== hwnd) throw new Error('Fixture could not acquire native foreground')
    press()
    await pause(700)
    if (await game.webContents.executeJavaScript('window.shortcutCount') !== 1) throw new Error('Native shortcut was not delivered exactly once')
    release()
    await pause(350)
    press(); await pause(100); release(); await pause(250)
    if (await game.webContents.executeJavaScript('window.shortcutCount') !== 2) throw new Error('Released shortcut did not trigger again')
    const other = new BrowserWindow({ width: 300, height: 200 })
    await other.loadURL('data:text/html,<h1>Unrelated window</h1>')
    other.focus(); await pause(350)
    press(); await pause(100); release(); await pause(250)
    if (await game.webContents.executeJavaScript('window.shortcutCount') !== 2) throw new Error('Shortcut escaped its foreground scope')
    await game.webContents.executeJavaScript('window.unbindShortcut()')
    await pause(100)
    console.log('PASS native Ctrl+Shift+P, hold/release, unrelated foreground, preload disposal')
    shortcut.dispose(); annotation.dispose()
    other.destroy(); game.destroy()
    app.exit(0)
  } finally { release(); shortcut?.dispose(); annotation?.dispose() }
}
void run().catch(error => { console.error(error); app.exit(1) })
