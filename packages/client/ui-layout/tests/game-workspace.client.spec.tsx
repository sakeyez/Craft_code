// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameWorkspace, type GameWorkspaceProps } from '../src/client/GameWorkspace.tsx'

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void { void this.callback }
  disconnect(): void {}
  unobserve(): void {}
}

function mountWorkspace(options: {
  beginAnnotation?: GameWorkspaceProps['beginAnnotation']
  endAnnotation?: GameWorkspaceProps['endAnnotation']
  reposition?: GameWorkspaceProps['reposition']
} = {}) {
  const beginAnnotation = vi.fn(options.beginAnnotation ?? (async () => ({ dataUrl: 'data:image/jpeg;base64,AA==', width: 800, height: 600 })))
  const endAnnotation = vi.fn(options.endAnnotation ?? (async () => {}))
  const reposition = vi.fn(options.reposition ?? (async () => {}))
  const props = {
    cwd: 'C:\\Projects\\Example',
    state: { status: 'connected', surfaceKind: 'external-window' } as const,
    sessionId: 'session' as never,
    useSession: ((selector: (snapshot: { annotations: never[] }) => unknown) => selector({ annotations: [] })) as never,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => undefined) as never,
    inputActions: {} as never,
    annotate: vi.fn(async () => {}),
    reconnect: vi.fn(async () => ({ status: 'reconnecting' as const })),
    beginAnnotation,
    endAnnotation,
    reposition,
  } satisfies GameWorkspaceProps
  return { ...render(<GameWorkspace {...props} />), beginAnnotation, endAnnotation, reposition }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => { callback(0) }, 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { clearTimeout(handle) })
  Element.prototype.getBoundingClientRect = () => ({
    x: 100, y: 50, left: 100, top: 50, right: 900, bottom: 650,
    width: 800, height: 600, toJSON: () => ({}),
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('GameWorkspace companion panel', () => {
  it('renders an external-window companion status without a black game surface', async () => {
    const view = mountWorkspace()
    expect(view.getByText(/独立窗口运行/)).toBeTruthy()
    expect(view.getByRole('button', { name: '重新定位面板' })).toBeTruthy()
  })

  it('uses a bounded still image during annotation and restores the HWND on exit', async () => {
    const view = mountWorkspace()
    fireEvent.click(view.getByRole('button', { name: '标注 Minecraft 窗口' }))
    expect(await view.findByAltText('Minecraft 标注截图')).toBeTruthy()
    expect(view.beginAnnotation).toHaveBeenCalledWith('C:\\Projects\\Example')
    fireEvent.click(view.getByRole('button', { name: '退出标注' }))
    await waitFor(() => { expect(view.endAnnotation).toHaveBeenCalledWith('C:\\Projects\\Example') })
  })

  it('restores the HWND when capture fails or the component unmounts', async () => {
    const failed = mountWorkspace({ beginAnnotation: async () => { throw new Error('capture failed') } })
    fireEvent.click(failed.getByRole('button', { name: '标注 Minecraft 窗口' }))
    expect(await failed.findByText('capture failed')).toBeTruthy()
    expect(failed.endAnnotation).toHaveBeenCalledWith('C:\\Projects\\Example')
    failed.unmount()

    const active = mountWorkspace()
    fireEvent.click(active.getByRole('button', { name: '标注 Minecraft 窗口' }))
    await active.findByAltText('Minecraft 标注截图')
    active.unmount()
    expect(active.endAnnotation).toHaveBeenCalledWith('C:\\Projects\\Example')
  })
})
