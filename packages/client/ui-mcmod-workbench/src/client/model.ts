/** Observable workbench state. Host snapshots own business facts; documents retain local drafts. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { parseWorkbenchResponse } from '@deepseek-ai/dsh-mc-workbench/contracts'
import type {
  DependencyPlan,
  DependencySource,
  DependencyRole,
  FileEntry,
  LogChunk,
  ModSearchResult,
  ModVersion,
  RunAction,
  RunOptions,
  ApiQueryResult,
  ResourcePreview,
  ProjectCheckpoint,
  RestorePreview,
  RunSnapshot,
  SearchHit,
  SourceSnapshot,
  TextFile,
  WorkbenchSnapshot,
} from '@deepseek-ai/dsh-mc-workbench/types'

/**
 * An open disk or source document with a separate unsaved draft.
 */
export interface Document extends TextFile {
  preview?: ResourcePreview | undefined
  key: string
  draft: string
  sourceId?: string
  provenance?: string
  original?: string | undefined
  line?: number
}
/**
 * Project viewing state and the latest host facts exposed to workbench slots.
 */
export interface WorkbenchState {
  dialog?: 'recovery' | 'about' | undefined
  checkpoints?: ProjectCheckpoint[] | undefined
  restore?: RestorePreview | undefined
  api?: ApiQueryResult | undefined
  cwd: string
  loading: boolean
  error?: string | undefined
  data?: WorkbenchSnapshot | undefined
  runs: RunSnapshot[]
  runId?: string | undefined
  log: string
  cursor: number
  entries: FileEntry[]
  directory: string
  documents: Document[]
  documentKey?: string | undefined
  hits: SearchHit[]
  mods: ModSearchResult[]
  versions: ModVersion[]
  plan?: DependencyPlan | undefined
  source?: SourceSnapshot | undefined
  sourceId?: string | undefined
  busy: boolean
}
const initial = (cwd: string): WorkbenchState => ({
  cwd,
  loading: true,
  runs: [],
  log: '',
  cursor: 0,
  entries: [],
  directory: '',
  documents: [],
  hits: [],
  mods: [],
  versions: [],
  busy: false,
})

/**
 * Retains per-project drafts and log cursors while consuming host operation snapshots.
 */
export class WorkbenchModel implements HostObservable<WorkbenchState> {
  private snapshot = initial('')
  private readonly projects = new Map<string, WorkbenchState>()
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  constructor(private readonly rpc: ClientConnectionRpc) {}
  private project(cwd: string): WorkbenchState {
    const state = this.projects.get(cwd)
    if (!state) throw new Error('项目尚未打开。')
    return state
  }
  getSnapshot = (): WorkbenchState => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private patch(cwd: string, patch: Partial<WorkbenchState>): void {
    const state = { ...(this.projects.get(cwd) ?? initial(cwd)), ...patch }
    this.projects.set(cwd, state)
    if (this.snapshot.cwd === cwd) {
      this.snapshot = state
      for (const listener of this.listeners) listener()
    }
  }
  private async request<T>(cwd: string, method: string, payload: Record<string, unknown> = {}): Promise<T> {
    const result = await this.rpc.call('/mc-workbench', method, { cwd, ...payload })
    if (!result.ok) throw new Error(result.error.message)
    return parseWorkbenchResponse(method, result.value) as T
  }
  /**
   * Select a project and resume its retained drafts and host polling.
   * @param cwd - Absolute project directory.
   */
  activate(cwd: string): void {
    if (cwd === this.snapshot.cwd) return
    this.snapshot = this.projects.get(cwd) ?? initial(cwd)
    this.projects.set(cwd, this.snapshot)
    for (const listener of this.listeners) listener()
    void this.refresh(cwd)
    void this.directory('', undefined, cwd)
    this.schedule()
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.poll().finally(() => {
        if (!this.disposed) this.schedule()
      })
    }, 700)
  }
  private async poll(): Promise<void> {
    const cwd = this.snapshot.cwd
    if (!cwd) return
    try {
      const runs = await this.request<RunSnapshot[]>(cwd, 'runs')
      if (!Array.isArray(runs)) throw new Error('运行状态响应无效。')
      this.patch(cwd, { runs })
      let state = this.project(cwd)
      if (!state.runId && runs[0]) {
        this.patch(cwd, { runId: runs[0].id })
        state = this.project(cwd)
      }
      if (state.runId) {
        const id = state.runId
        const chunk = await this.request<LogChunk>(cwd, 'logs', { id, cursor: state.cursor })
        if (typeof chunk.text !== 'string' || !Number.isSafeInteger(chunk.cursor))
          throw new Error('日志响应无效。')
        const current = this.project(cwd)
        if (current.runId === id && current.cursor === state.cursor)
          this.patch(cwd, { log: (current.log + chunk.text).slice(-256_000), cursor: chunk.cursor })
      }
      if (state.source?.status === 'running') {
        const source = await this.request<SourceSnapshot>(cwd, 'source-status', { id: state.source.id })
        this.patch(cwd, { source })
        if (source.status === 'ready') await this.directory('', source.id, cwd)
      }
    } catch (error) {
      this.patch(cwd, { error: message(error) })
    }
  }
  /**
   * Replace project facts from an authoritative host snapshot.
   * @param cwd - Absolute project directory.
   */
  async refresh(cwd = this.snapshot.cwd): Promise<void> {
    await this.perform(cwd, async () => {
      const data = await this.request<Partial<WorkbenchSnapshot>>(cwd, 'snapshot')
      if (
        !data.facts?.project ||
        !Array.isArray(data.runs) ||
        !Array.isArray(data.dependencies?.dependencies)
      )
        throw new Error('项目状态响应无效。')
      this.patch(cwd, { data: data as WorkbenchSnapshot, runs: data.runs, loading: false })
    })
  }
  private async perform(cwd: string, action: () => Promise<void>): Promise<void> {
    this.patch(cwd, { busy: true, error: undefined })
    try {
      await action()
    } catch (error) {
      this.patch(cwd, { error: message(error), loading: false })
    } finally {
      this.patch(cwd, { busy: false })
    }
  }

  /**
   * Start the selected host operation and retain its log cursor across navigation.
   * @param action - Development operation.
   * @param options - Test mode, dependency selection and offline preference.
   */
  async start(action: RunAction, options: RunOptions = {}): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      const run = await this.request<RunSnapshot>(cwd, 'start', { action, ...options })
      this.patch(cwd, { runs: [run, ...this.project(cwd).runs], runId: run.id, cursor: 0, log: '' })
    })
  }
  /**
   * Retry a retained task with fresh project facts and verified cache contents.
   * @param id - Identity returned by the owning operation.
   */
  async retry(id: string): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      const run = await this.request<RunSnapshot>(cwd, 'retry', { id })
      this.patch(cwd, { runs: [run, ...this.project(cwd).runs], runId: run.id, cursor: 0, log: '' })
    })
  }
  /**
   * Stop the active project operation through its host owner.
   */
  async stop(): Promise<void> {
    const { cwd, runs } = this.snapshot
    const run = runs.find(row => !terminal(row))
    if (run)
      await this.perform(cwd, async () => {
        await this.request(cwd, 'stop', { id: run.id })
      })
  }
  /**
   * Select a retained run and restart its log cursor.
   * @param id - Identifier returned by the owning operation.
   */
  selectRun(id: string): void {
    this.patch(this.snapshot.cwd, { runId: id, cursor: 0, log: '' })
  }
  /**
   * Read the complete selected log up to the browser export limit.
   * @returns Read the complete selected log up to the browser export limit.
   */
  async exportLogs(): Promise<string> {
    const { cwd, runId } = this.snapshot
    if (!runId) return ''
    let cursor = 0
    let text = ''
    for (;;) {
      const part = await this.request<LogChunk>(cwd, 'logs', { id: runId, cursor })
      text += part.text
      cursor = part.cursor
      if (part.complete) return text
      if (text.length > 64 * 1024 * 1024) throw new Error('日志超过导出限制，请打开原始日志文件。')
    }
  }
  /**
   * Record explicit EULA acceptance without restarting the server.
   * @param path - Workspace-relative path within the selected project or source root.
   */
  async eula(path: string): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      await this.request(cwd, 'eula', { path })
      await this.refresh(cwd)
    })
  }
  /**
   * List a project or read-only source directory.
   * @param path - Workspace-relative path within the selected project or source root.
   * @param sourceId - Optional read-only source operation identifier.
   * @param cwd - Absolute project directory.
   */
  async directory(path: string, sourceId?: string, cwd = this.snapshot.cwd): Promise<void> {
    await this.perform(cwd, async () => {
      const entries = await this.request<FileEntry[]>(cwd, sourceId ? 'source-files' : 'files', {
        path,
        ...(sourceId ? { id: sourceId } : {}),
      })
      if (!Array.isArray(entries)) throw new Error('文件列表响应无效。')
      this.patch(cwd, { entries, directory: path, sourceId })
    })
  }
  /**
   * Open a bounded text file while retaining any existing draft.
   * @param path - Workspace-relative path within the selected project or source root.
   * @param line - Optional one-based line to reveal.
   */
  async open(path: string, line?: number): Promise<void> {
    const { cwd, sourceId, source } = this.snapshot
    const key = `${sourceId ?? 'project'}:${path}`
    const prior = this.snapshot.documents.find(row => row.key === key)
    if (prior) {
      this.patch(cwd, { documentKey: key })
      return
    }
    await this.perform(cwd, async () => {
      if (!sourceId && path.endsWith('.png')) {
        const preview = await this.request<ResourcePreview>(cwd, 'resource-preview', { path })
        this.patch(cwd, { documents: [...this.project(cwd).documents, { key, path, text: '', draft: '', revision: preview.revision, readonly: true, preview }], documentKey: key })
        return
      }
      const file = await this.request<TextFile>(cwd, sourceId ? 'source-read' : 'read', {
        path,
        ...(sourceId ? { id: sourceId } : {}),
      })
      if (typeof file.text !== 'string' || typeof file.revision !== 'string')
        throw new Error('文件内容响应无效。')
      this.patch(cwd, {
        documents: [
          ...this.project(cwd).documents,
          {
            ...file,
            key,
            draft: file.text,
            ...(sourceId ? { sourceId, provenance: source?.provenance ?? '源码来源未知' } : {}),
            ...(line ? { line } : {}),
          },
        ],
        documentKey: key,
      })
    })
  }
  /** Resolve the current draft without writing disk content. */
  async previewResource(): Promise<void> {
    const { cwd, documentKey, documents } = this.snapshot
    const doc = documents.find(row => row.key === documentKey)
    if (!doc || doc.sourceId) return
    await this.perform(cwd, async () => {
      const preview = await this.request<ResourcePreview>(cwd, 'resource-preview', { path: doc.path, ...(doc.path.endsWith('.json') ? { draft: doc.draft } : {}) })
      this.patch(cwd, { documents: this.project(cwd).documents.map(row => row.key === doc.key ? { ...row, preview } : row) })
    })
  }
  /**
   * Execute an explicit read-only API query.
   * @param symbol - Fully qualified class name in the project namespace.
   */
  async queryApi(symbol: string): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => { this.patch(cwd, { api: await this.request<ApiQueryResult>(cwd, 'api-query', { symbol }) }) })
  }
  /**
   * Open a project recovery or application license dialog without model context.
   * @param dialog - Project recovery or application license dialog.
   */
  async openDialog(dialog: 'recovery' | 'about'): Promise<void> {
    const cwd = this.snapshot.cwd
    this.patch(cwd, { dialog, restore: undefined })
    if (dialog === 'recovery') await this.perform(cwd, async () => { this.patch(cwd, { checkpoints: await this.request<ProjectCheckpoint[]>(cwd, 'checkpoints') }) })
  }
  /** Close the transient project menu dialog. */
  closeDialog(): void { this.patch(this.snapshot.cwd, { dialog: undefined, restore: undefined }) }
  /**
   * Run a manual checkpoint action and refresh only committed state.
   * @param action - Requested checkpoint list mutation or restore operation.
   * @param id - Identity returned by the owning operation.
   */
  async checkpoint(action: 'create' | 'preview' | 'restore' | 'delete', id?: string): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      if (action === 'preview') { this.patch(cwd, { restore: await this.request<RestorePreview>(cwd, 'checkpoint-preview', { id }) }); return }
      await this.request(cwd, `checkpoint-${action}`, { id, ...(action === 'restore' ? { fingerprint: this.snapshot.restore?.fingerprint } : {}) })
      this.patch(cwd, { restore: undefined, checkpoints: await this.request<ProjectCheckpoint[]>(cwd, 'checkpoints') })
      if (action === 'restore') await this.refresh(cwd)
    })
  }
  /**
   * Select an existing document without changing its draft.
   * @param key - Open-document identity, including its source origin.
   */
  selectDocument(key: string): void {
    this.patch(this.snapshot.cwd, { documentKey: key })
  }
  /**
   * Remove a document after the UI resolves any discard decision.
   * @param key - Open-document identity, including its source origin.
   */
  closeDocument(key: string): void {
    const { cwd, documents, documentKey } = this.snapshot
    const remaining = documents.filter(doc => doc.key !== key)
    this.patch(cwd, {
      documents: remaining,
      documentKey: documentKey === key ? remaining.at(-1)?.key : documentKey,
    })
  }
  /**
   * Replace the selected draft with the current disk version.
   */
  async reloadDocument(): Promise<void> {
    const { cwd, documents, documentKey } = this.snapshot
    const doc = documents.find(row => row.key === documentKey)
    if (!doc || doc.readonly) return
    await this.perform(cwd, async () => {
      const file = await this.request<TextFile>(cwd, 'read', { path: doc.path })
      this.patch(cwd, {
        documents: this.project(cwd).documents.map(row =>
          row.key === doc.key ? { ...row, ...file, draft: file.text, original: undefined } : row,
        ),
      })
    })
  }
  /**
   * Update the selected document draft without writing disk content.
   * @param key - Open-document identity, including its source origin.
   * @param draft - Unsaved editor content.
   */
  edit(key: string, draft: string): void {
    const { cwd, documents } = this.snapshot
    this.patch(cwd, { documents: documents.map(row => (row.key === key ? { ...row, draft, preview: undefined } : row)) })
  }
  /**
   * Save the captured draft only if the host disk revision still matches.
   */
  async save(): Promise<void> {
    const { cwd, documentKey, documents } = this.snapshot
    const doc = documents.find(row => row.key === documentKey)
    if (!doc || doc.readonly) return
    await this.perform(cwd, async () => {
      const file = await this.request<TextFile>(cwd, 'save', {
        path: doc.path,
        text: doc.draft,
        revision: doc.revision,
      })
      this.patch(cwd, {
        documents: this.project(cwd).documents.map(row =>
          row.key === doc.key ? { ...row, ...file, original: undefined } : row,
        ),
      })
    })
  }
  /**
   * Choose disk, Git HEAD or ordinary editing as the comparison view.
   * @param mode - Requested runtime side or comparison mode.
   */
  async diff(mode: 'disk' | 'head' | 'off'): Promise<void> {
    const { cwd, documentKey, documents } = this.snapshot
    const doc = documents.find(row => row.key === documentKey)
    if (!doc) return
    await this.perform(cwd, async () => {
      const original =
        mode === 'off'
          ? undefined
          : mode === 'head'
            ? await this.request<string>(cwd, 'head', { path: doc.path })
            : (await this.request<TextFile>(cwd, 'read', { path: doc.path })).text
      this.patch(cwd, {
        documents: this.project(cwd).documents.map(row =>
          row.key === doc.key ? { ...row, original } : row,
        ),
      })
    })
  }
  /**
   * Search project or dependency-source text with bounded results.
   * @param query - Literal search text.
   */
  async search(query: string): Promise<void> {
    const { cwd, sourceId } = this.snapshot
    await this.perform(cwd, async () => {
      const result = await this.request<{ hits: SearchHit[]; truncated: boolean }>(
        cwd,
        sourceId ? 'source-search' : 'search',
        { query, ...(sourceId ? { id: sourceId } : {}) },
      )
      this.patch(cwd, {
        hits: result.hits,
        ...(result.truncated ? { error: '结果已截断，请缩小搜索范围。' } : {}),
      })
    })
  }
  /**
   * Search Modrinth using the current host project facts.
   * @param query - Literal search text.
   * @param provider - Selected publication service.
   */
  async searchMods(query: string, provider: 'modrinth' | 'curseforge' = 'modrinth'): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      this.patch(cwd, { mods: await this.request(cwd, 'mod-search', { query, provider }), versions: [] })
    })
  }
  /**
   * Load compatible publications for a selected Modrinth project.
   * @param id - Identifier returned by the owning operation.
   * @param provider - Selected publication service.
   */
  async modVersions(id: string, provider: 'modrinth' | 'curseforge' = 'modrinth'): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      this.patch(cwd, { versions: await this.request(cwd, 'mod-versions', { id, provider }) })
    })
  }
  /**
   * Resolve a proposed dependency change before any configuration mutation.
   * @param input - Requested dependency source, role or removal/update.
   */
  async preview(input: {
    source?: DependencySource
    role?: DependencyRole
    removeId?: string
    updateId?: string
    enabled?: boolean
  }): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      this.patch(cwd, { plan: await this.request(cwd, 'dependency-preview', input) })
    })
  }
  /**
   * Discard the current dependency preview selection.
   */
  dismissPlan(): void {
    this.patch(this.snapshot.cwd, { plan: undefined })
  }
  /**
   * Commit the selected preview and reload committed dependency facts.
   */
  async applyPlan(): Promise<void> {
    const { cwd, plan } = this.snapshot
    if (!plan) return
    await this.perform(cwd, async () => {
      await this.request(cwd, 'dependency-apply', { id: plan.id })
      this.patch(cwd, { plan: undefined })
      await this.refresh(cwd)
    })
  }
  /**
   * Prepare matching source archives or a read-only decompilation.
   * @param dependencyId - Committed dependency identifier.
   * @param archive - Optional matching source archive path.
   */
  async source(dependencyId: string, archive?: string): Promise<void> {
    const cwd = this.snapshot.cwd
    await this.perform(cwd, async () => {
      const source = await this.request<SourceSnapshot>(cwd, 'source-start', {
        dependencyId,
        ...(archive ? { archive } : {}),
      })
      this.patch(cwd, { source })
    })
  }
  /**
   * Cancel the source operation owned by the active project.
   */
  async cancelSource(): Promise<void> {
    const { cwd, source } = this.snapshot
    if (source)
      await this.perform(cwd, async () => {
        await this.request(cwd, 'source-cancel', { id: source.id })
      })
  }
  /**
   * Stop polling and detach observers when the plugin is disposed.
   */
  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.listeners.clear()
  }
}
/**
 * Identify snapshots whose operation has settled.
 * @param run - Host run snapshot.
 * @returns Identify snapshots whose operation has settled.
 */
export const terminal = (run: RunSnapshot): boolean =>
  ['exited', 'failed', 'cancelled', 'interrupted'].includes(run.phase)
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
