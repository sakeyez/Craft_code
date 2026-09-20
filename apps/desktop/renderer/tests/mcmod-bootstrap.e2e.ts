// Assembled browser contract for the Minecraft New Mod wizard.
//
// This stays on the Host-face browser lane: Playwright drives the real HTTP
// server and shipped client bundle, while only the host bootstrap service is
// replaced with an in-process deterministic seam. No Gradle/network/model call
// is needed to prove the hand-off ordering.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type {
  BootstrapStartRequest, CatalogEntry, CatalogSnapshot, MinecraftBootstrap, OperationSnapshot,
} from '@deepseek-ai/dsh-tool-mc-bootstrap/src/index'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const CATALOG_ENTRY: CatalogEntry = {
  entryId: 'fabric:1.21.1:0.16.5',
  loader: 'fabric',
  minecraftVersion: '1.21.1',
  loaderVersion: '0.16.5',
  mappingsVersion: '1.21.1+build.3',
  apiVersion: '0.102.0+1.21.1',
  pluginVersion: '1.17.20',
  gradleVersion: '9.5.1',
  gradleSha256: 'bafc141b619ad6350fd975fc903156dd5c151998cc8b058e8c1044ab5f7b031f',
  wrapperSha256: '497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7',
  requiredJdk: 21,
  stable: true,
}

const OPERATION_ID = 'assembled-bootstrap-1'

describe('web e2e: New Mod waits for a successful build before opening a session', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let bootstrap: MinecraftBootstrap
  let status: 'running' | 'ready'
  let readyStatusCalls: number
  let projectPath: string
  let startRequests: BootstrapStartRequest[]
  let modelEvents: SessionEvent[]
  let workspaceCreate: ReturnType<typeof vi.spyOn>
  let sessionCreate: ReturnType<typeof vi.spyOn>
  let sessionPrompt: ReturnType<typeof vi.spyOn>
  let offEvents: (() => void) | undefined

  const catalog: CatalogSnapshot = {
    entries: [CATALOG_ENTRY],
    cached: false,
    stale: false,
    java: { available: true, version: 21, executable: 'java' },
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(process.cwd(), 'packages/bundle/mcmod/cordis.patch.yml'),
    })
    projectPath = join(scaffold.workspaceCwd, 'assembled-copper-tools')
    // The fake reports a ready path that is real enough for the workspace
    // registry to adopt, without writing a generated project in this lane.
    await mkdir(projectPath, { recursive: true })

    bootstrap = scaffold.ctx.minecraftBootstrap
    status = 'running'
    readyStatusCalls = 0
    startRequests = []
    // `handleRpc` is an arrow on the service and resolves these methods from
    // `this` for every request, so replacing the host methods after boot keeps
    // the real loopback route and envelope validation intact.
    bootstrap.catalog = async () => catalog
    bootstrap.start = async (request) => {
      startRequests.push(request)
      return { operationId: OPERATION_ID }
    }
    bootstrap.status = (operationId: string): OperationSnapshot => {
      if (status === 'ready') readyStatusCalls += 1
      return {
        operationId,
        status,
        stage: status === 'ready' ? 'done' : 'build',
        progress: status === 'ready' ? 100 : 62,
        ...(status === 'ready' ? { projectPath } : {}),
        entry: CATALOG_ENTRY,
        logTail: 'fake build\\n',
        updatedAt: '2026-09-15T00:00:00.000Z',
      }
    }
    bootstrap.cancel = () => false

    workspaceCreate = vi.spyOn(scaffold.ctx.apiProxy.workspace, 'create')
    sessionCreate = vi.spyOn(scaffold.ctx.apiProxy.sessions, 'create')
    sessionPrompt = vi.spyOn(scaffold.ctx.apiProxy.sessions, 'prompt')
    modelEvents = []
    offEvents = scaffold.ctx.on('session/event', (_session, event: SessionEvent) => {
      if (event.type === 'request/header' || event.type === 'assistant/chunk') modelEvents.push(event)
    })

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    offEvents?.()
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps workspace/session/model creation behind the ready transition', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcmod-bootstrap'))
    const before = {
      workspace: workspaceCreate.mock.calls.length,
      session: sessionCreate.mock.calls.length,
      prompt: sessionPrompt.mock.calls.length,
      modelEvents: modelEvents.length,
    }

    const action = page.getByRole('button', { name: 'Create a new Minecraft mod' })
    await action.waitFor({ timeout: 15_000 })
    expect(await action.textContent()).toMatch(/New Mod.*Create a mod/u)
    expect(await action.evaluate(element => getComputedStyle(element).borderRadius)).toBe('10px')
    await action.click()
    const dialog = page.getByRole('dialog', { name: 'New Minecraft Mod' })
    await dialog.waitFor({ timeout: 10_000 })
    const modName = dialog.getByRole('textbox', { name: 'Mod name' })
    expect(await modName.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await dialog.getByRole('combobox', { name: 'Loader' }).inputValue()).toBe('fabric')
    expect(await dialog.getByRole('textbox', { name: 'modId' }).count()).toBe(0)
    await page.keyboard.press('Escape')
    expect(await dialog.isVisible()).toBe(false)
    expect(await action.evaluate(element => document.activeElement === element)).toBe(true)
    await action.click()
    await dialog.waitFor({ timeout: 10_000 })
    expect(await dialog.getByRole('textbox', { name: '搜索 Minecraft 版本' }).count()).toBe(0)
    expect(await modName.evaluate(element => getComputedStyle(element).borderWidth)).toBe('0px')
    expect(await modName.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
    await mkdir('.artifacts/mc-workbench', { recursive: true })
    await page.screenshot({ path: '.artifacts/mc-workbench/new-mod-fixed.png' })
    const javaStatus = dialog.getByText('JDK 21 detected', { exact: true })
    await javaStatus.waitFor({ timeout: 10_000 })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await modName.focus()
      expect(await modName.evaluate(element => getComputedStyle(element.parentElement!).outlineStyle)).toBe('solid')
      await page.screenshot({ path: `.artifacts/mc-workbench/new-mod-${scheme}.png` })
    }
    await page.setViewportSize({ width: 480, height: 850 })
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: '.artifacts/mc-workbench/new-mod-narrow.png' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({ colorScheme: 'light' })
    await modName.fill('Copper Tools')
    await dialog.getByRole('button', { name: 'Advanced options' }).click()
    expect(await dialog.getByRole('textbox', { name: 'modId' }).inputValue()).toBe('copper_tools')
    expect(await dialog.getByRole('textbox', { name: 'Java package' }).inputValue()).toBe('com.example.copper_tools')
    await dialog.getByPlaceholder('Choose a parent directory').fill(scaffold.workspaceCwd)
    await dialog.getByRole('textbox', { name: 'Project directory' }).fill('assembled-copper-tools')
    await dialog.getByRole('button', { name: 'Create and build' }).click()
    const runningStatus = dialog.getByText('Running first build', { exact: true })
    await runningStatus.waitFor({ timeout: 10_000 })
    expect(await modName.isDisabled()).toBe(true)
    await page.screenshot({ path: '.artifacts/mc-workbench/new-mod-building.png' })
    await page.keyboard.press('Escape')
    expect(await dialog.isVisible()).toBe(true)

    expect(startRequests).toHaveLength(1)
    expect(startRequests[0]).toMatchObject({
      entryId: CATALOG_ENTRY.entryId,
      parentDirectory: scaffold.workspaceCwd,
      directoryName: 'assembled-copper-tools',
      modName: 'Copper Tools',
      modId: 'copper_tools',
      packageName: 'com.example.copper_tools',
    })
    expect(workspaceCreate.mock.calls.length).toBe(before.workspace)
    expect(sessionCreate.mock.calls.length).toBe(before.session)
    expect(sessionPrompt.mock.calls.length).toBe(before.prompt)
    expect(modelEvents.length).toBe(before.modelEvents)

    // The host is the only authority that can advance the operation. Until it
    // reports ready, the browser must not register a workspace or allocate a
    // blank session (and therefore cannot reach the model).
    status = 'ready'
    // Registration closes the modal immediately after accepting the ready
    // snapshot, so use the host seam's observed ready response as the stable
    // assertion point instead of racing a transient success label.
    await expect.poll(() => readyStatusCalls, { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => workspaceCreate.mock.calls.length, { timeout: 15_000 })
      .toBeGreaterThan(before.workspace)
    await expect.poll(() => sessionCreate.mock.calls.length, { timeout: 15_000 })
      .toBeGreaterThan(before.session)
    expect(sessionPrompt.mock.calls.length).toBe(before.prompt)
    expect(modelEvents.length).toBe(before.modelEvents)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
