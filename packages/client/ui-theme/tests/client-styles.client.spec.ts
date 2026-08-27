// @vitest-environment jsdom
/** Dynamic ui-theme entry owns the global styles in dependency order. */
import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installThemeStyles } from '../src/client/styles.ts'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'
const minecraftCss = readFileSync(resolve('packages/client/ui-theme/src/styles/minecraft.css'), 'utf8')
const minecraftComponentCss = [
  'packages/client/web/src/boot-page.module.css',
  'packages/client/ui-layout/src/client/AppFrame.module.css',
  'packages/client/ui-sidebar/src/client/SidebarRoot.module.css',
  'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css',
].map(path => readFileSync(resolve(path), 'utf8')).join('\n')

afterEach(() => {
  document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`).forEach((node) => { node.remove() })
})

describe('ui-theme client styles', () => {
  it('mounts every global sheet in dependency order and removes them on dispose', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({
      apply(scope) { installThemeStyles(scope) },
    })
    await fiber.await()

    const styles = [...document.head.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)]
    expect(styles.map(style => style.dataset.pluginCss)).toEqual([
      `${PLUGIN_ID}/base.css`,
      `${PLUGIN_ID}/design-platform.css`,
      `${PLUGIN_ID}/scrollbar.css`,
      `${PLUGIN_ID}/gradient-shadow-text.css`,
      `${PLUGIN_ID}/shiki.css`,
      `${PLUGIN_ID}/minecraft.css`,
    ])
    await fiber.dispose()
    expect(document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)).toHaveLength(0)
  })

  it('keeps the new-session button flat in its resting and pressed states', () => {
    const resting = minecraftCss.match(/\[class\*=(["']?)_newSession\1\]\s*\{([^}]*)\}/)?.[2] ?? ''
    const pressed = minecraftCss.match(/\[class\*=(["']?)_newSession\1\]:active\s*\{([^}]*)\}/)?.[2] ?? ''

    expect(resting).toMatch(/border-radius:\s*2px\s*!important/)
    expect(resting).toMatch(/box-shadow:\s*none/)
    expect(pressed).toMatch(/transform:\s*translate\(1px,\s*1px\)/)
    expect(pressed).toMatch(/box-shadow:\s*none/)
  })

  it('keeps Minecraft elevation and component chrome free of pixel shadows', () => {
    expect(minecraftCss.match(/--dsw-shadow-lv[123]:\s*none/g)).toHaveLength(6)
    expect(minecraftCss).not.toContain('--dsh-mc-pixel-shadow')
    expect(`${minecraftCss}\n${minecraftComponentCss}`).not.toMatch(
      /box-shadow:\s*(?:inset\s+)?-?\d+px\s+-?\d+px\s+0(?:px)?/,
    )
    expect(minecraftComponentCss).not.toMatch(
      /filter:\s*drop-shadow\(\s*-?\d+px\s+-?\d+px\s+0(?:px)?/,
    )
  })
})
