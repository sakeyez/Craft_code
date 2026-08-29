/** Pure BrowserWindow policy shared by the main process and focused tests. */
import type { BrowserWindowConstructorOptions, NativeImage, WebPreferences } from 'electron'

export const DESKTOP_APP_USER_MODEL_ID = 'ai.deepseek.craftcode'

/** Use the stable Windows taskbar identity only when an installed app owns it. */
export function desktopAppUserModelId(
  packaged: boolean,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return packaged && platform === 'win32' ? DESKTOP_APP_USER_MODEL_ID : undefined
}

/** Node-free renderer preferences for every desktop-owned window. */
export const DESKTOP_WEB_PREFERENCES: Readonly<WebPreferences> = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
})

/** BrowserWindow options applied to the main window and same-origin children. */
export function desktopWindowOptions(
  icon?: NativeImage,
  preload?: string,
  show = true,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return {
    title: 'CraftCode',
    frame: platform === 'darwin',
    ...(icon === undefined ? {} : { icon }),
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show,
    backgroundColor: '#0b0d10',
    webPreferences: { ...DESKTOP_WEB_PREFERENCES, ...(preload === undefined ? {} : { preload }) },
  }
}

export type NavigationDisposition = 'allow' | 'external' | 'deny'

/** Classify a requested navigation against the backend origin owned by this launch. */
export function navigationDisposition(target: string, allowedOrigin: string): NavigationDisposition {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return 'deny'
  }
  if (url.username !== '' || url.password !== '') return 'deny'
  if (url.origin === allowedOrigin) return 'allow'
  return url.protocol === 'http:' || url.protocol === 'https:' ? 'external' : 'deny'
}
