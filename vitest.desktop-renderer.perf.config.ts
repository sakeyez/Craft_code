import { defineConfig } from 'vitest/config'
import desktopRendererConfig from './vitest.desktop-renderer.config.ts'

// Manual high-cardinality diagnostics stay outside the desktop renderer config's
// .e2e.ts/.snapshot.ts inventory and therefore outside the CI renderer gate.
export default defineConfig({
  ...desktopRendererConfig,
  test: {
    ...desktopRendererConfig.test,
    include: ['apps/desktop/renderer/tests/**/*.perf.ts'],
    disableConsoleIntercept: true,
    hookTimeout: 180_000,
    testTimeout: 600_000,
  },
})
