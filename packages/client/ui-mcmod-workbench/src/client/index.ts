/** Slot contributions for project navigation, development tests, dependencies and editing. */
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NetworkSettings, type NetworkPreferences, type NetworkSettingsInjected } from './NetworkSettings.tsx'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DependencyRole, DependencySource, RunAction, RunOptions } from '@deepseek-ai/dsh-mc-workbench/types'
import { WorkbenchModel, type WorkbenchState } from './model.ts'
import { WorkbenchNavigation, WorkbenchPanel } from './Workbench.tsx'
import { WorkbenchDialogs } from './WorkbenchDialogs.tsx'

/**
 * Callbacks and observable state bound to the current project session.
 */
export interface WorkbenchInjected {
  hooks: { workbench: HostObservable<WorkbenchState> }
  activate: (cwd: string) => void
  navigate: (cwd: string, view: 'conversation' | 'code' | 'dependencies' | 'test') => void
  start: (action: RunAction, options?: RunOptions) => Promise<void>
  retry: (id: string) => Promise<void>
  stop: () => Promise<void>
  refresh: () => Promise<void>
  selectRun: (id: string) => void
  exportLogs: () => Promise<string>
  eula: (path: string) => Promise<void>
  directory: (path: string, sourceId?: string) => Promise<void>
  openFile: (path: string, line?: number) => Promise<void>
  selectDocument: (key: string) => void
  edit: (key: string, draft: string) => void
  save: () => Promise<void>
  closeDocument: (key: string) => void
  reloadDocument: () => Promise<void>
  diff: (mode: 'disk' | 'head' | 'off') => Promise<void>
  search: (query: string) => Promise<void>
  queryApi: (symbol: string) => Promise<void>
  previewResource: () => Promise<void>
  searchMods: (query: string, provider?: 'modrinth' | 'curseforge') => Promise<void>
  modVersions: (id: string, provider?: 'modrinth' | 'curseforge') => Promise<void>
  saveCurseForgeKey: (key: string) => Promise<void>
  checkpoint: (action: 'create' | 'preview' | 'restore' | 'delete', id?: string) => Promise<void>
  closeDialog: () => void
  preview: (input: {
    source?: DependencySource
    role?: DependencyRole
    removeId?: string
    updateId?: string
    enabled?: boolean
  }) => Promise<void>
  dismissPlan: () => void
  applyPlan: () => Promise<void>
  source: (dependencyId: string, archive?: string) => Promise<void>
  cancelSource: () => Promise<void>
  ask: (text: string) => Promise<void>
  openNetworkSettings?: () => void
  openPath: (path: string) => Promise<void>
}

export const inject = ['slots', 'connection', 'layout', 'sessions', 'workspaces']
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const model = new WorkbenchModel(connection.rpc)
  const desktop = (window as unknown as {
    craftCodeDesktop?: { onMenuAction(listener: (action: string) => void): () => void }
  }).craftCodeDesktop
  if (desktop) ctx.effect(() => desktop.onMenuAction((action) => {
    if (action === 'project:checkpoints') void model.openDialog('recovery')
    if (action === 'help:about') void model.openDialog('about')
  }), 'mc-workbench: project menu')
  const networkCall = async (endpoint: string, value: unknown = {}): Promise<unknown> => {
    const result = await connection.rpc.call('/mc-workbench', endpoint, value)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const parseNetwork = (value: unknown): NetworkPreferences => {
    if (typeof value !== 'object' || value === null || !('mode' in value) || !['auto', 'direct', 'proxy'].includes(String(value.mode))
      || !('proxyUrl' in value) || typeof value.proxyUrl !== 'string') throw new Error('网络设置响应无效。')
    return { mode: value.mode as NetworkPreferences['mode'], proxyUrl: value.proxyUrl }
  }
  const networkInjected = (): NetworkSettingsInjected => ({
    load: async () => parseNetwork(await networkCall('network-get')),
    saveNetwork: async value => parseNetwork(await networkCall('network-save', value)),
    checkNetwork: async () => {
      const value = await networkCall('network-check')
      if (!Array.isArray(value)) throw new Error('连接检测响应无效。')
      return value.map((row: unknown) => {
        if (typeof row !== 'object' || row === null || !('name' in row) || typeof row.name !== 'string'
          || !('ok' in row) || typeof row.ok !== 'boolean' || !('message' in row) || typeof row.message !== 'string') throw new Error('连接检测响应无效。')
        return { name: row.name, ok: row.ok, message: row.message }
      })
    },
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'minecraft-network', order: 35, label: 'Minecraft 下载', inject: networkInjected,
  }, NetworkSettings))
  ctx.effect(
    () => () => {
      model.dispose()
    },
    'ui-mcmod-workbench: model',
  )
  const injected = (sessionId: SessionId | undefined): WorkbenchInjected => ({
    hooks: { workbench: model },
    checkpoint: (action, id) => model.checkpoint(action, id),
    closeDialog: () =>{  model.closeDialog() },
    activate: (cwd) => {
      model.activate(cwd)
    },
    navigate: (cwd, view) => ctx.layout.setWorkbenchView?.(cwd, view),
    start: (action, options) => model.start(action, options),
    retry: id => model.retry(id),
    stop: () => model.stop(),
    refresh: () => model.refresh(),
    selectRun: (id) => {
      model.selectRun(id)
    },
    exportLogs: () => model.exportLogs(),
    eula: path => model.eula(path),
    directory: (path, sourceId) => model.directory(path, sourceId),
    openFile: (path, line) => model.open(path, line),
    selectDocument: (key) => {
      model.selectDocument(key)
    },
    edit: (key, draft) => {
      model.edit(key, draft)
    },
    save: () => model.save(),
    closeDocument: (key) => {
      model.closeDocument(key)
    },
    reloadDocument: () => model.reloadDocument(),
    diff: mode => model.diff(mode),
    search: query => model.search(query),
    queryApi: symbol => model.queryApi(symbol),
    previewResource: () => model.previewResource(),
    searchMods: (query, provider) => model.searchMods(query, provider),
    modVersions: (id, provider) => model.modVersions(id, provider),
    saveCurseForgeKey: async (value) => {
      const response = await connection.api.credentials.set({ ref: 'CURSEFORGE_API_KEY', value })
      if (!response.result.ok) throw new Error(response.result.error.message)
    },
    preview: input => model.preview(input),
    dismissPlan: () => {
      model.dismissPlan()
    },
    applyPlan: () => model.applyPlan(),
    source: (id, archive) => model.source(id, archive),
    cancelSource: () => model.cancelSource(),
    ask: async (text) => {
      const session = sessionId ? ctx.sessions.binding(sessionId)?.session : undefined
      if (!session) throw new Error('请先打开项目对话。')
      const facts = model.getSnapshot().data?.facts.project
      const context = facts
        ? `项目：${model.getSnapshot().cwd}\n加载器：${facts.loader}\nMinecraft：${facts.minecraftVersion.status === 'determined' ? facts.minecraftVersion.value : '尚未确定'}\n\n`
        : ''
      const result = await session.prompt([{ type: 'text', text: context + text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
      ctx.layout.setWorkbenchView?.(model.getSnapshot().cwd, 'conversation')
    },
    openPath: async (path) => {
      await ctx.workspaces.openPath(path)
    },
  })
  ctx.slots.inject('workbench.nav', () =>
    ctx.slots.register({ name: 'workbench.nav', inject: injected }, WorkbenchNavigation),
  )
  ctx.slots.inject('workbench.panel', () =>
    ctx.slots.register({ name: 'workbench.panel', inject: injected }, WorkbenchPanel),
  )
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'minecraft-project-dialogs', inject: () => injected(undefined) }, WorkbenchDialogs))

}
