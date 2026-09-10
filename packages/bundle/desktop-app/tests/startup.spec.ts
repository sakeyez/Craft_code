import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, DESKTOP_STARTUP_SERVICE, type DesktopStartupValues } from '../src/startup.ts'

interface Observed { exits: number[]; out: string; readerConfig?: unknown }
const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout; internals.stderr = process.stderr
})

async function bootProvider(args: string[]): Promise<{ values: DesktopStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'reader.mjs'), 'export function apply(_ctx, config) { globalThis.__desktopObserved.readerConfig = config }\n')
  writeFileSync(join(dir, 'provider.mjs'), "export const name = 'desktop-startup'\nexport const inject = ['cmdlineArgs']\nexport const apply = ctx => globalThis.__desktopApply(ctx)\n")
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: reader', `  name: ${pathToFileURL(join(dir, 'reader.mjs')).href}`, `  inject: [${DESKTOP_STARTUP_SERVICE}]`,
    '  config:', '    port: !!js ctx.desktopStartup.port ?? 3080', '- id: provider',
    `  name: ${pathToFileURL(join(dir, 'provider.mjs')).href}`, '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing; internals.stderr = observing
  const globals = globalThis as unknown as { __desktopApply: typeof apply; __desktopObserved: Observed }
  globals.__desktopApply = apply; globals.__desktopObserved = observed
  const ctx = new Context(); await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await(); disposers.push(async () => { await ctx.fiber.dispose() })
  return { values: ctx.get(DESKTOP_STARTUP_SERVICE) as DesktopStartupValues | undefined, observed }
}

describe('desktop command-line provider', () => {
  it('publishes the optional port', async () => {
    const { values, observed } = await bootProvider(['--port', '8080'])
    expect(values).toEqual({ port: 8080 }); expect(observed.readerConfig).toEqual({ port: 8080 }); expect(observed.exits).toEqual([])
  })
  it('uses deployment defaults when omitted', async () => {
    const { values, observed } = await bootProvider([])
    expect(values).toEqual({}); expect(observed.readerConfig).toEqual({ port: 3080 })
  })
  it('prints help without activating the consumer', async () => {
    const { values, observed } = await bootProvider(['--help'])
    expect(observed.out).toContain('dsh --profile desktop'); expect(observed.out).toContain('--port')
    expect(values).toBeUndefined(); expect(observed.readerConfig).toBeUndefined(); expect(observed.exits).toEqual([0])
  })
  it('rejects a non-numeric port', async () => {
    const { values, observed } = await bootProvider(['--port', 'abc'])
    expect(observed.out).toContain('--port must be a number'); expect(values).toBeUndefined(); expect(observed.readerConfig).toBeUndefined(); expect(observed.exits).toEqual([1])
  })
})
