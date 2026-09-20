/** Browser half of the host-local Minecraft New Mod wizard. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/src/client/contract/slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { BootstrapAction } from './BootstrapAction.tsx'
import { BootstrapOverlay } from './BootstrapOverlay.tsx'
import { BootstrapWizardModel, type BootstrapWizardInjected } from './model.ts'
import { en, zh, type BootstrapKey } from './locales.ts'

export { BootstrapWizardModel } from './model.ts'
export type { BootstrapKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** New Mod wizard copy. */
    mcmodBootstrap: BootstrapKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared state between the sidebar action and frame overlay. */
    mcmodBootstrap: BootstrapWizardModel
  }
}

/** Services required by the action and overlay registrations. */
export const inject = ['slots', 'connection', 'workspaces', 'locale', 'remote']

/** Mount dictionaries, state, sidebar action, and frame-wide overlay. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const parent = connection.hostDescription.getSnapshot()?.home ?? ''
  const model = new BootstrapWizardModel(connection.rpc, ctx.workspaces, parent)
  ctx.provide('mcmodBootstrap', model)
  ctx.effect(() => ctx.locale.register('mcmodBootstrap', { zh, en }), 'ui-mcmod-bootstrap: dictionaries')

  // The host description is generation-scoped; use its home path as the
  // default only while the user has not entered a location.
  const offDescription = connection.hostDescription.subscribe(() => {
    const home = connection.hostDescription.getSnapshot()?.home
    if (home !== undefined && model.getSnapshot().form.parentDirectory === '') model.setParentDirectory(home)
  })
  ctx.effect(() => offDescription, 'ui-mcmod-bootstrap: host description')

  // Progress events make the UI responsive between polls. The status RPC is
  // still authoritative after reconnects or an event that was missed.
  const offProgress = ctx.remote.$on('minecraft-bootstrap/progress', (snapshot) => { model.acceptProgress(snapshot) })
  ctx.effect(() => offProgress, 'ui-mcmod-bootstrap: progress events')
  ctx.effect(() => () => { model.dispose() }, 'ui-mcmod-bootstrap: model')

  const injected = (): BootstrapWizardInjected => ({
    hooks: { wizard: model },
    open: () => { model.open() },
    close: () => { model.close() },
    toggleAdvanced: () => { model.toggleAdvanced() },
    setModName: (value) => { model.setModName(value) },
    setLoader: (value) => { model.setLoader(value) },
    setEntry: (value) => { model.setEntry(value) },
    setParentDirectory: (value) => { model.setParentDirectory(value) },
    setDirectoryName: (value) => { model.setDirectoryName(value) },
    setModId: (value) => { model.setModId(value) },
    setPackageName: (value) => { model.setPackageName(value) },
    chooseParent: () => model.chooseParent(),
    refreshCatalog: () => model.refreshCatalog(),
    start: () => model.start(),
    retry: () => model.retry(),
    cancel: () => model.cancel(),
    openDirectory: () => model.openDirectory(),
  })

  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action', locale: 'mcmodBootstrap',
    inject: injected,
  }, BootstrapAction))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'mcmod-bootstrap-overlay', order: 30, locale: 'mcmodBootstrap',
    inject: injected,
  }, BootstrapOverlay))
}
