import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps the annotation editor beside the selection and preserves commit/reset behavior', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } })
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => console.error(error.message))
    await page.addInitScript(() => {
      Object.assign(window, { gameAnnotation: {
        onBegin: (callback: (id: string) => void) => { Object.assign(window, { fixtureBegin: callback }) },
        onReset: (callback: (id: string) => void) => { Object.assign(window, { fixtureReset: callback }) },
        load: async () => {
          const canvas = document.createElement('canvas')
          canvas.width = 960; canvas.height = 640
          const context = canvas.getContext('2d')!
          context.fillStyle = '#b9d5e5'; context.fillRect(0, 0, 960, 360)
          context.fillStyle = '#72955c'; context.fillRect(0, 360, 960, 280)
          context.fillStyle = '#80674d'; context.fillRect(540, 300, 120, 120)
          return { labels: [], snapshot: { dataUrl: canvas.toDataURL('image/jpeg') } }
        },
        ready: async () => {}, cancel: async () => {},
        submit: async (_id: string, drafts: unknown[]) => { Object.assign(window, { committed: drafts }); return {} },
      } })
    })
    await page.goto(new URL('../../src/annotation.html', import.meta.url).href)
    await page.evaluate(() => { (window as unknown as { fixtureBegin: (id: string) => void }).fixtureBegin('test') })
    await page.waitForFunction(() => (document.getElementById('snapshot') as HTMLImageElement).naturalWidth > 0)
    await page.locator('#snapshot').evaluate(async (element) => { await (element as HTMLImageElement).decode() })
    await page.mouse.move(520, 280); await page.mouse.down(); await page.mouse.move(680, 430); await page.mouse.up()
    await page.locator('#description').fill('这个方块是什么？')
    const box = await page.locator('#editor').boundingBox()
    expect(box!.x).toBeGreaterThan(400)
    expect(box!.y).toBeGreaterThan(430)
    expect(box!.x + box!.width).toBeLessThanOrEqual(960)
    expect(await page.locator('#toolbar').evaluate(element => getComputedStyle(element).backdropFilter)).toBe('none')
    await mkdir('.artifacts/annotation-overlay', { recursive: true })
    await page.screenshot({ path: '.artifacts/annotation-overlay/editor.png' })
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await page.getByRole('button', { name: '完成并保存标注' }).click()
    expect(await page.evaluate(() => (window as unknown as { committed: unknown[] }).committed)).toMatchObject([{ description: '这个方块是什么？', shape: { type: 'rect' } }])
    await page.screenshot({ path: '.artifacts/annotation-overlay/marked.png' })
    await page.evaluate(() => { (window as unknown as { fixtureReset: (id: string) => void }).fixtureReset('test') })
    expect(await page.locator('.mark').count()).toBe(0)
    await page.setViewportSize({ width: 360, height: 480 })
    await page.evaluate(() => { (window as unknown as { fixtureBegin: (id: string) => void }).fixtureBegin('narrow') })
    await page.waitForFunction(() => (document.getElementById('snapshot') as HTMLImageElement).naturalWidth > 0)
    await page.locator('#snapshot').evaluate(async (element) => { await (element as HTMLImageElement).decode() })
    await page.mouse.click(352, 470)
    const narrow = await page.locator('#editor').boundingBox()
    expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(360)
    expect(narrow!.y + narrow!.height).toBeLessThanOrEqual(480)
    await page.locator('#description').press('Escape')
    expect(await page.locator('#editor').isVisible()).toBe(false)
  } finally { await browser.close() }
}, 30_000)
