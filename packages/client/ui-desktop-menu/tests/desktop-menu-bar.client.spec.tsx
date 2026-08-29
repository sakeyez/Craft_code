// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopMenuBar } from '../src/client/DesktopMenuBar.tsx'

const runtimeProps = {
  useSessions: (() => undefined) as never,
  useWorkspaces: (() => undefined) as never,
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(cleanup)

describe('DesktopMenuBar', () => {
  it('renders the four product menus with one roving tab stop', () => {
    const view = render(<DesktopMenuBar {...runtimeProps} openMenu={vi.fn(async () => {})} />)
    const items = view.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual(['项目', '编辑', 'Git', '帮助'])
    expect(items.map(item => item.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
  })

  it('opens below the clicked button and restores focus after the native menu closes', async () => {
    const pending = deferred()
    const openMenu = vi.fn(() => pending.promise)
    const view = render(<DesktopMenuBar {...runtimeProps} openMenu={openMenu} />)
    const project = view.getByRole('menuitem', { name: '项目' })
    project.getBoundingClientRect = () => ({
      x: 4, y: 0, left: 4, top: 0, right: 48, bottom: 40, width: 44, height: 40, toJSON: () => ({}),
    })
    fireEvent.click(project)
    expect(openMenu).toHaveBeenCalledWith('project', { x: 4, y: 40 })
    expect(project.getAttribute('aria-expanded')).toBe('true')
    await act(async () => { pending.resolve(); await pending.promise })
    expect(project.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(project)
  })

  it('moves focus with arrows and opens the focused menu from the keyboard', () => {
    const openMenu = vi.fn(async () => {})
    const view = render(<DesktopMenuBar {...runtimeProps} openMenu={openMenu} />)
    const project = view.getByRole('menuitem', { name: '项目' })
    const editor = view.getByRole('menuitem', { name: '编辑' })
    project.focus()
    fireEvent.keyDown(project, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(editor)
    expect(editor.getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    expect(openMenu).toHaveBeenCalledWith('editor', expect.objectContaining({ y: 0 }))
  })

  it('renders compact window controls and forwards their actions', async () => {
    let maximizedListener: ((value: boolean) => void) | undefined
    const controls = {
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      isMaximized: vi.fn(async () => false),
      onMaximizedChange: vi.fn((listener: (value: boolean) => void) => {
        maximizedListener = listener
        return () => { maximizedListener = undefined }
      }),
    }
    const view = render(
      <DesktopMenuBar
        {...runtimeProps}
        openMenu={vi.fn(async () => {})}
        windowControls={controls}
      />,
    )
    expect(await view.findByRole('button', { name: '最小化窗口' })).toBeTruthy()
    const maximize = view.getByRole('button', { name: '最大化窗口' })
    fireEvent.click(view.getByRole('button', { name: '最小化窗口' }))
    fireEvent.click(maximize)
    fireEvent.click(view.getByRole('button', { name: '关闭窗口' }))
    expect(controls.minimize).toHaveBeenCalledOnce()
    expect(controls.toggleMaximize).toHaveBeenCalledOnce()
    expect(controls.close).toHaveBeenCalledOnce()
    act(() => { maximizedListener?.(true) })
    expect(view.getByRole('button', { name: '还原窗口' })).toBeTruthy()
  })
})
