import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config, internals } from '../src/index.ts'

let dist: string | undefined
const originalResolve = internals.resolveDistIndex

afterEach(() => {
  vi.restoreAllMocks()
  internals.resolveDistIndex = originalResolve
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true })
  dist = undefined
})

function stageDist(): void {
  dist = mkdtempSync(join(tmpdir(), 'dsh-desktop-app-'))
  mkdirSync(join(dist, 'dist'))
  const index = join(dist, 'dist', 'index.html')
  writeFileSync(index, '<head></head><body>shell</body>')
  internals.resolveDistIndex = () => index
}

function fakeHttpServer(): { server: WebServer; fallback: () => unknown } {
  let handler: unknown
  const server = {
    host: '127.0.0.1',
    port: 4567,
    registerFallback: (value: unknown) => { handler = value; return () => { handler = undefined } },
    renderIndex: (html: string) => html,
  } as unknown as WebServer
  return { server, fallback: () => handler }
}

describe('desktop runtime glue', () => {
  it('mounts the private renderer and publishes loopback readiness', async () => {
    stageDist()
    const ctx = new Context()
    const { server, fallback } = fakeHttpServer()
    ctx.provide('webServer', server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ printUrl: true, surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fallback()).toBeDefined()
    expect(log).toHaveBeenCalledWith('dsh desktop: http://127.0.0.1:4567')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'app:desktop-surface')?.text)
      .toContain('CraftCode desktop application')
    await ctx.fiber.dispose()
  })

  it('does not publish readiness or prompt context when disabled', async () => {
    stageDist()
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer().server)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    apply(ctx, new Config({ printUrl: false, surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(log).not.toHaveBeenCalled()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:desktop-surface')).toBe(false)
    await ctx.fiber.dispose()
  })
})
