import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

process.on('uncaughtException', error => { console.error(error); app.exit(1) })
process.on('unhandledRejection', error => { console.error(error); app.exit(1) })
const log = line => { console.error(line); if (process.env.CRAFTCODE_NATIVE_LOG) appendFileSync(process.env.CRAFTCODE_NATIVE_LOG, `${line}\n`) }
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function until(read, label, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await pause(50) }
  throw new Error(`native fixture timed out: ${label}`)
}

async function run() {
  await app.whenReady()
  const koffi = (await import('koffi')).default
  const { createGameCaptureProvider } = await import('../../lib/game-capture.js')
  const { GameCaptureStream } = await import('../../lib/game-capture-stream.js')
  const { desktopWindowOptions } = await import('../../lib/window.js')
  const user32 = koffi.load('user32.dll')
  const bind = (name, result, args) => user32.func('__stdcall', name, result, args)
  const enumWindows = bind('EnumWindows', 'int', ['void *', 'intptr'])
  const getWindowText = bind('GetWindowTextW', 'int', ['void *', 'void *', 'int'])
  const getParent = bind('GetParent', 'void *', ['void *'])
  const isVisible = bind('IsWindowVisible', 'int', ['void *'])
  const getStyle = bind('GetWindowLongW', 'int32', ['void *', 'int'])
  const getWindowRect = bind('GetWindowRect', 'int', ['void *', 'void *'])
  const proto = koffi.proto('int __stdcall CraftCodeFixtureEnum(void *hwnd, intptr value)')
  const title = `CraftCode Native Game Fixture ${process.pid}`
  function findGame() {
    let found
    const callback = koffi.register(hwnd => {
      const text = Buffer.alloc(512); getWindowText(hwnd, text, 256)
      if (text.toString('utf16le').split('\0')[0] === title) found = hwnd
      return found ? 0 : 1
    }, koffi.pointer(proto))
    try { enumWindows(callback, 0) } finally { koffi.unregister(callback) }
    return found
  }
  function rectOf(hwnd) {
    const data = Buffer.alloc(16)
    if (getWindowRect(hwnd, data) === 0) throw new Error('GetWindowRect failed')
    return { x: data.readInt32LE(0), y: data.readInt32LE(4), width: data.readInt32LE(8) - data.readInt32LE(0), height: data.readInt32LE(12) - data.readInt32LE(4) }
  }
  const host = new BrowserWindow({ ...desktopWindowOptions(), x: 100, y: 100, width: 900, height: 700 })
  await host.loadURL(`data:text/html,${encodeURIComponent('<body style="margin:0;background:rgb(30,180,90)"><button style="width:200px;height:100px" onclick="this.textContent=String(++window.clicks)">0</button><script>window.clicks=0;window.framesPainted=0;function paint(){window.framesPainted++;requestAnimationFrame(paint)}paint()</script></body>')}`)
  host.show()
  const sameBounds = (left, right) => ['x', 'y', 'width', 'height'].every(key => Math.abs(left[key] - right[key]) <= 4)
  async function verifyRenderer(label) {
    const before = await host.webContents.executeJavaScript('({ frames: window.framesPainted, clicks: window.clicks })')
    host.webContents.sendInputEvent({ type: 'mouseDown', x: 50, y: 50, button: 'left', clickCount: 1 }); host.webContents.sendInputEvent({ type: 'mouseUp', x: 50, y: 50, button: 'left', clickCount: 1 })
    await until(async () => { const after = await host.webContents.executeJavaScript('({ frames: window.framesPainted, clicks: window.clicks })'); return after.frames > before.frames && after.clicks === before.clicks + 1 }, `${label}: frame and click`)
    log(`fixture: ${label} renders and accepts input`)
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./native-game-window.ps1', import.meta.url)), '-Title', title])
  let provider
  try {
    const hwnd = await until(() => { const candidate = findGame(); return candidate && isVisible(candidate) ? candidate : undefined }, 'visible game window')
    const originalParent = getParent(hwnd), originalStyle = getStyle(hwnd, -16), originalHost = host.getBounds()
    log(`fixture: original host bounds=${JSON.stringify(originalHost)}`)
    let state
    provider = await createGameCaptureProvider({ stream: new GameCaptureStream(log), window: host, publish: event => { state = event.state; log(`fixture: state ${JSON.stringify(state)}`) }, log })
    await provider.select('C:\\fixture'); await provider.start('C:\\fixture', child.pid)
    await until(() => state?.status === 'connected', 'connected game state')
    const stableHost = host.getBounds()
    if (getParent(hwnd) !== originalParent || getStyle(hwnd, -16) !== originalStyle) throw new Error('game capture changed host or native game window')
    await verifyRenderer('connected')
    const still = await provider.beginAnnotation('C:\\fixture')
    if (!still.dataUrl.startsWith('data:image/jpeg;base64,') || still.width < 1 || still.height < 1) throw new Error('annotation capture invalid')
    await provider.endAnnotation('C:\\fixture')
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    await until(() => state?.status === 'idle', 'game exit')
    log(`fixture: host after game exit bounds=${JSON.stringify(host.getBounds())} stable=${JSON.stringify(stableHost)} visible=${host.isVisible()} destroyed=${host.isDestroyed()}`)
    if (!sameBounds(host.getBounds(), stableHost) || !host.isVisible()) throw new Error('game exit changed host window')
    await verifyRenderer('game exit')
  } finally { await provider?.dispose(); child.kill(); host.destroy(); app.quit() }
}
void run().catch(error => { log(String(error?.stack ?? error)); app.exit(1) })
