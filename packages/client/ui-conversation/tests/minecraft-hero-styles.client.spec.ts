/** Blank-session composer style contracts for the Minecraft theme. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const heroCss = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/HeroShell.module.css', import.meta.url)),
  'utf8',
)
const inputCss = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url)),
  'utf8',
)

describe('Minecraft blank-session hero styles', () => {
  it('renders the workspace trigger without a frame or shadow', () => {
    expect(heroCss).toMatch(
      /\.workspace\s*\{[^}]*\bborder:\s*none;[^}]*\bbackground:\s*transparent;[^}]*\bbox-shadow:\s*none;/s,
    )
  })

  it('reserves a 78px hero draft floor', () => {
    expect(inputCss).toMatch(/\.hero \.mirror\s*\{[^}]*\bmin-height:\s*78px;/s)
  })

  it('clips the no-workspace composer to a soft solid card border', () => {
    expect(inputCss).toMatch(
      /\.cardWorkspaceTrigger\s*\{[^}]*\boverflow:\s*hidden;/s,
    )
    expect(inputCss).toMatch(
      /\.card\.cardWorkspaceTrigger\s*\{[^}]*\bborder-color:\s*var\(--dsw-alias-border-l2\);[^}]*\bborder-radius:\s*8px\s*!important;/s,
    )
    expect(inputCss).not.toContain('.cardWorkspaceTrigger::after')
  })

  it('matches the Minecraft send button to the attach control and lowers it slightly', () => {
    const primaryButtonRule = new RegExp(
      String.raw`.primary\s*\{[^}]*\bbackground:\s*var\(--dsw-specific-selector\);` +
      String.raw`[^}]*\bcolor:\s*var\(--dsw-alias-label-primary\);` +
      String.raw`[^}]*\btransform:\s*translateY\(1px\);`,
      's',
    )
    expect(inputCss).toMatch(
      primaryButtonRule,
    )
    expect(inputCss).toMatch(/\.primary:hover:not\(:disabled\)\s*\{[^}]*\bbackground:\s*var\(--dsh-mc-gold\);/s)
  })

  it('centers the attach icon in its full button box', () => {
    expect(inputCss).toMatch(/\.add\s*,\s*\.select\s*\{[^}]*\bpadding:\s*0;/s)
  })
})
