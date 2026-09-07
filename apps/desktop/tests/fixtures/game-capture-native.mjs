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
log('fixture: module loaded')
app.disableHardwareAcceleration()
let koffi
let createGameCaptureProvider

const title = 'CraftCode Native Game Fixture'
const fixture = fileURLToPath(new URL('./native-game-window.ps1', import.meta.url))
let enumWindows
let getWindowTextW
let getParent
let getWindowLongPtrW
let getWindowRect
let getWindowThreadProcessId
let setWindowPos
let showWindow
let enumProto

function handleFromBuffer(buffer) {
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))
}

function windowByTitle() {
  let result
  const callback = koffi.register((hwnd) => {
    const text = Buffer.alloc(512)
    getWindowTextW(hwnd, text, 256)
    const name = text.toString('utf16le').split('\0')[0]
    if (name === title) result = hwnd
    return result === undefined ? 1 : 0
  }, koffi.pointer(enumProto))
  try { enumWindows(callback, 0) } finally { koffi.unregister(callback) }
  return result
}

async function until(read, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined && value !== false) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('native fixture timed out')
}

async function run() {
  await app.whenReady()
  koffi = (await import('koffi')).default
  createGameCaptureProvider = (await import('../../lib/game-capture.js')).createGameCaptureProvider
  const user32 = koffi.load('user32.dll')
  enumWindows = user32.func('__stdcall', 'EnumWindows', 'int', ['void *', 'intptr'])
  getWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['void *', 'void *', 'int'])
  getParent = user32.func('__stdcall', 'GetParent', 'void *', ['void *'])
  getWindowLongPtrW = user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr', ['void *', 'int'])
  getWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int', ['void *', 'void *'])
  getWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', 'void *'])
  setWindowPos = user32.func('__stdcall', 'SetWindowPos', 'int', ['void *', 'void *', 'int', 'int', 'int', 'int', 'uint32'])
  showWindow = user32.func('__stdcall', 'ShowWindow', 'int', ['void *', 'int'])
  enumProto = koffi.proto('int __stdcall CraftCodeFixtureEnum(void *hwnd, intptr value)')
  log('fixture: electron ready')
  const host = new BrowserWindow({ frame: false, show: true, x: 100, y: 100, width: 900, height: 700 })
  await host.loadURL('data:text/html,<body style="margin:0;background:%23222"></body>')
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fixture])

  try {
    const hwnd = await until(windowByTitle)
    log('fixture: native window ready')
    log(`fixture: hwnd ${String(hwnd)}`)
    const pid = Buffer.alloc(4)
    getWindowThreadProcessId(hwnd, pid)
    log(`fixture: root pid ${String(child.pid)} window pid ${String(pid.readUInt32LE(0))}`)
    const originalStyle = Number(getWindowLongPtrW(hwnd, -16)) >>> 0
    const originalParent = getParent(hwnd)
    const originalHostBounds = host.getBounds()
    let state
    const provider = await createGameCaptureProvider({ window: host, publish: event => { state = event.state; log(`fixture: state ${JSON.stringify(event.state)}`) }, log })
    await provider.select('C:\\fixture')
    await provider.start('C:\\fixture', child.pid)
    await until(() => state?.status === 'connected')
    log('fixture: connected')
    await until(() => getParent(hwnd) === originalParent)
    log('fixture: top-level parent verified')
    const rect = Buffer.alloc(16)
    if (getWindowRect(hwnd, rect) === 0) throw new Error('GetWindowRect failed')
    const actualWidth = rect.readInt32LE(8) - rect.readInt32LE(0)
    const actualHeight = rect.readInt32LE(12) - rect.readInt32LE(4)
    if (actualWidth < 1 || actualHeight < 1) throw new Error('window bounds invalid')
    if ((Number(getWindowLongPtrW(hwnd, -16)) >>> 0 & 0x40000000) !== 0) throw new Error('WS_CHILD was set')
    const moved = Buffer.alloc(16)
    getWindowRect(hwnd, moved)
    const movedX = moved.readInt32LE(0) + 40
    const movedY = moved.readInt32LE(4) + 24
    const beforeMoveHost = host.getBounds()
    if (Number(setWindowPos(hwnd, 0n, movedX, movedY, actualWidth + 120, actualHeight + 60, 0x0010)) === 0) throw new Error('SetWindowPos fixture move failed')
    const movedRect = Buffer.alloc(16)
    getWindowRect(hwnd, movedRect)
    log(`fixture: game before=${JSON.stringify({ x: moved.readInt32LE(0), y: moved.readInt32LE(4), width: actualWidth, height: actualHeight })} after=${JSON.stringify({ x: movedRect.readInt32LE(0), y: movedRect.readInt32LE(4), width: movedRect.readInt32LE(8) - movedRect.readInt32LE(0), height: movedRect.readInt32LE(12) - movedRect.readInt32LE(4) })}`)
    await until(() => { const bounds = host.getBounds(); return bounds.x !== originalHostBounds.x || bounds.y !== originalHostBounds.y })
    const movedHost = host.getBounds()
    log(`fixture: companion before=${JSON.stringify(beforeMoveHost)} after=${JSON.stringify(movedHost)}`)
    if (movedHost.x === beforeMoveHost.x && movedHost.y === beforeMoveHost.y && movedHost.width === beforeMoveHost.width && movedHost.height === beforeMoveHost.height) {
      await provider.reconnect('C:\\fixture')
      await until(() => state?.status === 'connected')
      await new Promise(resolve => setTimeout(resolve, 400))
      await provider.select('C:\\fixture')
      const retriedHost = host.getBounds()
      if (retriedHost.x === beforeMoveHost.x && retriedHost.y === beforeMoveHost.y && retriedHost.width === beforeMoveHost.width && retriedHost.height === beforeMoveHost.height) throw new Error('companion bounds did not follow game resize')
    }
    if (getParent(hwnd) !== originalParent || (Number(getWindowLongPtrW(hwnd, -16)) >>> 0) !== originalStyle) throw new Error('provider changed native ownership or style')
    showWindow(hwnd, 6)
    await until(() => !host.isVisible())
    showWindow(hwnd, 9)
    await until(() => host.isVisible())
    await provider.select(undefined)
    await provider.select('C:\\fixture')
    const still = await provider.beginAnnotation('C:\\fixture')
    if (!still.dataUrl.startsWith('data:image/jpeg;base64,') || still.width < 1 || still.height < 1) throw new Error('annotation capture was invalid')
    if (getParent(hwnd) !== originalParent) throw new Error('annotation capture changed the parent')
    await provider.endAnnotation('C:\\fixture')
    if (getParent(hwnd) !== originalParent || (Number(getWindowLongPtrW(hwnd, -16)) >>> 0) !== originalStyle) throw new Error('annotation changed native ownership or style')
    log('fixture: annotation preserved native state')
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
    await until(() => state?.status === 'idle')
    log('fixture: natural process exit returned idle')
    await provider.dispose()
    await until(() => getParent(hwnd) === originalParent)
    log('fixture: top-level state preserved')
  } finally {
    child.kill()
    host.destroy()
    app.quit()
  }
}

void run().catch(error => { log(String(error?.stack ?? error)); app.exit(1) })
