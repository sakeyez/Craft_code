// Built-artifact Windows probe: real capture + real annotation renderer, no Minecraft claim.
import { app, BrowserWindow, desktopCapturer } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { GameCaptureStream } from '../../lib/game-capture-stream.js'
import { GameAnnotationController } from '../../lib/game-annotation.js'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const output = resolve('.artifacts/annotation-performance')
mkdirSync(output, { recursive: true })
const logs = []
const log = line => { logs.push(line); console.log(line) }
async function until(read, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await pause(5) }
  throw new Error(`Timed out: ${label}`)
}
async function run() {
await app.whenReady()
try {
  const game = new BrowserWindow({ x: 80, y: 80, width: 1000, height: 700, frame: false,
    webPreferences: { backgroundThrottling: false } })
  await game.loadURL(`data:text/html,${encodeURIComponent('<body style="background:#32a060;color:white;font:32px monospace">Minecraft capture fixture<br>Readable text 0123456789<div id="clock"></div><script>setInterval(()=>document.getElementById("clock").textContent=Date.now(),50)</script>')}`)
  const hwnd = game.getNativeWindowHandle().readBigUInt64LE()
  const target = capture => ({ bounds: game.getBounds(), valid: () => !game.isDestroyed(), focus: () => game.focus(), capture })
  const thumbnail = async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1000, height: 700 }, fetchWindowIcons: false })
    const source = sources.find(row => row.id.split(':')[1] === String(hwnd))
    if (!source || source.thumbnail.isEmpty()) throw new Error('Missing fixture capture')
    const size = source.thumbnail.getSize()
    return { dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(75).toString('base64')}`, ...size }
  }
  const samples = {}
  async function measure(name, Controller, stream) {
    const rows = []
    let controller
    for (let index = 0; index < 35; index++) {
      if (index < 5 || !controller) {
        controller?.dispose()
        stream?.stop()
        controller = new Controller(game.webContents, log)
      }
      const start = performance.now()
      stream?.warm(hwnd)
      const capture = stream ? () => stream.capture(hwnd, { x: 0, y: 0, width: 1, height: 1 }) : thumbnail
      const done = controller.begin({ operationId: randomUUID(), cwd: process.cwd(), sessionId: 'benchmark', labels: [] }, async () => target(capture))
      let failure
      void done.catch(error => { failure = error })
      const overlay = await until(() => {
        if (failure) throw failure
        return BrowserWindow.getAllWindows().find(window => window !== game && window.isVisible())
      }, 'visible annotation')
      const elapsed = performance.now() - start
      if (index === 5) {
        const shot = await overlay.webContents.capturePage()
        writeFileSync(resolve(output, `${name}.png`), shot.toPNG())
        const loaded = await overlay.webContents.executeJavaScript('document.getElementById("snapshot").naturalWidth')
        if (!loaded) throw new Error('Empty annotation image')
      }
      controller.cancel()
      await done
      if (!overlay.isDestroyed() && overlay.isVisible()) throw new Error('Overlay remained visible')
      rows.push({ phase: index < 5 ? 'cold' : 'warm', ms: elapsed })
      log(`${name} ${index + 1}/35 ${elapsed.toFixed(1)}ms`)
      await pause(100)
    }
    controller.dispose()
    stream?.stop()
    samples[name] = rows
  }
  if (process.env.CRAFTCODE_BASELINE_MODULE) {
    const baseline = await import(pathToFileURL(resolve(process.env.CRAFTCODE_BASELINE_MODULE)).href)
    await measure('before', baseline.GameAnnotationController)
  }
  await measure('after', GameAnnotationController, new GameCaptureStream(log))
  for (const [name, rows] of Object.entries(samples)) {
    for (const phase of ['cold', 'warm']) {
      const values = rows.filter(row => row.phase === phase).map(row => row.ms).sort((a, b) => a - b)
      log(`${name} ${phase} P50=${values[Math.ceil(values.length * .5) - 1].toFixed(1)} P95=${values[Math.ceil(values.length * .95) - 1].toFixed(1)}`)
    }
  }
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ samples, logs }, null, 2))
  game.destroy()
  app.exit(0)
} catch (error) {
  log(String(error.stack ?? error))
  writeFileSync(resolve(output, 'error.log'), logs.join('\n'))
  app.exit(1)
}

}
void run()
