/**
 * @deepseek-ai/dsh-desktop-app — private Electron renderer runtime glue and
 * its bundle patch. It resolves the built renderer, mounts it through the
 * local HTTP carrier, and publishes a loopback readiness line for Electron.
 * @module @deepseek-ai/dsh-desktop-app
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { addHarnessSourceSection } from '@deepseek-ai/dsh-app-boot'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-shell-env'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/** This dsh installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Runtime service that releases desktop rows after bind-dependent values resolve. */
const DESKTOP_RUNTIME_SERVICE = 'desktopRuntime'

/** Services required before the desktop renderer runtime can mount. */
export const inject = ['webServer']

/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:desktop-surface` prompt
   * section and the `DSH_DESKTOP_URL` shell variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
}

export const Config: z<Config> = z.object({
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
})

/** Bind-dependent values retained for the shared connection service. */
export interface DesktopRuntimeValues {
  /** Additional authorities accepted by the shared connection service. */
  trustedHosts: string[]
}

/** Environment variable naming the canonical local URL of this desktop renderer. */
const DSH_DESKTOP_URL = 'DSH_DESKTOP_URL' as const

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'
/** Return the fixed trust values for the loopback-only desktop runtime.
 * @returns The desktop runtime values used by the shared connection service.
 */
export function desktopRuntimeValues(): DesktopRuntimeValues {
  return { trustedHosts: [] }
}

/** Model-visible orientation for sessions created through the desktop application. */
function webSurfacePrompt(webUrl: string): string {
  return `You are interacting with the user through the CraftCode desktop application at ${webUrl}. `
    + 'When the user refers to "this page", "this app", or "this GUI" without naming another target, they mean this desktop application. '
    + 'The renderer is private to the desktop process; do not start a replacement server.'
}

/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('desktop-app: webServer service missing while resolving desktop runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/** Dist location is the renderer artifact owned by the desktop application. */
function resolveDistIndex(): string {
  const path = process.env.DSH_DESKTOP_RENDERER_DIST
    ?? fileURLToPath(new URL('../../../../apps/desktop/dist/index.html', import.meta.url))
  if (!existsSync(path)) {
    throw new Error('desktop-app: renderer dist not built; run pnpm run desktop:build-renderer first')
  }
  return path
}

/** Test hook for the built dist; production never mutates it. */
export const internals: {
  resolveDistIndex: () => string
} = { resolveDistIndex }

/**
 * Mount the desktop renderer runtime: dist serving, model orientation, shell
 * URL, and the readiness line consumed by Electron.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = desktopRuntimeValues()
  // Providing this service releases dependent rows only after the renderer
  // runtime has mounted its static fallback.
  ctx.provide(DESKTOP_RUNTIME_SERVICE, runtime)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      promptCtx.systemPrompt.section({
        name: 'app:desktop-surface',
        order: -98,
        text: () => webSurfacePrompt(localWebUrl(promptCtx)),
      })
    })
    ctx.inject(['shellEnv'], (runtimeCtx) => {
      runtimeCtx.shellEnv.register({
        name: 'desktop-runtime',
        variables: {
          [DSH_DESKTOP_URL]: { description: 'Canonical local URL of the CraftCode desktop renderer serving this session.' },
        },
        resolve: () => ({ [DSH_DESKTOP_URL]: localWebUrl(runtimeCtx) }),
      })
    })
  }
  if (config.printUrl) {
    // Electron starts RPC as soon as it observes the readiness line, so wait
    // until sibling rows such as the /api route owner have mounted.
    const announceReady = (): void => {
      const webUrl = localWebUrl(ctx)
      if (config.printUrl) {
        console.log(`dsh desktop: ${webUrl}`)
      }
    }
    // This row's own activation can precede a sibling failure. The app owns
    // readiness by waiting for its Loader tree, or announces at once in a
    // hand-built context without Loader.
    const settled = ctx.get('loader')?.await()
    if (settled === undefined) announceReady()
    else {
      void settled.then(() => {
        // The tree can be disposed while the boot was in flight (early
        // SIGTERM); announcing a dead server would mislead Electron, and
        // reading the torn-down port would turn a clean shutdown into a crash.
        if (ctx.get('webServer') !== undefined) announceReady()
      // Loader reports a failed boot; this row only stays quiet.
      }, () => {})
    }
  }
}
