import type { AnnotationTarget } from './game-annotation.ts'
/* oxlint-disable */
/** Windows Minecraft discovery and CraftCode companion-panel tracking. */
import { desktopCapturer, screen, type BrowserWindow, type Rectangle } from 'electron'
import { followGameBounds, initialGameLayout, MIN_PANEL_WIDTH, rectanglesMatch } from './game-layout.ts'
import type {
  GameCaptureEvent, GameCaptureProvider, GameCaptureProviderOptions,
  GameCaptureSnapshot, GameCaptureState,
} from './game-capture.ts'

interface KoffiFunction { (...args: unknown[]): unknown }
interface KoffiLibrary { func(convention: string, name: string, result: string, args: string[]): KoffiFunction }
interface Koffi {
  load(path: string): KoffiLibrary
  proto(declaration: string): unknown
  pointer(type: unknown): unknown
  register(fn: (...args: unknown[]) => unknown, type: unknown): bigint
  unregister(callback: bigint): void
  struct(name: string, fields: Record<string, unknown>): { size: number }
  array(type: string, length: number): unknown
  alloc(type: unknown, count: number): unknown
  encode(ref: unknown, type: string, value: unknown): void
  decode(ref: unknown, type: unknown): unknown
}

type Hwnd = bigint
interface ProcessEntry { pid: number; parentPid: number }
export interface WindowCandidate { hwnd: Hwnd; pid: number; className: string; title: string; width: number; height: number }
export interface NativeRect { left: number; top: number; right: number; bottom: number }
interface WindowSnapshot { rect: NativeRect; visible: boolean; minimized: boolean; fullscreen: boolean }
interface CaptureEntry {
  cwd: string
  state: GameCaptureState
  knownPids: Map<number, string>
  abort: AbortController
  hwnd?: Hwnd
  lastWindow?: WindowSnapshot
  owner?: { pid: number; identity: string }
  layout: 'pending' | 'arranging' | 'following' | 'paused' | 'failed'
  layoutHwnd?: Hwnd
  stableSamples: number
  panelWidth?: number
}
export interface Win32Bindings {
  processSnapshot(): ProcessEntry[]
  processIdentity(pid: number): string | undefined
  enumerateWindows(): WindowCandidate[]
  isWindow(hwnd: Hwnd): boolean
  getClientRect(hwnd: Hwnd): NativeRect | undefined
  focusWindow(hwnd: Hwnd): void
  getWindowRect(hwnd: Hwnd): NativeRect | undefined
  isWindowVisible(hwnd: Hwnd): boolean
  isWindowMinimized(hwnd: Hwnd): boolean
  windowPid(hwnd: Hwnd): number
  hasCaption(hwnd: Hwnd): boolean
  isWindowMaximized(hwnd: Hwnd): boolean
  restoreWindow(hwnd: Hwnd): boolean
  positionWindow(hwnd: Hwnd, rect: NativeRect): boolean
}

const POLL_MS = 250
const FIND_TIMEOUT_MS = 120_000
const MAX_SNAPSHOT_WIDTH = 1920
const MAX_SNAPSHOT_HEIGHT = 1080
const POSITION_TIMEOUT_MS = 2_000

export function descendantPids(entries: readonly ProcessEntry[], rootPid: number): Set<number> {
  const children = new Map<number, number[]>()
  for (const entry of entries) children.set(entry.parentPid, [...children.get(entry.parentPid) ?? [], entry.pid])
  const result = new Set<number>()
  const visit = (pid: number): void => { if (!result.has(pid)) { result.add(pid); for (const child of children.get(pid) ?? []) visit(child) } }
  visit(rootPid)
  return result
}

export function windowCandidateScore(candidate: WindowCandidate): number {
  if (candidate.width < 320 || candidate.height < 200) return -1
  let score = candidate.width * candidate.height / 1_000_000
  if (candidate.className.toLowerCase() === 'glfw30') score += 100
  if (/minecraft|fabric|neoforge/u.test(candidate.title.toLowerCase())) score += 20
  return score
}

export function selectWindowCandidate(candidates: readonly WindowCandidate[], identities: ReadonlyMap<number, string>, identityOf: (pid: number) => string | undefined): WindowCandidate | undefined {
  return candidates.filter(candidate => identities.has(candidate.pid) && identities.get(candidate.pid) === identityOf(candidate.pid))
    .map(candidate => ({ candidate, score: windowCandidateScore(candidate) })).filter(row => row.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.candidate
}

function nativeRect(buffer: Buffer): NativeRect { return { left: buffer.readInt32LE(0), top: buffer.readInt32LE(4), right: buffer.readInt32LE(8), bottom: buffer.readInt32LE(12) } }
function rectangle(rect: NativeRect): Rectangle { return { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top } }
function utf16(buffer: Buffer): string { let end = 0; while (end + 1 < buffer.length && (buffer[end] !== 0 || buffer[end + 1] !== 0)) end += 2; return buffer.toString('utf16le', 0, end) }

async function loadBindings(): Promise<Win32Bindings> {
  const koffi = (await import('koffi')).default as unknown as Koffi
  const kernel32 = koffi.load('kernel32.dll')
  const user32 = koffi.load('user32.dll')
  const dwmapi = koffi.load('dwmapi.dll')
  const PROCESSENTRY32W = koffi.struct('CRAFTCODE_PROCESSENTRY32W', {
    dwSize: 'uint32', cntUsage: 'uint32', th32ProcessID: 'uint32', th32DefaultHeapID: 'void *',
    th32ModuleID: 'uint32', cCntThreads: 'uint32', th32ParentProcessID: 'uint32', pcPriClassBase: 'int32',
    dwFlags: 'uint32', szExeFile: koffi.array('char16', 260),
  })
  const bind = (library: KoffiLibrary, name: string, result: string, args: string[]): KoffiFunction => library.func('__stdcall', name, result, args)
  const createSnapshot = bind(kernel32, 'CreateToolhelp32Snapshot', 'void *', ['uint32', 'uint32'])
  const processFirst = bind(kernel32, 'Process32FirstW', 'int', ['void *', 'void *'])
  const processNext = bind(kernel32, 'Process32NextW', 'int', ['void *', 'void *'])
  const closeHandle = bind(kernel32, 'CloseHandle', 'int', ['void *'])
  const openProcess = bind(kernel32, 'OpenProcess', 'void *', ['uint32', 'int', 'uint32'])
  const getProcessTimes = bind(kernel32, 'GetProcessTimes', 'int', ['void *', 'void *', 'void *', 'void *', 'void *'])
  const getExitCodeProcess = bind(kernel32, 'GetExitCodeProcess', 'int', ['void *', 'void *'])
  const enumWindows = bind(user32, 'EnumWindows', 'int', ['void *', 'intptr'])
  const getWindowPid = bind(user32, 'GetWindowThreadProcessId', 'uint32', ['void *', 'void *'])
  const isWindow = bind(user32, 'IsWindow', 'int', ['void *'])
  const isVisible = bind(user32, 'IsWindowVisible', 'int', ['void *'])
  const isIconic = bind(user32, 'IsIconic', 'int', ['void *'])
  const isZoomed = bind(user32, 'IsZoomed', 'int', ['void *'])
  const getWindowStyle = bind(user32, 'GetWindowLongW', 'int32', ['void *', 'int'])
  const showWindowAsync = bind(user32, 'ShowWindowAsync', 'int', ['void *', 'int'])
  const setWindowPos = bind(user32, 'SetWindowPos', 'int', ['void *', 'void *', 'int', 'int', 'int', 'int', 'uint32'])
  const getFrame = bind(dwmapi, 'DwmGetWindowAttribute', 'int32', ['void *', 'uint32', 'void *', 'uint32'])
  const getClassName = bind(user32, 'GetClassNameW', 'int', ['void *', 'void *', 'int'])
  const getWindowText = bind(user32, 'GetWindowTextW', 'int', ['void *', 'void *', 'int'])
  const clientToScreen = bind(user32, 'ClientToScreen', 'int', ['void *', 'void *'])
  const foreground = bind(user32, 'SetForegroundWindow', 'int', ['void *'])
  const getClientRect = bind(user32, 'GetClientRect', 'int', ['void *', 'void *'])
  const getWindowRect = bind(user32, 'GetWindowRect', 'int', ['void *', 'void *'])
  const enumProto = koffi.proto('int __stdcall CraftCodeEnumWindows(void *hwnd, intptr value)')
  const outerRect = (hwnd: Hwnd): NativeRect | undefined => {
    const buffer = Buffer.alloc(16)
    return Number(getWindowRect(hwnd, buffer)) === 0 ? undefined : nativeRect(buffer)
  }
  const visibleRect = (hwnd: Hwnd): NativeRect | undefined => {
    const buffer = Buffer.alloc(16)
    if (Number(getFrame(hwnd, 9, buffer, 16)) === 0) {
      const rect = nativeRect(buffer)
      if (rect.right > rect.left && rect.bottom > rect.top) return rect
    }
    return outerRect(hwnd)
  }

  return {
    processSnapshot: () => {
      const snapshot = createSnapshot(0x2, 0) as Hwnd | null
      if (snapshot === null || snapshot === 0n || snapshot === -1n) return []
      const rows: ProcessEntry[] = []
      try {
        const entry = koffi.alloc(PROCESSENTRY32W, 1)
        koffi.encode(entry, 'uint32', PROCESSENTRY32W.size)
        let ok = Number(processFirst(snapshot, entry))
        while (ok !== 0) {
          const decoded = koffi.decode(entry, PROCESSENTRY32W) as { th32ProcessID: number; th32ParentProcessID: number }
          rows.push({ pid: decoded.th32ProcessID, parentPid: decoded.th32ParentProcessID })
          ok = Number(processNext(snapshot, entry))
        }
      } finally { closeHandle(snapshot) }
      return rows
    },
    processIdentity: (pid) => {
      const handle = openProcess(0x1000, 0, pid) as Hwnd | null
      if (handle === null || handle === 0n) return undefined
      try {
        const exitCode = Buffer.alloc(4)
        if (Number(getExitCodeProcess(handle, exitCode)) === 0 || exitCode.readUInt32LE(0) !== 259) return undefined
        const creation = Buffer.alloc(8)
        if (Number(getProcessTimes(handle, creation, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8))) === 0) return undefined
        return `${String(creation.readUInt32LE(4))}:${String(creation.readUInt32LE(0))}`
      } finally { closeHandle(handle) }
    },
    enumerateWindows: () => {
      const result: WindowCandidate[] = []
      const callback = koffi.register((rawHwnd: unknown) => {
        const hwnd = rawHwnd as Hwnd
        if (Number(isVisible(hwnd)) === 0) return 1
        const pidBuffer = Buffer.alloc(4); const classBuffer = Buffer.alloc(512); const titleBuffer = Buffer.alloc(2048); const rectBuffer = Buffer.alloc(16)
        getWindowPid(hwnd, pidBuffer); getClassName(hwnd, classBuffer, classBuffer.length / 2); getWindowText(hwnd, titleBuffer, titleBuffer.length / 2)
        if (Number(getClientRect(hwnd, rectBuffer)) === 0) return 1
        const rect = nativeRect(rectBuffer)
        result.push({ hwnd, pid: pidBuffer.readUInt32LE(0), className: utf16(classBuffer), title: utf16(titleBuffer), width: rect.right - rect.left, height: rect.bottom - rect.top })
        return 1
      }, koffi.pointer(enumProto))
      try { enumWindows(callback, 0) } finally { koffi.unregister(callback) }
      return result
    },
    isWindow: hwnd => Number(isWindow(hwnd)) !== 0,
    getWindowRect: visibleRect,
    focusWindow: hwnd => { foreground(hwnd) },
    getClientRect: hwnd => {
      const rect = Buffer.alloc(16); const origin = Buffer.alloc(8)
      if (!Number(getClientRect(hwnd, rect)) || !Number(clientToScreen(hwnd, origin))) return undefined
      const x = origin.readInt32LE(0); const y = origin.readInt32LE(4)
      return { left: x, top: y, right: x + rect.readInt32LE(8), bottom: y + rect.readInt32LE(12) }
    },
    isWindowVisible: hwnd => Number(isVisible(hwnd)) !== 0,
    isWindowMinimized: hwnd => Number(isIconic(hwnd)) !== 0,
    windowPid: hwnd => { const pid = Buffer.alloc(4); getWindowPid(hwnd, pid); return pid.readUInt32LE(0) },
    hasCaption: hwnd => (Number(getWindowStyle(hwnd, -16)) & 0x00c00000) !== 0,
    isWindowMaximized: hwnd => Number(isZoomed(hwnd)) !== 0,
    restoreWindow: hwnd => Number(showWindowAsync(hwnd, 9)) !== 0,
    positionWindow: (hwnd, target) => {
      const outer = outerRect(hwnd); const visible = visibleRect(hwnd)
      if (outer === undefined || visible === undefined) return false
      // DWM excludes invisible resize borders; SetWindowPos includes them.
      const left = target.left + outer.left - visible.left
      const top = target.top + outer.top - visible.top
      const right = target.right + outer.right - visible.right
      const bottom = target.bottom + outer.bottom - visible.bottom
      return Number(setWindowPos(hwnd, null, Math.round(left), Math.round(top), Math.round(right - left), Math.round(bottom - top), 0x4214)) !== 0
    },
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Game capture aborted.')); return }
    const onAbort = (): void => { clearTimeout(timer); reject(new Error('Game capture aborted.')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class WindowsGameCaptureProvider implements GameCaptureProvider {
  readonly #window: BrowserWindow
  readonly #publish: (event: GameCaptureEvent) => void
  readonly #log: (line: string) => void
  readonly #entries = new Map<string, CaptureEntry>()
  #selectedCwd: string | undefined
  #bindingsPromise: Promise<Win32Bindings> | undefined
  #companion = false
  #appliedPanelBounds: Rectangle | undefined
  #saved: { bounds: Rectangle; maximized: boolean; alwaysOnTop: boolean; minimumSize: [number, number]; backgroundThrottling: boolean } | undefined
  #selectionGeneration = 0
  #userSuppressed = false
  #visibilityAction = false
  #restoreMaximizedPending = false
  readonly #onWindowMinimize = (): void => { if (!this.#visibilityAction) this.#userSuppressed = true }
  readonly #onWindowHide = (): void => { if (!this.#visibilityAction) this.#userSuppressed = true }
  readonly #onWindowShow = (): void => { if (!this.#visibilityAction) this.#userSuppressed = false }
  readonly #onWindowRestore = (): void => {
    if (!this.#restoreMaximizedPending || this.#companion || this.#window.isDestroyed() || this.#window.isMaximized()) return
    this.#restoreMaximizedPending = false
    this.#window.maximize()
  }

  constructor(options: GameCaptureProviderOptions, bindings?: Win32Bindings) {
    this.#window = options.window
    this.#publish = options.publish
    this.#log = options.log ?? (() => {})
    if (bindings !== undefined) this.#bindingsPromise = Promise.resolve(bindings)
    this.#window.on('minimize', this.#onWindowMinimize)
    this.#window.on('hide', this.#onWindowHide)
    this.#window.on('show', this.#onWindowShow)
    this.#window.on('restore', this.#onWindowRestore)
  }

  async start(cwd: string, rootPid: number): Promise<GameCaptureState> {
    await this.stop(cwd, false)
    const identity = (await this.#bindings()).processIdentity(rootPid)
    if (identity === undefined) return this.#set(cwd, { status: 'failed', gameName: 'Minecraft', error: '无法确认 Gradle 启动进程，游戏仍可能在独立窗口中运行。' })
    const state: GameCaptureState = { status: 'starting', gameName: 'Minecraft' }
    const entry: CaptureEntry = { cwd, state, knownPids: new Map([[rootPid, identity]]), abort: new AbortController(), layout: 'pending', stableSamples: 0 }
    this.#entries.set(cwd, entry); this.#emit(entry, state); void this.#discover(entry)
    return state
  }

  async reconnect(cwd: string): Promise<GameCaptureState> {
    const entry = this.#entries.get(cwd)
    if (entry === undefined) return { status: 'failed', error: '该项目没有正在运行的游戏进程。' }
    entry.abort.abort(); entry.abort = new AbortController(); delete entry.hwnd; delete entry.lastWindow
    entry.stableSamples = 0
    if (entry.layout === 'arranging') entry.layout = 'pending'
    const state: GameCaptureState = { status: 'reconnecting', gameName: 'Minecraft' }
    this.#emit(entry, state); void this.#discover(entry)
    return state
  }

  async select(cwd: string | undefined): Promise<void> {
    if (cwd === this.#selectedCwd) return
    const previous = this.#selectedCwd === undefined ? undefined : this.#entries.get(this.#selectedCwd)
    if (previous !== undefined && this.#companion && !this.#window.isDestroyed()) previous.panelWidth = this.#panelWidth(previous)
    this.#selectedCwd = cwd
    const generation = ++this.#selectionGeneration
    await this.#leaveCompanion()
    await this.#refreshCompanion(true, generation)
  }

  async reposition(cwd: string): Promise<void> {
    const entry = this.#connected(cwd)
    if (cwd !== this.#selectedCwd) throw new Error('只能重新定位当前项目的窗口。')
    await this.#arrange(entry, await this.#bindings(), this.#selectionGeneration)
  }

  async stop(cwd: string, publish = true): Promise<void> {
    const entry = this.#entries.get(cwd)
    if (entry !== undefined) { entry.abort.abort(); this.#entries.delete(cwd) }
    if (publish) this.#publish({ cwd, state: { status: 'idle' } })
    if (cwd === this.#selectedCwd) await this.#leaveCompanion()
  }

  async annotationTarget(cwd: string): Promise<AnnotationTarget> {
    const entry = this.#connected(cwd)
    const bindings = await this.#bindings()
    const hwnd = entry.hwnd as Hwnd
    const outer = bindings.getWindowRect(hwnd)
    const client = bindings.getClientRect(hwnd)
    if (!outer || !client || client.right <= client.left || client.bottom <= client.top) throw new Error('无法读取游戏画面位置。')
    const bounds = this.#toDipRect(client)
    const valid = (): boolean => {
      const rect = bindings.getWindowRect(hwnd)
      return this.#selectedCwd === cwd && this.#entries.get(cwd) === entry && entry.hwnd === hwnd
        && entry.state.status === 'connected' && this.#ownsWindow(entry, bindings)
        && rect !== undefined && JSON.stringify(rect) === JSON.stringify(outer)
        && JSON.stringify(bindings.getClientRect(hwnd)) === JSON.stringify(client)
        && rectanglesMatch(this.#toDipRect(client), bounds)
        && bindings.isWindowVisible(hwnd) && !bindings.isWindowMinimized(hwnd)
        && !this.#snapshot(hwnd, rect, bindings).fullscreen
    }
    if (!valid()) throw new Error('请恢复 Minecraft 普通窗口后标注。')
    return {
      bounds, valid, focus: () => { if (valid()) bindings.focusWindow(hwnd) },
      capture: () => this.#captureAnnotation(cwd, client),
    }
  }

  async beginAnnotation(cwd: string): Promise<GameCaptureSnapshot> {
    return this.#captureAnnotation(cwd)
  }

  async #captureAnnotation(cwd: string, client?: NativeRect): Promise<GameCaptureSnapshot> {
    const entry = this.#connected(cwd)
    if (this.#selectedCwd !== cwd) throw new Error('只能标注当前项目的 Minecraft 窗口。')
    const bindings = await this.#bindings()
    const rect = bindings.getWindowRect(entry.hwnd as Hwnd)
    const snapshot = rect === undefined ? undefined : this.#snapshot(entry.hwnd as Hwnd, rect, bindings)
    if (!this.#ownsWindow(entry, bindings)) throw new Error('游戏窗口身份已变化。')
    if (snapshot === undefined || !snapshot.visible || snapshot.minimized) throw new Error('Minecraft 窗口当前不可见，请先恢复窗口。')
    const hwnd = entry.hwnd as Hwnd
    const width = snapshot.rect.right - snapshot.rect.left; const height = snapshot.rect.bottom - snapshot.rect.top
    const scale = Math.min(1, MAX_SNAPSHOT_WIDTH / width, MAX_SNAPSHOT_HEIGHT / height)
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }, fetchWindowIcons: false })
    const source = sources.find(candidate => { try { return BigInt(candidate.id.split(':')[1] ?? '') === hwnd } catch { return false } })
    if (source === undefined || source.thumbnail.isEmpty()) throw new Error('无法从 Minecraft 窗口获取标注截图，请确认窗口可见后重试。')
    let thumbnail = source.thumbnail
    if (client !== undefined) {
      const size = thumbnail.getSize()
      const x = Math.max(0, Math.round((client.left - snapshot.rect.left) / width * size.width))
      const y = Math.max(0, Math.round((client.top - snapshot.rect.top) / height * size.height))
      thumbnail = thumbnail.crop({ x, y,
        width: Math.min(size.width - x, Math.round((client.right - client.left) / width * size.width)),
        height: Math.min(size.height - y, Math.round((client.bottom - client.top) / height * size.height)),
      })
    }
    const size = thumbnail.getSize()
    this.#log(`annotation captured cwd=${cwd} hwnd=${String(hwnd)}`)
    return { dataUrl: `data:image/jpeg;base64,${thumbnail.toJPEG(85).toString('base64')}`, width: size.width, height: size.height }
  }

  async endAnnotation(_cwd: string): Promise<void> {}
  async dispose(): Promise<void> {
    for (const cwd of [...this.#entries.keys()]) await this.stop(cwd, false)
    await this.#leaveCompanion()
    this.#window.removeListener('minimize', this.#onWindowMinimize)
    this.#window.removeListener('hide', this.#onWindowHide)
    this.#window.removeListener('show', this.#onWindowShow)
    this.#window.removeListener('restore', this.#onWindowRestore)
  }

  async #discover(entry: CaptureEntry): Promise<void> {
    const signal = entry.abort.signal
    try {
      const bindings = await this.#bindings(); const deadline = Date.now() + FIND_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (signal.aborted || this.#entries.get(entry.cwd) !== entry) return
        const snapshot = bindings.processSnapshot()
        const roots = [...entry.knownPids].filter(([pid, identity]) => bindings.processIdentity(pid) === identity).map(([pid]) => pid)
        const descendants = new Set<number>(); for (const root of roots) for (const pid of descendantPids(snapshot, root)) descendants.add(pid)
        for (const pid of descendants) { const identity = bindings.processIdentity(pid); if (identity !== undefined) entry.knownPids.set(pid, identity) }
        const candidate = selectWindowCandidate(bindings.enumerateWindows(), entry.knownPids, pid => bindings.processIdentity(pid))
        if (candidate !== undefined) {
          const identity = entry.knownPids.get(candidate.pid)
          if (identity === undefined) continue
          if (entry.layoutHwnd !== candidate.hwnd || entry.owner?.identity !== identity || entry.owner.pid !== candidate.pid) entry.layout = 'pending'
          entry.hwnd = candidate.hwnd
          entry.owner = { pid: candidate.pid, identity }
          const state: GameCaptureState = { status: 'connected', gameName: candidate.title || 'Minecraft', surfaceKind: 'external-window' }
          this.#emit(entry, state); await this.#observe(entry, bindings); return
        }
        if (roots.length === 0) { this.#emit(entry, { status: 'idle' }); return }
        await delay(POLL_MS, signal)
      }
      this.#emit(entry, { status: 'failed', gameName: 'Minecraft', error: '等待 Minecraft 窗口超时。游戏仍在运行，可使用“重连”再次尝试。' })
    } catch (error) {
      if (!signal.aborted && this.#entries.get(entry.cwd) === entry) this.#emit(entry, { status: 'failed', gameName: 'Minecraft', error: error instanceof Error ? error.message : String(error) })
    }
  }

  async #observe(entry: CaptureEntry, bindings: Win32Bindings): Promise<void> {
    const signal = entry.abort.signal
    while (!signal.aborted && this.#entries.get(entry.cwd) === entry && entry.hwnd !== undefined) {
      if (!this.#hasLiveProcess(entry, bindings)) { this.#emit(entry, { status: 'idle' }); return }
      if (!this.#ownsWindow(entry, bindings)) {
        if (entry.state.status !== 'disconnected') this.#emit(entry, { status: 'disconnected', gameName: 'Minecraft', error: 'Minecraft 窗口已断开，游戏进程仍在运行。' })
        await delay(POLL_MS, signal)
        continue
      }
      const rect = bindings.getWindowRect(entry.hwnd)
      if (rect === undefined) {
        if (entry.state.status !== 'disconnected') this.#emit(entry, { status: 'disconnected', gameName: 'Minecraft', error: '无法读取 Minecraft 窗口位置。' })
        await delay(POLL_MS, signal)
        continue
      }
      const next = this.#snapshot(entry.hwnd, rect, bindings)
      const changed = JSON.stringify(next) !== JSON.stringify(entry.lastWindow)
      entry.stableSamples = next.visible && !next.minimized && !next.fullscreen
        ? (entry.lastWindow !== undefined && JSON.stringify(next) === JSON.stringify(entry.lastWindow) ? entry.stableSamples + 1 : 1) : 0
      entry.lastWindow = next
      if ((changed || entry.layout === 'pending' && entry.stableSamples >= 2) && entry.cwd === this.#selectedCwd) {
        if (!next.visible || next.minimized) {
          if (this.#companion) this.#hideWindow()
        }
        else {
          await this.#refreshCompanion(false, this.#selectionGeneration)
          if (!signal.aborted && entry.cwd === this.#selectedCwd && this.#companion) this.#showInactive()
        }
      }
      await delay(POLL_MS, signal)
    }
  }

  #hasLiveProcess(entry: CaptureEntry, bindings: Win32Bindings): boolean {
    for (const [pid, identity] of entry.knownPids) {
      if (bindings.processIdentity(pid) === identity) return true
    }
    return false
  }

  #connected(cwd: string): CaptureEntry { const entry = this.#entries.get(cwd); if (entry?.state.status !== 'connected' || entry.hwnd === undefined) throw new Error('该项目没有已连接的 Minecraft 窗口。'); return entry }
  #set(cwd: string, state: GameCaptureState): GameCaptureState { this.#publish({ cwd, state }); return state }
  #emit(entry: CaptureEntry, state: GameCaptureState): void { entry.state = state; this.#publish({ cwd: entry.cwd, state }); if (entry.cwd === this.#selectedCwd && (state.status === 'idle' || state.status === 'failed' || state.status === 'disconnected')) void this.#leaveCompanion() }

  async #refreshCompanion(force: boolean, generation = this.#selectionGeneration): Promise<void> {
    const entry = this.#selectedCwd === undefined ? undefined : this.#entries.get(this.#selectedCwd)
    if (generation !== this.#selectionGeneration) return
    if (entry?.state.status !== 'connected' || entry.lastWindow === undefined || !entry.lastWindow.visible || entry.lastWindow.minimized) { await this.#leaveCompanion(); return }
    if (entry.lastWindow.fullscreen || entry.layout === 'arranging') return
    if (entry.layout === 'pending') {
      if (entry.stableSamples < 2) return
      try { await this.#arrange(entry, await this.#bindings(), generation) }
      catch (error) {
        if (generation === this.#selectionGeneration && this.#entries.get(entry.cwd) === entry) {
          entry.layout = 'failed'
          this.#log(`game layout failed cwd=${entry.cwd}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return
    }
    if (entry.layout !== 'following') return
    const game = this.#toDipRect(entry.lastWindow.rect)
    const width = this.#panelWidth(entry)
    const placement = followGameBounds(game, screen.getDisplayMatching(game).workArea, width)
    if (placement === undefined) {
      entry.layout = 'paused'
      this.#log(`game layout paused cwd=${entry.cwd}: no room to the right`)
      return
    }
    entry.panelWidth = placement.width
    await this.#applyPanel(placement, force)
  }

  #panelWidth(entry: CaptureEntry): number {
    if (this.#companion && !this.#window.isDestroyed()) {
      const actual = this.#window.getBounds().width
      if (actual !== this.#appliedPanelBounds?.width) return actual
    }
    return entry.panelWidth ?? MIN_PANEL_WIDTH
  }

  async #applyPanel(bounds: Rectangle, force = false): Promise<void> {
    if (this.#window.isDestroyed()) return
    const generation = this.#selectionGeneration
    if (!this.#companion) {
      this.#restoreMaximizedPending = false
      this.#saved = {
        bounds: this.#window.getNormalBounds(),
        maximized: this.#window.isMaximized(),
        alwaysOnTop: this.#window.isAlwaysOnTop(),
        backgroundThrottling: this.#window.webContents.getBackgroundThrottling(),
        minimumSize: (() => { const size = this.#window.getMinimumSize(); return [size[0] ?? 0, size[1] ?? 0] as [number, number] })(),
      }
      this.#window.setMinimumSize(MIN_PANEL_WIDTH, 0)
      // Companion hide/show must not suspend Chromium's frame scheduling.
      this.#window.webContents.setBackgroundThrottling(false)
      this.#companion = true
    }
    await this.#setHostMaximized(false)
    if (this.#window.isDestroyed() || generation !== this.#selectionGeneration || !this.#companion) return
    const current = this.#window.getBounds()
    if (force || !rectanglesMatch(current, bounds)) {
      this.#window.setBounds({ x: bounds.x, y: bounds.y, height: bounds.height,
        ...(force || current.width !== bounds.width ? { width: bounds.width } : {}) })
    }
    this.#window.setAlwaysOnTop(false)
    this.#appliedPanelBounds = this.#window.getBounds()
    this.#showInactive()
  }

  #ownsWindow(entry: CaptureEntry, bindings: Win32Bindings): boolean {
    return entry.hwnd !== undefined && entry.owner !== undefined && bindings.isWindow(entry.hwnd)
      && bindings.windowPid(entry.hwnd) === entry.owner.pid
      && bindings.processIdentity(entry.owner.pid) === entry.owner.identity
  }

  #snapshot(hwnd: Hwnd, rect: NativeRect, bindings: Win32Bindings): WindowSnapshot {
    const dip = this.#toDipRect(rect)
    return {
      rect, visible: bindings.isWindowVisible(hwnd), minimized: bindings.isWindowMinimized(hwnd),
      fullscreen: !bindings.hasCaption(hwnd) && rectanglesMatch(dip, screen.getDisplayMatching(dip).bounds),
    }
  }

  async #arrange(entry: CaptureEntry, bindings: Win32Bindings, generation: number): Promise<void> {
    if (entry.layout === 'arranging') throw new Error('窗口正在定位，请稍后重试。')
    const signal = entry.abort.signal
    const current = (): boolean => !signal.aborted && this.#entries.get(entry.cwd) === entry
      && generation === this.#selectionGeneration && entry.cwd === this.#selectedCwd && !this.#window.isDestroyed()
    const check = (): Hwnd => {
      if (!current() || !this.#ownsWindow(entry, bindings)) throw new Error('游戏窗口已变化，请重连后重试。')
      const hwnd = entry.hwnd as Hwnd
      const rect = bindings.getWindowRect(hwnd)
      if (rect === undefined) throw new Error('无法读取游戏窗口位置。')
      const snapshot = this.#snapshot(hwnd, rect, bindings)
      if (!snapshot.visible || snapshot.minimized || snapshot.fullscreen) throw new Error('请恢复 Minecraft 普通窗口后重新定位。')
      return hwnd
    }
    let hwnd = check()
    const rect = bindings.getWindowRect(hwnd) as NativeRect
    const layout = initialGameLayout(screen.getDisplayMatching(this.#toDipRect(rect)).workArea)
    if (layout === undefined) { entry.layout = 'paused'; throw new Error('当前屏幕空间不足，无法并排放置两个窗口。') }
    entry.layout = 'arranging'
    try {
      const deadline = Date.now() + POSITION_TIMEOUT_MS
      if (bindings.isWindowMaximized(hwnd)) {
        if (!bindings.restoreWindow(check())) throw new Error('无法还原 Minecraft 窗口。')
        while (bindings.isWindowMaximized(hwnd)) {
          if (Date.now() >= deadline) throw new Error('还原 Minecraft 窗口超时。')
          await delay(50, signal); hwnd = check()
        }
      }
      const target = screen.dipToScreenRect(null, layout.game)
      if (!bindings.positionWindow(check(), { left: target.x, top: target.y, right: target.x + target.width, bottom: target.y + target.height })) throw new Error('无法调整 Minecraft 窗口。')
      while (true) {
        hwnd = check()
        const actual = bindings.getWindowRect(hwnd)
        if (actual !== undefined && rectanglesMatch(rectangle(actual), target)) {
          const game = this.#toDipRect(actual)
          const panel = followGameBounds(game, screen.getDisplayMatching(game).workArea, layout.panel.width)
          if (panel === undefined) throw new Error('Minecraft 窗口调整后没有足够的右侧空间。')
          entry.lastWindow = this.#snapshot(hwnd, actual, bindings)
          entry.layoutHwnd = hwnd
          entry.panelWidth = panel.width
          entry.layout = 'following'
          await this.#applyPanel(panel, true)
          this.#log(`game layout applied cwd=${entry.cwd}`)
          return
        }
        if (Date.now() >= deadline) throw new Error('Minecraft 窗口定位超时，请重试。')
        await delay(50, signal)
      }
    } catch (error) {
      if (current()) entry.layout = 'failed'
      else if (entry.layout === 'arranging') entry.layout = 'pending'
      throw error
    }
  }

  async #leaveCompanion(): Promise<void> {
    if (!this.#companion) return
    this.#companion = false
    this.#appliedPanelBounds = undefined
    const saved = this.#saved; this.#saved = undefined
    if (this.#window.isDestroyed()) return
    this.#window.setAlwaysOnTop(saved?.alwaysOnTop ?? false)
    if (saved !== undefined) {
      this.#window.webContents.setBackgroundThrottling(saved.backgroundThrottling)
      this.#window.setMinimumSize(...saved.minimumSize)
      await this.#setHostMaximized(false)
      if (this.#window.isDestroyed() || this.#companion) return
      this.#window.setBounds(saved.bounds)
      if (saved.maximized && this.#window.isMinimized()) this.#restoreMaximizedPending = true
      else if (saved.maximized) await this.#setHostMaximized(true)
    }
    if (!this.#window.isMinimized() && !this.#userSuppressed) this.#showInactive()
  }

  async #setHostMaximized(maximized: boolean): Promise<void> {
    if (this.#window.isDestroyed() || this.#window.isMaximized() === maximized) return
    // Windows applies restore bounds during the event; later panel bounds must wait for it.
    await new Promise<void>(resolve => {
      const done = (): void => {
        clearTimeout(timeout)
        this.#window.removeListener('maximize', done)
        this.#window.removeListener('unmaximize', done)
        this.#window.removeListener('closed', done)
        resolve()
      }
      const timeout = setTimeout(done, POSITION_TIMEOUT_MS)
      if (maximized) this.#window.once('maximize', done)
      else this.#window.once('unmaximize', done)
      this.#window.once('closed', done)
      if (maximized) this.#window.maximize()
      else this.#window.unmaximize()
    })
    if (!maximized) await new Promise<void>(resolve => setImmediate(resolve))
  }

  #hideWindow(): void {
    if (this.#window.isDestroyed()) return
    this.#visibilityAction = true
    try { this.#window.hide() } finally { this.#visibilityAction = false }
  }

  #showInactive(): void {
    if (this.#window.isDestroyed() || this.#userSuppressed || this.#window.isVisible()) return
    this.#visibilityAction = true
    try { this.#window.showInactive() } finally { this.#visibilityAction = false }
  }

  #toDipRect(rect: NativeRect): Rectangle {
    return screen.screenToDipRect(null, rectangle(rect))
  }

  #bindings(): Promise<Win32Bindings> { this.#bindingsPromise ??= loadBindings(); return this.#bindingsPromise }
}
