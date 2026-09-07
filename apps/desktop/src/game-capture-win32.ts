/* oxlint-disable */
/** Windows Minecraft discovery and CraftCode companion-panel tracking. */
import { desktopCapturer, screen, type BrowserWindow, type Rectangle } from 'electron'
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
interface WindowSnapshot { rect: NativeRect; visible: boolean; minimized: boolean }
interface CaptureEntry {
  cwd: string
  state: GameCaptureState
  knownPids: Map<number, string>
  abort: AbortController
  hwnd?: Hwnd
  lastWindow?: WindowSnapshot
}
interface Win32Bindings {
  processSnapshot(): ProcessEntry[]
  processIdentity(pid: number): string | undefined
  enumerateWindows(): WindowCandidate[]
  isWindow(hwnd: Hwnd): boolean
  getWindowRect(hwnd: Hwnd): NativeRect | undefined
  isWindowVisible(hwnd: Hwnd): boolean
  isWindowMinimized(hwnd: Hwnd): boolean
}

const POLL_MS = 250
const FIND_TIMEOUT_MS = 120_000
const MAX_SNAPSHOT_WIDTH = 1920
const MAX_SNAPSHOT_HEIGHT = 1080
const COMPANION_GAP = 8
const COMPANION_WIDTH = 480
const COMPACT_WIDTH = 420
const COMPACT_HEIGHT = 560

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
  return candidates.filter(candidate => identities.get(candidate.pid) === identityOf(candidate.pid))
    .map(candidate => ({ candidate, score: windowCandidateScore(candidate) })).filter(row => row.score >= 0)
    .sort((left, right) => right.score - left.score)[0]?.candidate
}

/** Place the panel beside the game, falling back to a clipped top-right overlay. */
export function companionBounds(game: Rectangle, workArea: Rectangle, panelWidth = COMPANION_WIDTH): { bounds: Rectangle; mode: 'side' | 'compact' } {
  const height = Math.min(game.height, workArea.height)
  const y = Math.max(workArea.y, Math.min(game.y, workArea.y + workArea.height - height))
  const sideWidth = Math.min(panelWidth, workArea.width)
  const right: Rectangle = { x: game.x + game.width + COMPANION_GAP, y, width: sideWidth, height }
  if (right.x + right.width <= workArea.x + workArea.width) return { bounds: right, mode: 'side' }
  const left: Rectangle = { x: game.x - COMPANION_GAP - sideWidth, y, width: sideWidth, height }
  if (left.x >= workArea.x) return { bounds: left, mode: 'side' }
  const width = Math.min(COMPACT_WIDTH, workArea.width, game.width)
  const compactHeight = Math.min(COMPACT_HEIGHT, workArea.height, game.height)
  return { mode: 'compact', bounds: { x: Math.max(workArea.x, Math.min(game.x + game.width - width, workArea.x + workArea.width - width)), y: Math.max(workArea.y, Math.min(game.y, workArea.y + workArea.height - compactHeight)), width, height: compactHeight } }
}

function nativeRect(buffer: Buffer): NativeRect { return { left: buffer.readInt32LE(0), top: buffer.readInt32LE(4), right: buffer.readInt32LE(8), bottom: buffer.readInt32LE(12) } }
function utf16(buffer: Buffer): string { let end = 0; while (end + 1 < buffer.length && (buffer[end] !== 0 || buffer[end + 1] !== 0)) end += 2; return buffer.toString('utf16le', 0, end) }

async function loadBindings(): Promise<Win32Bindings> {
  const koffi = (await import('koffi')).default as unknown as Koffi
  const kernel32 = koffi.load('kernel32.dll')
  const user32 = koffi.load('user32.dll')
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
  const enumWindows = bind(user32, 'EnumWindows', 'int', ['void *', 'intptr'])
  const getWindowPid = bind(user32, 'GetWindowThreadProcessId', 'uint32', ['void *', 'void *'])
  const isWindow = bind(user32, 'IsWindow', 'int', ['void *'])
  const isVisible = bind(user32, 'IsWindowVisible', 'int', ['void *'])
  const isIconic = bind(user32, 'IsIconic', 'int', ['void *'])
  const getClassName = bind(user32, 'GetClassNameW', 'int', ['void *', 'void *', 'int'])
  const getWindowText = bind(user32, 'GetWindowTextW', 'int', ['void *', 'void *', 'int'])
  const getClientRect = bind(user32, 'GetClientRect', 'int', ['void *', 'void *'])
  const getWindowRect = bind(user32, 'GetWindowRect', 'int', ['void *', 'void *'])
  const enumProto = koffi.proto('int __stdcall CraftCodeEnumWindows(void *hwnd, intptr value)')

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
    getWindowRect: (hwnd) => { const buffer = Buffer.alloc(16); return Number(getWindowRect(hwnd, buffer)) === 0 ? undefined : nativeRect(buffer) },
    isWindowVisible: hwnd => Number(isVisible(hwnd)) !== 0,
    isWindowMinimized: hwnd => Number(isIconic(hwnd)) !== 0,
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
  #saved: { bounds: Rectangle; maximized: boolean; alwaysOnTop: boolean; minimumSize: [number, number] } | undefined
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

  constructor(options: GameCaptureProviderOptions) {
    this.#window = options.window
    this.#publish = options.publish
    this.#log = options.log ?? (() => {})
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
    const entry: CaptureEntry = { cwd, state, knownPids: new Map([[rootPid, identity]]), abort: new AbortController() }
    this.#entries.set(cwd, entry); this.#emit(entry, state); void this.#discover(entry)
    return state
  }

  async reconnect(cwd: string): Promise<GameCaptureState> {
    const entry = this.#entries.get(cwd)
    if (entry === undefined) return { status: 'failed', error: '该项目没有正在运行的游戏进程。' }
    entry.abort.abort(); entry.abort = new AbortController(); delete entry.hwnd; delete entry.lastWindow
    const state: GameCaptureState = { status: 'reconnecting', gameName: 'Minecraft' }
    this.#emit(entry, state); void this.#discover(entry)
    return state
  }

  async select(cwd: string | undefined): Promise<void> {
    this.#selectedCwd = cwd
    const generation = ++this.#selectionGeneration
    await this.#refreshCompanion(true, generation)
  }

  async stop(cwd: string, publish = true): Promise<void> {
    const entry = this.#entries.get(cwd)
    if (entry !== undefined) { entry.abort.abort(); this.#entries.delete(cwd) }
    if (publish) this.#publish({ cwd, state: { status: 'idle' } })
    if (cwd === this.#selectedCwd) await this.#leaveCompanion()
  }

  async beginAnnotation(cwd: string): Promise<GameCaptureSnapshot> {
    const entry = this.#connected(cwd)
    if (this.#selectedCwd !== cwd) throw new Error('只能标注当前项目的 Minecraft 窗口。')
    const snapshot = entry.lastWindow
    if (snapshot === undefined || !snapshot.visible || snapshot.minimized) throw new Error('Minecraft 窗口当前不可见，请先恢复窗口。')
    const hwnd = entry.hwnd as Hwnd
    const width = snapshot.rect.right - snapshot.rect.left; const height = snapshot.rect.bottom - snapshot.rect.top
    const scale = Math.min(1, MAX_SNAPSHOT_WIDTH / width, MAX_SNAPSHOT_HEIGHT / height)
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }, fetchWindowIcons: false })
    const source = sources.find(candidate => { try { return BigInt(candidate.id.split(':')[1] ?? '') === hwnd } catch { return false } })
    if (source === undefined || source.thumbnail.isEmpty()) throw new Error('无法从 Minecraft 窗口获取标注截图，请确认窗口可见后重试。')
    const size = source.thumbnail.getSize()
    this.#log(`annotation captured cwd=${cwd} hwnd=${String(hwnd)}`)
    return { dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(85).toString('base64')}`, width: size.width, height: size.height }
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
          entry.hwnd = candidate.hwnd
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
      if (!bindings.isWindow(entry.hwnd)) {
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
      const next = { rect, visible: bindings.isWindowVisible(entry.hwnd), minimized: bindings.isWindowMinimized(entry.hwnd) }
      const changed = JSON.stringify(next) !== JSON.stringify(entry.lastWindow)
      entry.lastWindow = next
      if (changed && entry.cwd === this.#selectedCwd) {
        if (!next.visible || next.minimized) this.#hideWindow()
        else { await this.#refreshCompanion(false, this.#selectionGeneration); this.#showInactive() }
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
    const game = this.#toDipRect(entry.lastWindow.rect); const placement = companionBounds(game, screen.getDisplayMatching(game).workArea)
    if (generation !== this.#selectionGeneration) return
    if (!this.#companion) {
      this.#restoreMaximizedPending = false
      this.#saved = {
        bounds: this.#window.getBounds(),
        maximized: this.#window.isMaximized(),
        alwaysOnTop: this.#window.isAlwaysOnTop(),
        minimumSize: (() => { const size = this.#window.getMinimumSize(); return [size[0] ?? 0, size[1] ?? 0] as [number, number] })(),
      }
      this.#window.setMinimumSize(0, 0)
      this.#companion = true
    }
    if (generation !== this.#selectionGeneration || this.#window.isDestroyed()) return
    if (this.#window.isMaximized()) this.#window.unmaximize()
    if (force || JSON.stringify(this.#window.getBounds()) !== JSON.stringify(placement.bounds)) this.#window.setBounds(placement.bounds)
    this.#window.setAlwaysOnTop(placement.mode === 'compact' ? true : this.#saved?.alwaysOnTop ?? false)
    this.#showInactive()
  }

  async #leaveCompanion(): Promise<void> {
    if (!this.#companion) return
    this.#companion = false
    const saved = this.#saved; this.#saved = undefined
    if (this.#window.isDestroyed()) return
    this.#window.setAlwaysOnTop(saved?.alwaysOnTop ?? false)
    if (saved !== undefined) {
      this.#window.setMinimumSize(...saved.minimumSize)
      if (saved.maximized && this.#window.isMinimized()) this.#restoreMaximizedPending = true
      else if (saved.maximized) this.#window.maximize()
      else {
        if (this.#window.isMaximized()) this.#window.unmaximize()
        this.#window.setBounds(saved.bounds)
      }
    }
    if (!this.#window.isMinimized() && !this.#userSuppressed) this.#showInactive()
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
    const cx = (rect.left + rect.right) / 2; const cy = (rect.top + rect.bottom) / 2
    const display = screen.getAllDisplays().find(candidate => { const scale = candidate.scaleFactor; const left = candidate.bounds.x * scale; const top = candidate.bounds.y * scale; return cx >= left && cx <= left + candidate.bounds.width * scale && cy >= top && cy <= top + candidate.bounds.height * scale }) ?? screen.getPrimaryDisplay()
    const scale = display.scaleFactor
    return { x: display.bounds.x + (rect.left - display.bounds.x * scale) / scale, y: display.bounds.y + (rect.top - display.bounds.y * scale) / scale, width: (rect.right - rect.left) / scale, height: (rect.bottom - rect.top) / scale }
  }

  #bindings(): Promise<Win32Bindings> { this.#bindingsPromise ??= loadBindings(); return this.#bindingsPromise }
}
