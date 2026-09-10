import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, screen } from 'electron'

process.on('uncaughtException', error => { console.error(error); app.exit(1) })
process.on('unhandledRejection', error => { console.error(error); app.exit(1) })
const log = line => {
  console.error(line)
  if (process.env.CRAFTCODE_NATIVE_LOG) appendFileSync(process.env.CRAFTCODE_NATIVE_LOG, `${line}\n`)
}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function until(read, label, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await pause(50)
  }
  throw new Error(`native fixture timed out: ${label}`)
}
const matches = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 2)

async function run() {
  await app.whenReady()
  const koffi = (await import('koffi')).default
  const { createGameCaptureProvider } = await import('../../lib/game-capture.js')
  const { desktopWindowOptions } = await import('../../lib/window.js')
  const { initialGameLayout } = await import('../../lib/game-layout.js')
  const user32 = koffi.load('user32.dll')
  const bind = (name, result, args) => user32.func('__stdcall', name, result, args)
  const enumWindows = bind('EnumWindows', 'int', ['void *', 'intptr'])
  const getWindowText = bind('GetWindowTextW', 'int', ['void *', 'void *', 'int'])
  const getParent = bind('GetParent', 'void *', ['void *'])
  const isVisible = bind('IsWindowVisible', 'int', ['void *'])
  const getStyle = bind('GetWindowLongW', 'int32', ['void *', 'int'])
  const getWindowRect = bind('GetWindowRect', 'int', ['void *', 'void *'])
  const setWindowPos = bind('SetWindowPos', 'int', ['void *', 'void *', 'int', 'int', 'int', 'int', 'uint32'])
  const showWindow = bind('ShowWindowAsync', 'int', ['void *', 'int'])
  const getFrame = koffi.load('dwmapi.dll').func('__stdcall', 'DwmGetWindowAttribute', 'int32', ['void *', 'uint32', 'void *', 'uint32'])
  const proto = koffi.proto('int __stdcall CraftCodeFixtureEnum(void *hwnd, intptr value)')
  const title = `CraftCode Native Game Fixture ${process.pid}`
  function findGame() {
    let found
    const callback = koffi.register(hwnd => {
      const text = Buffer.alloc(512)
      getWindowText(hwnd, text, 256)
      if (text.toString('utf16le').split('\0')[0] === title) found = hwnd
      return found ? 0 : 1
    }, koffi.pointer(proto))
    try { enumWindows(callback, 0) } finally { koffi.unregister(callback) }
    return found
  }
  function rectOf(hwnd, visible = true) {
    const data = Buffer.alloc(16)
    if (!visible || getFrame(hwnd, 9, data, 16) !== 0) {
      if (getWindowRect(hwnd, data) === 0) throw new Error('GetWindowRect failed')
    }
    return { x: data.readInt32LE(0), y: data.readInt32LE(4), width: data.readInt32LE(8) - data.readInt32LE(0), height: data.readInt32LE(12) - data.readInt32LE(4) }
  }
  function moveGame(hwnd, dip) {
    const target = screen.dipToScreenRect(null, dip)
    const outer = rectOf(hwnd, false), visible = rectOf(hwnd)
    if (setWindowPos(hwnd, null, target.x + outer.x - visible.x, target.y + outer.y - visible.y,
      target.width + outer.width - visible.width, target.height + outer.height - visible.height, 0x4214) === 0) throw new Error('fixture move failed')
  }
  const host = new BrowserWindow({ ...desktopWindowOptions(), x: 100, y: 100, width: 900, height: 700 })
  host.webContents.on('render-process-gone', (_event, details) => log(`fixture: renderer gone ${JSON.stringify(details)}`))
  host.on('unresponsive', () => log('fixture: renderer unresponsive'))
  await host.loadURL(`data:text/html,${encodeURIComponent('<body style="margin:0;background:rgb(30,180,90)"><button style="width:200px;height:100px" onclick="this.textContent=String(++window.clicks)">0</button><script>window.clicks=0;window.framesPainted=0;function paint(){window.framesPainted++;requestAnimationFrame(paint)}paint()</script></body>')}`)
  async function verifyRenderer(label) {
    const before = await host.webContents.executeJavaScript('({ frames: window.framesPainted, clicks: window.clicks })')
    host.webContents.sendInputEvent({ type: 'mouseDown', x: 50, y: 50, button: 'left', clickCount: 1 })
    host.webContents.sendInputEvent({ type: 'mouseUp', x: 50, y: 50, button: 'left', clickCount: 1 })
    await until(async () => {
      const after = await host.webContents.executeJavaScript('({ frames: window.framesPainted, clicks: window.clicks })')
      return after.frames > before.frames && after.clicks === before.clicks + 1
    }, `${label}: frame and click`)
    const image = await host.webContents.capturePage({ x: 250, y: 150, width: 10, height: 10 })
    const pixels = image.toBitmap()
    if (image.isEmpty() || pixels[0] !== 90 || pixels[1] !== 180 || pixels[2] !== 30) throw new Error(`${label}: renderer pixels invalid`)
    log(`fixture: ${label} renders and accepts input`)
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./native-game-window.ps1', import.meta.url)), '-Title', title])
  let provider
  try {
    const hwnd = await until(() => {
      const candidate = findGame()
      return candidate && isVisible(candidate) ? candidate : undefined
    }, 'visible game window')
    const originalParent = getParent(hwnd), originalStyle = getStyle(hwnd, -16)
    const originalMinimum = host.getMinimumSize()
    const originalThrottling = host.webContents.getBackgroundThrottling()
    host.maximize()
    await until(() => host.isMaximized(), 'maximize host')
    const area = screen.getDisplayMatching(screen.screenToDipRect(null, rectOf(hwnd))).workArea
    const layout = initialGameLayout(area)
    if (!layout) throw new Error('native fixture needs at least 1024x496 DIP of work area')
    let state
    provider = await createGameCaptureProvider({ window: host, publish: event => { state = event.state; log(`fixture: state ${JSON.stringify(state)}`) }, log })
    await provider.select('C:\\fixture')
    await provider.start('C:\\fixture', child.pid)
    await until(() => state?.status === 'connected' && matches(screen.screenToDipRect(null, rectOf(hwnd)), layout.game) && matches(host.getBounds(), layout.panel), 'initial side-by-side layout')
    if (host.isAlwaysOnTop()) throw new Error('companion became topmost')
    if (getParent(hwnd) !== originalParent || getStyle(hwnd, -16) !== originalStyle) throw new Error('layout changed native parent or styles')
    await verifyRenderer('initial layout')

    host.setBounds({ ...host.getBounds(), width: 380 })
    await pause(100)
    const resizedPanelWidth = host.getBounds().width
    const moved = { ...layout.game, x: layout.game.x + 16, width: layout.game.width - 40, height: layout.game.height - 40 }
    moveGame(hwnd, moved)
    await until(() => matches(host.getBounds(), { x: moved.x + moved.width + 8, y: moved.y, width: resizedPanelWidth, height: moved.height }), 'follow preserving user panel width')
    const last = host.getBounds()
    moveGame(hwnd, { ...moved, x: area.x + area.width - moved.width })
    await pause(600)
    if (!matches(host.getBounds(), last) || host.isAlwaysOnTop()) throw new Error('insufficient space did not pause following')
    moveGame(hwnd, moved)
    await pause(400)
    if (!matches(host.getBounds(), last)) throw new Error('paused panel resumed without reposition')
    await provider.reposition('C:\\fixture')
    await until(() => matches(host.getBounds(), layout.panel), 'explicit reposition')

    const arrangedGame = rectOf(hwnd)
    await provider.select(undefined)
    log(`fixture: unselected host=${JSON.stringify(host.getBounds())} max=${host.isMaximized()}`)
    await provider.select('C:\\fixture')
    log(`fixture: selected host=${JSON.stringify(host.getBounds())} max=${host.isMaximized()}`)
    await provider.reconnect('C:\\fixture')
    await until(() => state?.status === 'connected', 'reconnect')
    await pause(600)
    if (!matches(rectOf(hwnd), arrangedGame)) throw new Error('selection/reconnect resized the game')
    await until(() => matches(host.getBounds(), layout.panel), 'panel after reconnect')
    for (let cycle = 0; cycle < 5; cycle++) {
      showWindow(hwnd, 6)
      await until(() => !host.isVisible(), 'hide companion')
      const hiddenFrames = await host.webContents.executeJavaScript('window.framesPainted')
      await until(async () => await host.webContents.executeJavaScript('window.framesPainted') > hiddenFrames, 'hidden frame scheduling')
      showWindow(hwnd, 9)
      await until(() => host.isVisible(), 'restore companion')
      await verifyRenderer(`restore ${cycle + 1}`)
      if (!matches(host.getBounds(), layout.panel)) throw new Error('restore lost panel geometry')
      if (!matches(rectOf(hwnd), arrangedGame)) throw new Error('restore reset game dimensions')
    }
    let annotationError
    try {
      const still = await provider.beginAnnotation('C:\\fixture')
      if (!still.dataUrl.startsWith('data:image/jpeg;base64,') || still.width < 1 || still.height < 1) throw new Error('annotation capture invalid')
      await provider.endAnnotation('C:\\fixture')
    } catch (error) { annotationError = error }
    if (getParent(hwnd) !== originalParent || getStyle(hwnd, -16) !== originalStyle) throw new Error('annotation changed native parent or styles')
    showWindow(hwnd, 6)
    await until(() => !host.isVisible(), 'minimize before exit')
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    await until(() => state?.status === 'idle' && host.isVisible() && host.isMaximized(), 'hidden game exit restores host')
    if (host.webContents.getBackgroundThrottling() !== originalThrottling || JSON.stringify(host.getMinimumSize()) !== JSON.stringify(originalMinimum)) throw new Error('game exit did not restore host settings')
    await verifyRenderer('game exit')
    if (annotationError !== undefined) throw annotationError
  } finally {
    await provider?.dispose()
    child.kill()
    host.destroy()
    app.quit()
  }
}
void run().catch(error => { log(String(error?.stack ?? error)); app.exit(1) })
