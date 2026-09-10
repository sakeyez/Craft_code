/**
 * Internal browser kernel for the desktop renderer. {@link RendererBootEntry}
 * apps/desktop/renderer's Vite entry runs it against #root. The boot page and fiber-state
 * projection remain internal; the static module table and its platform words
 * form the package's build-time contract.
 * @module @deepseek-ai/dsh-client-web
 */

export { RendererBootEntry, type BootSeams } from './boot.ts'
export { getStaticModules } from './seed.ts'
export { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS, type PlatformModule } from './platform.ts'
