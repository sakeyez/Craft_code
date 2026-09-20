/** Real shipped UI and host filesystem/RPC composition; this does not launch Minecraft. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-mc-workbench'
import { zipSync, strToU8 } from 'fflate'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh, ZH_BROWSER_LOCALE } from './support.ts'

describe('Minecraft workbench assembled browser', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(process.cwd(), 'packages/bundle/mcmod/cordis.patch.yml'),
    })
    const cwd = scaffold.workspaceCwd
    await mkdir(join(cwd, 'src/main/resources'), { recursive: true })
    await mkdir(join(cwd, 'gradle/wrapper'), { recursive: true })
    await writeFile(join(cwd, 'settings.gradle'), 'rootProject.name = "workbench"\n')
    await writeFile(
      join(cwd, 'build.gradle'),
      'plugins { id "fabric-loom" version "1.7.4" }\ndependencies { minecraft "com.mojang:minecraft:1.21.1" }\n',
    )
    await writeFile(
      join(cwd, 'gradle/wrapper/gradle-wrapper.properties'),
      'distributionUrl=https://services.gradle.org/distributions/gradle-8.8-bin.zip\n',
    )
    await writeFile(
      join(cwd, 'src/main/resources/fabric.mod.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'workbench',
        version: '1.0.0',
        depends: { minecraft: '1.21.1' },
      }),
    )
    const id = randomUUID()
    const stamp = new Date().toISOString()
    await mkdir(join(cwd, '.dsh/runs', id), { recursive: true })
    await writeFile(
      join(cwd, '.dsh/runs', id, 'state.json'),
      JSON.stringify({
        id,
        cwd,
        action: 'build',
        phase: 'failed',
        startedAt: stamp,
        updatedAt: stamp,
        message: '测试保留的失败日志',
        logPath: `.dsh/runs/${id}/output.log`,
      }),
    )
    await writeFile(join(cwd, '.dsh/runs', id, 'output.log'), '[构建] 中文日志\nERROR fixture failure\n')
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    consoleWatch = watchConsole(page)
    // Only the Electron boundary is stubbed; menus, slots and workbench use shipped plugins.
    await page.addInitScript(() => {
      const noop = async () => {}
      const unsubscribe = () => () => {}
      Object.assign(window, { craftCodeDesktop: {
        menuPresentation: 'web', onMenuAction: (listener: (action: string) => void) => {
          const receive = (event: Event) => { listener((event as CustomEvent<string>).detail) }
          window.addEventListener('test-menu-action', receive)
          return () => { window.removeEventListener('test-menu-action', receive) }
        }, onGameEvent: unsubscribe,
        onMaximizedChange: unsubscribe, openMenu: noop, minimizeWindow: noop,
        toggleMaximizeWindow: noop, closeWindow: noop, isMaximized: async () => false,
        setActiveProject: noop,
        invokeProjectCommand: async () => ({ ok: true, title: '', message: '' }),
      } })
    })
    await page.goto(scaffold.baseUrl)
    await connectFreshWorkspaceZh(page, cwd, '.')
  }, 120_000)
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps project navigation in the menu row with accessible window controls', async () => {
    const menu = page.getByRole('menuitem', { name: '项目', exact: true })
    const code = page.getByRole('tab', { name: '代码', exact: true })
    await menu.waitFor()
    await code.waitFor()
    expect(await page.getByRole('menuitem').allTextContents()).toEqual(['项目', 'Git', '帮助'])
    expect(await page.getByRole('tab', { name: '对话', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '查看日志', exact: true }).count()).toBe(0)
    for (const width of [1440, 800]) {
      await page.setViewportSize({ width, height: 1000 })
      const menuBox = await menu.boundingBox()
      const codeBox = await code.boundingBox()
      const closeBox = await page.getByRole('button', { name: '关闭窗口' }).boundingBox()
      expect(menuBox).not.toBeNull()
      expect(codeBox).not.toBeNull()
      expect(closeBox).not.toBeNull()
      expect(Math.abs(menuBox!.y + menuBox!.height / 2 - codeBox!.y - codeBox!.height / 2)).toBeLessThan(2)
      expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(width)
      await page.getByRole('tab', { name: '游戏测试', exact: true }).click()
      await page.getByRole('heading', { name: '游戏测试', exact: true }).waitFor()
      await page.getByRole('treeitem', { selected: true }).click()
      expect(await page.getByRole('heading', { name: '游戏测试', exact: true }).isVisible()).toBe(false)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await mkdir('.artifacts/mc-workbench', { recursive: true })
    await page.screenshot({ path: '.artifacts/mc-workbench/topbar.png' })
  })

  it('retains logs, edits through local Monaco and rejects an external save conflict', async () => {
    try {
      await page.getByRole('tab', { name: '游戏测试', exact: true }).click()
      await page.getByRole('heading', { name: '游戏测试', exact: true }).waitFor()
      await expect
        .poll(() => page.getByLabel('运行日志', { exact: true }).textContent())
        .toContain('中文日志')
      expect(await page.getByRole('button', { name: '一键准备环境' }).isEnabled()).toBe(true)
      await page.getByRole('tab', { name: '代码', exact: true }).click()
      await page.getByRole('button', { name: 'settings.gradle', exact: true }).click()
      const frame = page.frameLocator('iframe[title="代码编辑器"]')
      await frame.locator('.monaco-editor').first().waitFor({ timeout: 30_000 })
      await frame.locator('.view-lines').first().click()
      await page.keyboard.press('Control+End')
      await page.keyboard.type('// draft')
      await page.getByRole('treeitem', { selected: true }).click()
      await page.getByRole('tab', { name: '代码', exact: true }).click()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect
        .poll(() => readFile(join(scaffold.workspaceCwd, 'settings.gradle'), 'utf8'))
        .toContain('// draft')
      await writeFile(join(scaffold.workspaceCwd, 'settings.gradle'), '// external edit\n')
      await frame.locator('.view-lines').first().click()
      await page.keyboard.type(' conflict')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect
        .poll(() => page.getByRole('alert').allTextContents())
        .toContainEqual(expect.stringMatching(/变化|修改|冲突/u))
      expect(await readFile(join(scaffold.workspaceCwd, 'settings.gradle'), 'utf8')).toBe(
        '// external edit\n',
      )
      await page.getByRole('tab', { name: '游戏测试', exact: true }).click()
      expect(await page.getByLabel('运行日志', { exact: true }).textContent()).toContain('中文日志')
      await mkdir('.artifacts/mc-workbench', { recursive: true })
      await page.screenshot({ path: '.artifacts/mc-workbench/test-page.png' })
      expect(consoleWatch.pageErrors).toEqual([])
    } catch (error) {
      await mkdir('.artifacts/mc-workbench', { recursive: true })
      await page.screenshot({ path: '.artifacts/mc-workbench/failure.png' })
      await writeFile('.artifacts/mc-workbench/failure.txt', await page.locator('body').innerText())
      throw error
    }
  }, 90_000)

  it('offers independent development controls without an IDE connection or dead network action', async () => {
    await page.getByRole('tab', { name: '游戏测试', exact: true }).click()
    expect(await page.getByRole('button', { name: '网络设置', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '连接 IDEA', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: '启动客户端', exact: true }).isEnabled()).toBe(true)
    expect(await page.getByRole('button', { name: '构建', exact: true }).isEnabled()).toBe(true)
    expect(await page.getByLabel('测试模式', { exact: true }).inputValue()).toBe('development')
    expect(consoleWatch.pageErrors).toEqual([])
  })

  it('previews dependency changes and browses associated sources as read-only', async () => {
    const cwd = scaffold.workspaceCwd
    const jar = join(cwd, 'fixture.jar')
    const sources = join(cwd, 'fixture-sources.jar')
    await writeFile(jar, zipSync({ 'fabric.mod.json': strToU8(JSON.stringify({ schemaVersion: 1, id: 'fixture', name: 'Fixture Mod', version: '1.0.0' })) }))
    await writeFile(sources, zipSync({ 'Fixture.java': strToU8('public class Fixture {}') }))
    await page.getByRole('tab', { name: '前置与联动', exact: true }).click()
    await page.getByLabel('依赖来源', { exact: true }).selectOption('local')
    await page.getByLabel('依赖关系', { exact: true }).selectOption('optional')
    await page.getByLabel('本地 JAR 路径').fill(jar)
    await page.getByRole('button', { name: '预览加入项目' }).click()
    await page.getByRole('heading', { name: '确认依赖变更' }).waitFor()
    expect(await readFile(join(cwd, 'build.gradle'), 'utf8')).not.toContain('.dsh/dependencies.gradle')
    await page.getByRole('button', { name: '应用变更' }).click()
    await page.getByLabel('Fixture Mod 的关系').waitFor()
    expect(await readFile(join(cwd, '.dsh/dependencies.gradle'), 'utf8')).toContain('modLocalRuntime')
    await page.getByLabel('测试时安装', { exact: true }).click()
    await page.getByRole('button', { name: '应用变更' }).click()
    await expect.poll(() => readFile(join(cwd, '.dsh/dependencies.gradle'), 'utf8')).not.toContain('modLocalRuntime')
    page.once('dialog', (dialog) => { void dialog.accept(sources) })
    await page.getByRole('button', { name: '关联源码', exact: true }).click()
    await page.getByText('源码已就绪，请在代码页浏览。', { exact: true }).waitFor()
    await page.getByRole('tab', { name: '代码', exact: true }).click()
    await page.getByRole('button', { name: 'Fixture.java', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: '与磁盘比较', exact: true }).isDisabled()).toBe(true)
    expect(await page.getByRole('button', { name: '保存', exact: true }).isDisabled()).toBe(true)
    expect(consoleWatch.pageErrors).toEqual([])
  }, 60_000)
  it('keeps artifact mode compact and restores revision-checked project files from the menu', async () => {
    await page.getByRole('tab', { name: '游戏测试', exact: true }).click()
    const mode = page.getByLabel('测试模式', { exact: true })
    await mode.selectOption('artifact')
    await page.setViewportSize({ width: 800, height: 800 })
    expect(await mode.inputValue()).toBe('artifact')
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-menu-action', { detail: 'project:checkpoints' })))
    const dialog = page.getByRole('dialog', { name: '恢复点', exact: true })
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '创建恢复点', exact: true }).click()
    await dialog.getByText('手动恢复点', { exact: false }).waitFor()
    const saved = await readFile(join(scaffold.workspaceCwd, 'settings.gradle'), 'utf8')
    await writeFile(join(scaffold.workspaceCwd, 'settings.gradle'), '// recovery test')
    await dialog.getByRole('button', { name: '查看差异' }).first().click()
    await dialog.getByText('修改 · settings.gradle', { exact: true }).click()
    expect(await dialog.locator('details').filter({ hasText: '修改 · settings.gradle' }).getByLabel('当前内容').textContent()).toContain('// recovery test')
    await page.screenshot({ path: '.artifacts/mc-workbench/recovery.png' })
    await dialog.getByRole('button', { name: '保存当前状态并恢复' }).click()
    await expect.poll(() => readFile(join(scaffold.workspaceCwd, 'settings.gradle'), 'utf8')).toBe(saved)
    await page.keyboard.press('Escape')
    expect(await dialog.isVisible()).toBe(false)
    expect(consoleWatch.pageErrors).toEqual([])
  })

})
