import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopMenuBarInjected, DesktopMenuId } from './contract.ts'
import css from './DesktopMenuBar.module.css'

type DesktopMenuBarProps = PropsRuntime<'shell.topbar'> & InjectFace<DesktopMenuBarInjected>

function MinimizeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" /></svg>
}

function MaximizeIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><rect x="3.25" y="3.25" width="9.5" height="9.5" fill="none" stroke="currentColor" strokeWidth="1.35" /></svg>
}

function RestoreIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="M5.25 5.25h7.5v7.5h-7.5zM3.25 10.75v-7.5h7.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="miter" /></svg>
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="square" /></svg>
}

const MENUS: readonly { id: DesktopMenuId; label: string }[] = [
  { id: 'project', label: '项目' },
  { id: 'editor', label: '编辑' },
  { id: 'git', label: 'Git' },
  { id: 'help', label: '帮助' },
]

/** Theme-aware top-level controls backed by Electron's native submenus. */
export function DesktopMenuBar({ openMenu, windowControls }: DesktopMenuBarProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const [focusIndex, setFocusIndex] = useState(0)
  const [expanded, setExpanded] = useState<DesktopMenuId>()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (windowControls === undefined) return
    let active = true
    void windowControls.isMaximized().then((value) => {
      if (active) setMaximized(value)
    }).catch(() => {})
    const dispose = windowControls.onMaximizedChange(setMaximized)
    return () => {
      active = false
      dispose()
    }
  }, [windowControls])

  const moveFocus = useCallback((index: number): void => {
    const next = (index + MENUS.length) % MENUS.length
    setFocusIndex(next)
    buttons.current[next]?.focus()
  }, [])

  const showMenu = useCallback(async (
    menu: DesktopMenuId,
    index: number,
    button: HTMLButtonElement,
  ): Promise<void> => {
    if (expanded !== undefined) return
    const rect = button.getBoundingClientRect()
    setFocusIndex(index)
    setExpanded(menu)
    try {
      await openMenu(menu, { x: Math.round(rect.left), y: Math.round(rect.bottom) })
    } catch {
      // The native side owns diagnostics; the renderer only restores UI state.
    } finally {
      setExpanded(undefined)
      buttons.current[index]?.focus()
    }
  }, [expanded, openMenu])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, menu: DesktopMenuId, index: number): void => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(index - 1)
        return
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(index + 1)
        return
      case 'Home':
        event.preventDefault()
        moveFocus(0)
        return
      case 'End':
        event.preventDefault()
        moveFocus(MENUS.length - 1)
        return
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault()
        void showMenu(menu, index, event.currentTarget)
        return
    }
  }, [moveFocus, showMenu])

  const invokeWindowControl = useCallback((action: () => Promise<void>): void => {
    void action().catch(() => {})
  }, [])

  return (
    <nav
      className={css.menuBar}
      aria-label="应用菜单"
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && windowControls !== undefined) {
          invokeWindowControl(windowControls.toggleMaximize)
        }
      }}
    >
      <div className={css.menuItems} role="menubar">
        {MENUS.map((menu, index) => (
          <button
            key={menu.id}
            ref={(node) => { buttons.current[index] = node }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={expanded === menu.id}
            className={css.menuButton}
            tabIndex={focusIndex === index ? 0 : -1}
            onFocus={() => { setFocusIndex(index) }}
            onClick={(event) => { void showMenu(menu.id, index, event.currentTarget) }}
            onKeyDown={(event) => { onKeyDown(event, menu.id, index) }}
          >
            {menu.label}
          </button>
        ))}
      </div>
      {windowControls !== undefined && (
        <div className={css.windowControls} aria-label="窗口控制">
          <button
            type="button"
            className={css.windowButton}
            aria-label="最小化窗口"
            data-window-control="minimize"
            onClick={() => { invokeWindowControl(windowControls.minimize) }}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            className={css.windowButton}
            aria-label={maximized ? '还原窗口' : '最大化窗口'}
            data-window-control="maximize"
            onClick={() => { invokeWindowControl(windowControls.toggleMaximize) }}
          >
            {maximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
          <button
            type="button"
            className={`${css.windowButton} ${css.closeButton}`}
            aria-label="关闭窗口"
            data-window-control="close"
            onClick={() => { invokeWindowControl(windowControls.close) }}
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </nav>
  )
}
