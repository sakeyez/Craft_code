/** State machine for the host-local New Mod wizard. */

import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  BootstrapLoader, BootstrapStartRequest, CatalogEntry, CatalogSnapshot, OperationSnapshot,
} from '@deepseek-ai/dsh-tool-mc-bootstrap/src/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

// Keep the browser bundle independent from the host bootstrap package.  These
// tiny wire guards intentionally mirror the host contract but are local
// value code: importing a host package, even only for validators, would make
// the client bundle depend on Node APIs and violate the browser purity gate.
function recordPayload(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value)
}

function jdkForMinecraft(version: string): 17 | 21 | undefined {
  const match = /^1\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/u.exec(version.trim())
  if (match === null) return undefined
  const minor = Number(match[1])
  const patch = match[2] === undefined ? undefined : Number(match[2])
  if (minor === 21 && (patch === undefined || patch >= 0)) return 21
  if (patch === undefined) return undefined
  if (minor === 20 && patch >= 1 && patch <= 4) return 17
  if (minor === 20 && patch >= 5) return 21
  return undefined
}

function isSupportedMinecraftVersion(version: string): boolean {
  const normalized = version.trim()
  return jdkForMinecraft(normalized) !== undefined
    && (/^1\.20\.\d+$/u.test(normalized) || /^1\.21(?:\.\d+)?$/u.test(normalized))
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  const row = recordPayload(value)
  if (row === undefined || (row.loader !== 'fabric' && row.loader !== 'neoforge')) return false
  const minecraftVersion = row.minecraftVersion
  const loaderVersion = row.loaderVersion
  const mappingsVersion = row.mappingsVersion
  const apiVersion = row.apiVersion
  const pluginVersion = row.pluginVersion
  const gradleVersion = row.gradleVersion
  if (typeof row.entryId !== 'string' || typeof minecraftVersion !== 'string'
    || typeof loaderVersion !== 'string' || typeof mappingsVersion !== 'string'
    || typeof apiVersion !== 'string' || typeof pluginVersion !== 'string'
    || typeof gradleVersion !== 'string') return false
  if (row.requiredJdk !== 17 && row.requiredJdk !== 21 || row.stable !== true) return false
  if (!isSupportedMinecraftVersion(minecraftVersion) || !/^\d+(?:\.\d+){1,3}$/u.test(loaderVersion)) return false
  // NeoForge has no published 1.20.1 MDK line. Keep the browser wire guard
  // aligned with the host validator so stale/tampered snapshots cannot expose
  // an inferred target before the user submits a build.
  if (row.loader === 'neoforge' && minecraftVersion.trim() === '1.20.1') return false
  if (!/^\d+(?:\.\d+){1,3}$/u.test(pluginVersion) || !/^\d+(?:\.\d+){1,3}$/u.test(gradleVersion)) return false
  if (row.loader === 'fabric') {
    const yarnBuild = /^1\.\d+(?:\.\d+)?\+build\.\d+$/u.test(mappingsVersion)
    if (!yarnBuild || !/^\d+(?:\.\d+){1,3}\+1\.2[01](?:\.\d+)?$/u.test(apiVersion)) return false
  } else if (mappingsVersion !== 'official' || apiVersion !== 'neoforge') return false
  if (!isSha256(row.gradleSha256) || !isSha256(row.wrapperSha256)) return false
  if (row.entryId !== `${row.loader}:${minecraftVersion}:${loaderVersion}`) return false
  return true
}

function isValidModId(value: string): boolean { return /^[a-z][a-z0-9_]{0,63}$/u.test(value) }
const JAVA_RESERVED_WORDS = new Set([
  '_', 'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short',
  'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
])
function isValidPackageName(value: string): boolean {
  const segments = value.split('.')
  return segments.length >= 2
    && segments.every(segment => /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(segment)
      && !JAVA_RESERVED_WORDS.has(segment)
      && !['java', 'javax', 'sun'].includes(segment))
}
function isValidModName(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(trimmed)
}
function isValidDirectoryName(value: string): boolean {
  return value.length > 0 && value.length <= 96 && value !== '.' && value !== '..'
    && !(/[\\/\u0000]/u.test(value)) && !(/[<>:"|?*]/u.test(value))
    && !(/[ .]$/u.test(value)) && !(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value))
}
function deriveDirectoryName(modName: string, modId: string): string {
  const ascii = modName.trim().normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80)
  const candidate = ascii || modId
  return isValidDirectoryName(candidate) ? candidate : modId
}

const CHANNEL = '/mc-bootstrap'
const POLL_MS = 300

export interface WizardForm {
  modName: string
  loader: BootstrapLoader
  entryId: string
  parentDirectory: string
  directoryName: string
  modId: string
  packageName: string
}

export interface WizardSnapshot {
  open: boolean
  loadingCatalog: boolean
  catalog: CatalogSnapshot | undefined
  advanced: boolean
  form: WizardForm
  status: OperationSnapshot | undefined
  operationId: string | undefined
  submitting: boolean
  pickingParent: boolean
  error: string | undefined
  registrationError: string | undefined
}

/** Registration-side capability face shared by the sidebar action and overlay. */
export interface BootstrapWizardInjected {
  hooks: { wizard: HostObservable<WizardSnapshot> }
  open: () => void
  close: () => void
  toggleAdvanced: () => void
  setModName: (value: string) => void
  setLoader: (value: BootstrapLoader) => void
  setEntry: (value: string) => void
  setParentDirectory: (value: string) => void
  setDirectoryName: (value: string) => void
  setModId: (value: string) => void
  setPackageName: (value: string) => void
  chooseParent: () => Promise<void>
  refreshCatalog: () => Promise<void>
  start: () => Promise<void>
  retry: () => Promise<void>
  cancel: () => Promise<void>
  openDirectory: () => Promise<void>
}

function defaultForm(parentDirectory = ''): WizardForm {
  return {
    modName: '', loader: 'fabric', entryId: '', parentDirectory,
    directoryName: 'my-mod', modId: 'my_mod', packageName: 'com.example.my_mod',
  }
}

/**
 * Browser-side controller. It owns no filesystem or process capability: all
 * writes and builds are delegated to the loopback Connection channel.
 */
export class BootstrapWizardModel {
  private snapshot: WizardSnapshot
  private readonly listeners = new Set<() => void>()
  private catalogRequest = 0
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private pollGeneration = 0
  private modIdTouched = false
  private packageTouched = false
  private directoryTouched = false
  private handledTerminalOperation: string | undefined

  constructor(
    private readonly rpc: ClientConnectionRpc,
    private readonly workspaces: IWorkspaces,
    parentDirectory = '',
  ) {
    this.snapshot = {
      open: false, loadingCatalog: false, catalog: undefined, advanced: false,
      form: defaultForm(parentDirectory), status: undefined, operationId: undefined,
      submitting: false, pickingParent: false, error: undefined, registrationError: undefined,
    }
  }

  getSnapshot = (): WizardSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    this.pollGeneration += 1
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.pollTimer = undefined
    this.listeners.clear()
  }

  open(): void {
    if (this.snapshot.open) return
    // A completed/cancelled attempt is a historical result, not the next
    // wizard run. Keep the user's form edits, but clear the operation so a
    // fresh click cannot accidentally re-register or retry an old project.
    const reset = this.snapshot.status !== undefined && !this.isBusy()
      ? { status: undefined, operationId: undefined, submitting: false, registrationError: undefined }
      : {}
    this.patch({ open: true, error: undefined, ...reset })
    void this.refreshCatalog()
  }

  close(): void {
    if (this.isBusy()) return
    this.patch({ open: false })
  }

  toggleAdvanced(): void { this.patch({ advanced: !this.snapshot.advanced }) }

  setModName(modName: string): void {
    const form = { ...this.snapshot.form, modName }
    if (!this.modIdTouched) {
      form.modId = slugModId(modName)
      if (!this.packageTouched) form.packageName = `com.example.${form.modId}`
    }
    if (!this.directoryTouched) form.directoryName = deriveDirectoryName(modName, form.modId)
    this.patch({ form })
  }

  setLoader(loader: BootstrapLoader): void {
    const entries = this.snapshot.catalog?.entries ?? []
    const version = entries.find(candidate => candidate.entryId === this.snapshot.form.entryId)?.minecraftVersion
    const entry = entries.find(candidate => candidate.loader === loader && candidate.minecraftVersion === version)
      ?? entries.find(candidate => candidate.loader === loader)
    this.patch({
      form: {
        ...this.snapshot.form,
        loader,
        entryId: entry?.entryId ?? '',
      },
    })
  }

  setEntry(entryId: string): void { this.patch({ form: { ...this.snapshot.form, entryId } }) }

  setParentDirectory(parentDirectory: string): void {
    this.patch({ form: { ...this.snapshot.form, parentDirectory } })
  }

  setDirectoryName(directoryName: string): void {
    this.directoryTouched = true
    this.patch({ form: { ...this.snapshot.form, directoryName } })
  }

  setModId(modId: string): void {
    this.modIdTouched = true
    const form = { ...this.snapshot.form, modId }
    if (!this.packageTouched) form.packageName = `com.example.${modId}`
    if (!this.directoryTouched && this.snapshot.form.modName.trim() === '') form.directoryName = deriveDirectoryName('', modId)
    this.patch({ form })
  }

  setPackageName(packageName: string): void {
    this.packageTouched = true
    this.patch({ form: { ...this.snapshot.form, packageName } })
  }

  async chooseParent(): Promise<void> {
    if (this.snapshot.pickingParent || this.isBusy()) return
    this.patch({ pickingParent: true, error: undefined })
    try {
      const path = await this.workspaces.pickDirectory()
      if (path !== null) this.setParentDirectory(path)
    } catch (error) {
      this.patch({ error: messageOf(error) })
    } finally {
      this.patch({ pickingParent: false })
    }
  }

  async refreshCatalog(): Promise<void> {
    const request = ++this.catalogRequest
    this.patch({ loadingCatalog: true, error: undefined })
    try {
      if (!this.snapshot.catalog) {
        const cached = await this.rpc.call(CHANNEL, 'catalog-cache', {}).catch(() => undefined)
        if (request !== this.catalogRequest) return
        if (cached?.ok && cached.value !== null) {
          let catalog: CatalogSnapshot | undefined
          try { catalog = parseCatalog(cached.value) } catch { /* A malformed cache cannot block an online refresh. */ }
          if (catalog) {
            const current = this.snapshot.form
            const selected = catalog.entries.find(entry => entry.entryId === current.entryId && entry.loader === current.loader)
            ?? catalog.entries.find(entry => entry.loader === current.loader)
            this.patch({ catalog, ...(selected ? { form: { ...current, entryId: selected.entryId } } : {}) })
          }
        }
      }
      const result = await this.rpc.call(CHANNEL, 'catalog', {})
      if (!result.ok) throw new Error(result.error.message)
      const catalog = parseCatalog(result.value)
      if (request !== this.catalogRequest) return
      const catalogError = catalog.entries.length === 0
        ? (catalog.error ?? '没有可用的 Minecraft 版本，请重试。')
        : catalog.error
      const previousVersion = this.snapshot.catalog?.entries.find(entry => entry.entryId === this.snapshot.form.entryId)?.minecraftVersion
      this.patch({ catalog, loadingCatalog: false, error: catalogError })
      const current = this.snapshot.form
      const selected = catalog.entries.find(entry => entry.entryId === current.entryId && entry.loader === current.loader)
        ?? catalog.entries.find(entry => entry.loader === current.loader && entry.minecraftVersion === previousVersion)
        ?? catalog.entries.find(entry => entry.loader === current.loader)
      if (selected !== undefined) this.patch({ form: { ...this.snapshot.form, entryId: selected.entryId } })
    } catch (error) {
      if (request !== this.catalogRequest) return
      this.patch({ loadingCatalog: false, error: messageOf(error) })
    }
  }

  async start(): Promise<void> {
    if (this.snapshot.submitting || this.isBusy()) return
    const validation = this.validate()
    if (validation !== undefined) {
      this.patch({ error: validation })
      return
    }
    const { entryId, parentDirectory, directoryName, modName, modId, packageName } = this.snapshot.form
    const request: BootstrapStartRequest = { entryId, parentDirectory, directoryName, modName, modId, packageName }
    this.handledTerminalOperation = undefined
    this.patch({ submitting: true, status: undefined, operationId: undefined, error: undefined, registrationError: undefined })
    try {
      const result = await this.rpc.call(CHANNEL, 'start', request)
      if (!result.ok) throw new Error(result.error.message)
      const row = recordPayload(result.value)
      if (row === undefined || typeof row.operationId !== 'string' || row.operationId.length === 0) {
        throw new Error('宿主返回了无效的搭建操作编号')
      }
      this.patch({ submitting: false, operationId: row.operationId })
      this.beginPolling(row.operationId)
    } catch (error) {
      this.patch({ submitting: false, error: messageOf(error) })
    }
  }

  async retry(): Promise<void> {
    if (this.snapshot.status?.status === 'ready' && this.snapshot.status.projectPath !== undefined) {
      await this.registerWorkspace(this.snapshot.status.projectPath)
      return
    }
    await this.start()
  }

  async cancel(): Promise<void> {
    const operationId = this.snapshot.operationId
    if (operationId === undefined || !this.isBusy()) return
    try {
      const result = await this.rpc.call(CHANNEL, 'cancel', { operationId })
      if (!result.ok) throw new Error(result.error.message)
      const row = recordPayload(result.value)?.snapshot
      const status = parseOperation(row)
      if (status !== undefined) this.acceptStatus(status)
    } catch (error) {
      this.patch({ error: messageOf(error) })
    }
  }

  async openDirectory(): Promise<void> {
    const path = this.snapshot.status?.projectPath
    if (path === undefined) return
    try {
      await this.workspaces.openPath(path)
    } catch (error) {
      this.patch({ error: messageOf(error) })
    }
  }

  /** Apply a forwarded host progress event; polling remains the reconnect fallback. */
  acceptProgress(value: unknown): void {
    const status = parseOperation(value)
    // Host events are a shared stream. Never let an unrelated operation (or a
    // stale event received before start returned) create a workspace/session.
    if (status !== undefined && this.snapshot.operationId === status.operationId) this.acceptStatus(status)
  }

  private validate(): string | undefined {
    const { form, catalog } = this.snapshot
    if (!isValidModName(form.modName) || form.parentDirectory.trim() === '' || form.directoryName.trim() === '') return '请填写模组名称、保存位置和项目目录。'
    if (!isValidDirectoryName(form.directoryName)) return '项目目录名必须是单个安全路径段。'
    if (!isValidModId(form.modId)) return 'modId 只能使用小写字母、数字和下划线。'
    if (!isValidPackageName(form.packageName)) return '请输入有效的 Java 包名。'
    if (catalog?.entries.find(entry => entry.entryId === form.entryId && entry.loader === form.loader) === undefined) return '请选择可用的 Minecraft 版本。'
    return undefined
  }

  private isBusy(): boolean {
    return this.snapshot.submitting || this.snapshot.status?.status === 'queued' || this.snapshot.status?.status === 'running'
  }

  private beginPolling(operationId: string): void {
    this.pollGeneration += 1
    const generation = this.pollGeneration
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    const poll = async (): Promise<void> => {
      if (generation !== this.pollGeneration) return
      try {
        const result = await this.rpc.call(CHANNEL, 'status', { operationId })
        if (!result.ok) throw new Error(result.error.message)
        const status = parseOperation(result.value)
        if (status === undefined) throw new Error('宿主返回了无效的搭建状态')
        this.acceptStatus(status)
        if (status.status === 'queued' || status.status === 'running') {
          this.pollTimer = setTimeout(() => { void poll() }, POLL_MS)
        }
      } catch (error) {
        if (generation !== this.pollGeneration) return
        this.patch({ error: messageOf(error) })
        this.pollTimer = setTimeout(() => { void poll() }, POLL_MS * 2)
      }
    }
    void poll()
  }

  private acceptStatus(status: OperationSnapshot): void {
    if (this.snapshot.operationId !== undefined && status.operationId !== this.snapshot.operationId) return
    this.patch({ status, operationId: status.operationId, submitting: false })
    if (status.status === 'ready' && this.handledTerminalOperation !== status.operationId) {
      this.handledTerminalOperation = status.operationId
      if (status.projectPath !== undefined) void this.registerWorkspace(status.projectPath)
    }
  }

  private async registerWorkspace(path: string): Promise<void> {
    this.patch({ registrationError: undefined, error: undefined })
    try {
      const workspace = await this.workspaces.create({ path })
      this.workspaces.startSession(workspace.workspaceId)
      this.patch({ open: false, registrationError: undefined })
    } catch (error) {
      this.patch({ registrationError: messageOf(error) })
    }
  }

  private patch(patch: Partial<WizardSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) {
      try { listener() } catch { /* a view listener must not stop host progress */ }
    }
  }
}

function slugModId(value: string): string {
  const slug = value.trim().toLowerCase()
    .normalize('NFKD').replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 60)
  return isValidModId(slug) ? slug : 'my_mod'
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function parseCatalog(value: unknown): CatalogSnapshot {
  const row = recordPayload(value)
  const entries = row?.entries
  const validEntries = Array.isArray(entries) ? entries.filter(isCatalogEntry) : []
  const javaRow = recordPayload(row?.java)
  const java = {
    available: javaRow?.available === true,
    ...(typeof javaRow?.version === 'number' ? { version: javaRow.version } : {}),
    ...(typeof javaRow?.executable === 'string' ? { executable: javaRow.executable } : {}),
    ...(typeof javaRow?.message === 'string' ? { message: javaRow.message } : {}),
  }
  return {
    entries: validEntries,
    cached: row?.cached === true,
    stale: row?.stale === true,
    java,
    ...(typeof row?.fetchedAt === 'string' ? { fetchedAt: row.fetchedAt } : {}),
    ...(typeof row?.error === 'string' ? { error: row.error } : {}),
  }
}

function parseOperation(value: unknown): OperationSnapshot | undefined {
  const row = recordPayload(value)
  if (row === undefined || typeof row.operationId !== 'string' || typeof row.status !== 'string'
    || !['queued', 'running', 'ready', 'failed', 'cancelled'].includes(row.status)
    || typeof row.stage !== 'string' || !['validate', 'java', 'generate', 'gradle-download', 'dependencies', 'build', 'finalize', 'done'].includes(row.stage)
    || typeof row.progress !== 'number' || typeof row.logTail !== 'string' || typeof row.updatedAt !== 'string') return undefined
  const snapshot: OperationSnapshot = {
    operationId: row.operationId,
    status: row.status as OperationSnapshot['status'],
    stage: row.stage as OperationSnapshot['stage'],
    progress: Math.max(0, Math.min(100, row.progress)),
    logTail: row.logTail.slice(-32 * 1024),
    updatedAt: row.updatedAt,
    ...(typeof row.projectPath === 'string' ? { projectPath: row.projectPath } : {}),
    ...(isCatalogEntry(row.entry) ? { entry: row.entry } : {}),
    ...(typeof row.failureCode === 'string' ? { failureCode: row.failureCode } : {}),
    ...(typeof row.message === 'string' ? { message: row.message } : {}),
  }
  return snapshot
}
