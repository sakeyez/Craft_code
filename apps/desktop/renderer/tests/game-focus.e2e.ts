/** Real browser layout and composer interactions with the native game boundary stubbed. */
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, type Browser, type Page, type Locator } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, ZH_BROWSER_LOCALE } from './support.ts'

// The host test supplies only the native boundary; client contracts stay in the client TS graph.
type FixtureGameState = { status: 'starting' } | { status: 'connected'; surfaceKind: 'external-window'; gameName: string } | { status: 'disconnected'; error: string }

describe('Minecraft focus layout', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url)),
    })
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        'origin-gateway': {
          displayName: 'Focus test', api: 'openai-completions', baseURL: 'https://example.invalid/v1',
          models: [
            { id: 'origin-large', name: 'Focus Vision', input: ['text', 'image'] },
            { id: 'focus-small', name: 'Focus Small', input: ['text', 'image'] },
          ],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    consoleWatch = watchConsole(page)
    await page.addInitScript(() => {
      let cwd: string | undefined
      const noop = async () => {}
      const unsubscribe = () => () => {}
      Object.assign(window, { craftCodeDesktop: {
        menuPresentation: 'web', onMenuAction: unsubscribe, onGameEvent: unsubscribe,
        onMaximizedChange: unsubscribe, openMenu: noop, minimizeWindow: noop,
        toggleMaximizeWindow: noop, closeWindow: noop, isMaximized: async () => false,
        setActiveProject: async (value: string | undefined) => { cwd = value },
        invokeProjectCommand: async () => ({ ok: true, title: '', message: '' }),
        onGameSurfaceState: (listener: (value: { cwd: string; state: FixtureGameState }) => void) => {
          const receive = (event: Event) => {
            if (cwd !== undefined) listener({ cwd, state: (event as CustomEvent<FixtureGameState>).detail })
          }
          window.addEventListener('test-game-state', receive)
          return () => { window.removeEventListener('test-game-state', receive) }
        },
        bindGameAnnotationShortcut: (_request: unknown, listener: (error?: string) => void) => {
          const receive = () => { listener() }
          window.addEventListener('test-annotation-shortcut', receive)
          return () => { window.removeEventListener('test-annotation-shortcut', receive) }
        },
        beginGameAnnotation: async (_request: unknown,
          commit: (drafts: unknown[], snapshot: { dataUrl: string; width: number; height: number }) => Promise<void>) => {
          const canvas = document.createElement('canvas')
          canvas.width = 800
          canvas.height = 450
          const context = canvas.getContext('2d')!
          context.fillStyle = '#4d8b43'
          context.fillRect(0, 0, 800, 450)
          await commit([{ id: crypto.randomUUID(), label: 'B', description: 'Native shortcut annotation', createdAt: Date.now(), shape: { type: 'point', geometry: { x: .5, y: .5 } } }], { dataUrl: canvas.toDataURL('image/jpeg'), width: 800, height: 450 })
        },
        endGameAnnotation: noop, repositionGameCompanion: noop,
      } })
    })
    await page.goto(scaffold.baseUrl)
    try {
      await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    } catch (error) {
      await mkdir('.artifacts/game-focus', { recursive: true })
      await page.screenshot({ path: '.artifacts/game-focus/setup-failed.png' })
      await writeFile('.artifacts/game-focus/setup-failed.txt', await page.locator('body').innerText())
      throw error
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  async function state(status: 'starting' | 'connected' | 'disconnected') {
    await page.evaluate((value) => {
      const detail = value === 'connected'
        ? { status: value, surfaceKind: 'external-window', gameName: 'Minecraft' }
        : value === 'disconnected' ? { status: value, error: 'Window closed' } : { status: value }
      window.dispatchEvent(new CustomEvent('test-game-state', { detail }))
    }, status)
  }

  async function visibleInViewport(locator: Locator) {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(10)
    expect(box!.height).toBeGreaterThan(10)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
  }

  it('keeps chat, model selection, uploads and annotation accessible at companion widths', async () => {
    onTestFailed(async () => {
      await mkdir('.artifacts/game-focus', { recursive: true })
      await page.screenshot({ path: '.artifacts/game-focus/layout-failed.png' })
      await writeFile('.artifacts/game-focus/layout-failed.txt', await page.locator('body').innerText())
    })
    const input = page.locator('[data-composer-card] textarea')
    await input.fill('Keep this draft')
    const originalInput = await input.elementHandle()
    await state('starting')
    expect(await page.getByRole('navigation', { name: '应用菜单' }).isVisible()).toBe(true)
    await state('connected')
    await page.locator('[data-game-focus]').waitFor()
    for (const width of [494, 360, 520]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(async () => (await input.boundingBox())?.width).toBeGreaterThan(200)
      await visibleInViewport(input)
      expect((await page.locator('[data-composer-card]').boundingBox())!.y).toBeGreaterThan(700)
      expect(await page.getByText('在游戏上标注，将问题带入对话。').count()).toBe(0)
      await visibleInViewport(page.getByRole('button', { name: '在游戏画面上标注' }))
      await visibleInViewport(page.getByRole('button', { name: /选择模型/ }))
      expect(await page.getByRole('navigation', { name: '应用菜单' }).isVisible()).toBe(false)
      expect(await page.getByText('开始打造新想法', { exact: true }).isVisible()).toBe(false)
      expect(await page.locator('[data-side]').filter({ visible: true }).count()).toBe(0)
    }
    await page.setViewportSize({ width: 494, height: 1000 })
    await page.getByRole('button', { name: /选择模型/ }).click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'Focus Small', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: /选择模型/ }).getAttribute('aria-label')).toContain('Focus Small')

    await page.getByRole('button', { name: '命令', exact: true }).click()
    await page.keyboard.press('Escape')
    await input.evaluate((element) => {
      const canvas = document.createElement('canvas')
      canvas.width = 24
      canvas.height = 24
      return new Promise<void>((resolve) => { canvas.toBlob((blob) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob!], 'focus.png', { type: 'image/png' }))
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }))
        resolve()
      }) })
    })
    await page.getByRole('button', { name: /移除图片/ }).waitFor()
    await mkdir('.artifacts/game-focus', { recursive: true })
    await page.screenshot({ path: '.artifacts/game-focus/connected.png' })
    await state('disconnected')
    await page.locator('[data-game-focus]').waitFor({ state: 'detached' })
    await page.setViewportSize({ width: 1280, height: 1000 })
    expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true)
    expect(await input.inputValue()).toBe('Keep this draft')
    expect(await page.getByRole('navigation', { name: '应用菜单' }).isVisible()).toBe(true)
    expect(await page.getByText('开始打造新想法', { exact: true }).isVisible()).toBe(true)
    expect(consoleWatch.pageErrors).toEqual([])
  })

  it('edits an existing annotation without a captured frame and persists the description', async () => {
    onTestFailed(async () => {
      await mkdir('.artifacts/game-focus', { recursive: true })
      await page.screenshot({ path: '.artifacts/game-focus/edit-failed.png' })
      await writeFile('.artifacts/game-focus/edit-failed.txt', await page.locator('body').innerText())
    })
    const sessionId = SessionId('game-annotation-edit')
    const workspaces = await scaffold.ctx.apiProxy.workspace.list({ rpcId: 'annotation-workspaces' as never, payload: {} })
    if (!workspaces.result.ok) throw new Error(workspaces.result.error.message)
    const workspace = workspaces.result.value.items[0]!
    const history = await readFile(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url), 'utf8')
    await seedSession({ ...scaffold, workspaceCwd: workspace.path }, history, sessionId)
    const created = await scaffold.ctx.apiProxy.sessions.create({
      rpcId: 'annotation-create' as never,
      payload: { sessionId, workspaceId: workspace.workspaceId },
    })
    expect(created.result).toMatchObject({ ok: true })
    const renamed = await scaffold.ctx.apiProxy.sessions.rename({
      rpcId: 'annotation-title' as never,
      payload: { sessionId, title: 'Annotation editing' },
    })
    expect(renamed.result.ok).toBe(true)
    const annotation = {
      sessionId, id: 'annotation-a', label: 'A', createdAt: 1,
      shape: { type: 'point' as const, geometry: { x: 0.25, y: 0.5 } },
      description: 'Original description',
    }
    const seeded = await scaffold.ctx.apiProxy.sessions.annotate!({
      rpcId: 'annotation-seed' as never,
      payload: { sessionId, annotations: [annotation] },
    })
    expect(seeded.result.ok).toBe(true)
    await page.getByRole('treeitem', { name: /Annotation editing/ }).click()
    await page.getByRole('button', { name: /1 条标注/ }).hover()
    await page.getByText('Original description', { exact: true }).waitFor()
    expect(await page.getByAltText('Minecraft 标注截图').count()).toBe(0)
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    const description = page.getByRole('dialog', { name: '编辑游戏标注' }).getByRole('textbox')
    await description.fill('Updated through the browser')
    await page.getByRole('button', { name: '保存标注', exact: true }).click()
    await page.getByRole('dialog', { name: '编辑游戏标注' }).waitFor({ state: 'detached' })
    await page.getByText('Updated through the browser', { exact: true }).waitFor()
    await expect.poll(async () => (await scaffold.ctx.sessionPersistence.inspect(sessionId)).events
      .filter(event => event.type === 'game/annotations').at(-1)?.data.annotations)
      .toEqual([{ ...annotation, description: 'Updated through the browser' }])
    await state('connected')
    await page.locator('[data-game-focus]').waitFor()
    await page.evaluate(() => { window.dispatchEvent(new Event('test-annotation-shortcut')) })
    await page.getByRole('button', { name: /2 条标注/ }).hover()
    await page.getByText('Native shortcut annotation', { exact: true }).waitFor()
    await page.getByAltText('Minecraft 标注截图', { exact: true }).waitFor()
    await page.getByRole('button', { name: '查看标注截图', exact: true }).click()
    await page.getByRole('dialog', { name: '标注截图预览' }).waitFor()
    await page.getByRole('button', { name: '关闭截图' }).click()
    await page.setViewportSize({ width: 480, height: 800 })
    await page.getByRole('button', { name: /2 条标注/ }).hover()
    await visibleInViewport(page.locator('[data-annotation-items]'))
    await page.screenshot({ path: '.artifacts/game-focus/annotation-hover.png' })
    await page.mouse.move(450, 85)
    await page.locator('[data-composer-card] textarea').focus()
    await page.screenshot({ path: '.artifacts/game-focus/annotation-chip.png' })
    await expect.poll(async () => (await scaffold.ctx.sessionPersistence.inspect(sessionId)).events
      .filter(event => event.type === 'game/annotations').at(-1)?.data.annotations.at(-1)?.screenshotRef)
      .toBeTruthy()
    await state('disconnected')
    expect(consoleWatch.pageErrors).toEqual([])
  }, 60_000)
  it('measures companion layout and interaction without remounting the composer', async () => {
    const sessionId = SessionId('game-annotation-edit')
    const density = await scaffold.ctx.apiProxy.sessions.annotate!({
      rpcId: 'annotation-density' as never,
      payload: { sessionId, annotations: Array.from({ length: 20 }, (_, index) => ({
        sessionId, id: `density-${index}`, label: String.fromCharCode(65 + index), createdAt: index,
        shape: { type: 'point' as const, geometry: { x: .25, y: .5 } },
        description: index === 0 ? '检查这个方块的材质与名称' : `标注 ${index + 1}：检查方块的显示效果`,
      })) },
    })
    expect(density.result).toMatchObject({ ok: true })
    await page.setViewportSize({ width: 1280, height: 1000 })
    await page.reload()
    await page.getByRole('treeitem', { name: /Annotation editing/ }).click()
    await state('connected')
    await page.getByRole('button', { name: /20 条标注/ }).waitFor()
    const input = page.locator('[data-composer-card] textarea')
    const identity = await input.elementHandle()
    const baseline = process.env.COMPANION_BASELINE === '1'
    const output = `.artifacts/annotation-composer-${baseline ? 'before' : 'after'}`
    await mkdir(output, { recursive: true })
    const layouts = []
    const cdp = await page.context().newCDPSession(page)
    for (const height of [600, 800]) for (const width of [360, 480, 640]) for (const scale of [1, 1.25, 1.5]) {
      await page.setViewportSize({ width, height })
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect.poll(async () => (await page.locator('[data-game-status]').boundingBox())?.width).toBeGreaterThanOrEqual(width - 1)
      await visibleInViewport(input)
      const layout = await page.locator('[data-game-status]').evaluate((element) => {
        const box = element.getBoundingClientRect()
        let parent = element.parentElement!
        while (getComputedStyle(parent).display === 'contents') parent = parent.parentElement!
        return { height: box.height, parentHeight: parent.clientHeight, scrollWidth: element.scrollWidth, width: box.width,
          heightRule: getComputedStyle(element).height, maxHeight: getComputedStyle(element).maxHeight,
          overflow: getComputedStyle(element).overflow, flex: getComputedStyle(element).flex }
      })
      layouts.push({ viewportWidth: width, scale, ...layout })
      if (!baseline) {
        expect(layout.height).toBeLessThanOrEqual(layout.parentHeight * .35 + 1)
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1)
      }
      await page.screenshot({ path: `${output}/${width}-${height}-${scale}.png` })
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride')
    await page.setViewportSize({ width: 480, height: 800 })
    const timings = await page.evaluate(async () => {
      const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const samples: Record<string, number[]> = { input: [], scroll: [], collapse: [] }
      const input = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')!
      const list = document.querySelector<HTMLElement>('[aria-label="游戏标注上下文"]')!
      for (let i = 0; i < 30; i++) {
        const disclosure = list.querySelector<HTMLButtonElement>('button[aria-expanded]')
        if (disclosure?.getAttribute('aria-expanded') === 'false') { disclosure.click(); await paint() }
        let start = performance.now()
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, `响应测试 ${i}`)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await paint(); samples.input!.push(performance.now() - start)
        start = performance.now()
        const scroller = list.querySelector<HTMLElement>('[data-annotation-items]') ?? list
        scroller.scrollTop = i % 2 ? 0 : scroller.scrollHeight
        await paint(); samples.scroll!.push(performance.now() - start)
        const toggle = list.querySelector<HTMLButtonElement>('button[aria-expanded]')
        if (toggle) { start = performance.now(); toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await paint(); samples.collapse!.push(performance.now() - start) }
      }
      return samples
    })
    await writeFile(`${output}/measurements.json`, JSON.stringify({ layouts, timings }, null, 2))
    expect(await identity!.evaluate(element => element.isConnected)).toBe(true)
    expect(await input.inputValue()).toBe('响应测试 29')
    if (!baseline) for (const samples of Object.values(timings)) {
      expect(samples).toHaveLength(30)
      expect([...samples].sort((a, b) => a - b)[28]).toBeLessThanOrEqual(100)
    }
    await page.screenshot({ path: `${output}/collapsed.png` })
    if (!baseline) {
      await page.setViewportSize({ width: 360, height: 600 })
      await page.getByRole('button', { name: /20 条标注/ }).click()
      await page.getByRole('button', { name: '编辑', exact: true }).first().click()
      const editor = page.getByRole('dialog', { name: '编辑游戏标注' }).getByRole('textbox')
      await editor.fill('保留草稿，取消后不保存')
      await visibleInViewport(editor)
      await editor.press('Escape')
      expect(await page.getByRole('dialog', { name: '编辑游戏标注' }).count()).toBe(0)
      expect(await input.inputValue()).toBe('响应测试 29')
    }
    await cdp.detach()
  }, 90_000)

})
