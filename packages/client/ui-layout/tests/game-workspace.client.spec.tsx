// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameWorkspace, type GameWorkspaceProps } from '../src/client/GameWorkspace.tsx'
import type { GameAnnotation } from '@deepseek-ai/dsh-session/types'

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void { void this.callback }
  disconnect(): void {}
  unobserve(): void {}
}

function mountWorkspace(options: {
  bindAnnotationShortcut?: GameWorkspaceProps['bindAnnotationShortcut']
  beginAnnotation?: GameWorkspaceProps['beginAnnotation']
  endAnnotation?: GameWorkspaceProps['endAnnotation']
  annotations?: GameAnnotation[]
  annotate?: GameWorkspaceProps['annotate']
} = {}) {
  const beginAnnotation = vi.fn<GameWorkspaceProps['beginAnnotation']>(options.beginAnnotation ?? (() => new Promise<void>(() => {})))
  const endAnnotation = vi.fn<GameWorkspaceProps['endAnnotation']>(options.endAnnotation ?? (async () => {}))
  const annotate = vi.fn<NonNullable<GameWorkspaceProps['annotate']>>(options.annotate ?? (async () => {}))
  const props = {
    cwd: 'C:\\Projects\\Example',
    state: { status: 'connected', surfaceKind: 'external-window' } as const,
    sessionId: 'session' as never,
    useSession: ((selector: (snapshot: { annotations: GameAnnotation[] }) => unknown) =>
      selector({ annotations: options.annotations ?? [] })) as never,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => undefined) as never,
    inputActions: {} as never,
    annotate,
    ...(options.bindAnnotationShortcut ? { bindAnnotationShortcut: options.bindAnnotationShortcut } : {}),
    beginAnnotation,
    endAnnotation,
  } satisfies GameWorkspaceProps
  return { ...render(<GameWorkspace {...props} />), props, beginAnnotation, endAnnotation, annotate }
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

describe('GameWorkspace annotation controls', () => {
  const annotation: GameAnnotation = {
    id: 'annotation-a', sessionId: 'session' as never, label: 'A',
    shape: { type: 'point', geometry: { x: 0.5, y: 0.5 } }, description: 'Original description', createdAt: 1,
  }

  it('keeps saved annotations out of the game toolbar', () => {
    const view = mountWorkspace({ annotations: [annotation] })
    expect(view.queryByText('Original description')).toBeNull()
    expect(view.queryByText('在游戏上标注，将问题带入对话。')).toBeNull()
  })

  it('shows passive state without recovery controls', () => {
    const view = mountWorkspace()
    expect(view.queryByRole('button', { name: '重连' })).toBeNull()
    view.rerender(<GameWorkspace {...view.props} state={{ status: 'disconnected', error: 'Game closed' }} />)
    expect(view.getByText('Game closed')).toBeTruthy()
    expect(view.queryByRole('button', { name: '重连' })).toBeNull()
  })

  it('routes native shortcuts through the button transaction and disposes the subscription', async () => {
    let trigger: (error?: string) => void = () => {}
    const dispose = vi.fn()
    const view = mountWorkspace({ bindAnnotationShortcut: (_request, listener) => { trigger = listener; return dispose } })
    trigger('快捷键被占用')
    await waitFor(() => { expect(view.getByText('快捷键被占用')).toBeTruthy() })
    trigger(); trigger()
    await waitFor(() => { expect(view.beginAnnotation).toHaveBeenCalledTimes(1) })
    expect(view.beginAnnotation).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:\\Projects\\Example', sessionId: 'session' }))
    view.unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('renders external-window status without a black game surface', async () => {
    const view = mountWorkspace()
    expect(view.getByText('已连接')).toBeTruthy()
    expect(view.queryByRole('button', { name: '重新定位面板' })).toBeNull()
    expect(view.queryByRole('button', { name: '重连' })).toBeNull()
  })

  it('opens one overlay transaction and disables historical mutations without a sidebar image', async () => {
    const view = mountWorkspace({ annotations: [annotation] })
    fireEvent.click(view.getByRole('button', { name: '在游戏画面上标注' }))
    fireEvent.click(view.getByRole('button', { name: '在游戏画面上标注' }))
    expect(view.beginAnnotation).toHaveBeenCalledTimes(1)
    const firstCall = view.beginAnnotation.mock.calls[0]
    if (firstCall === undefined) throw new Error('annotation did not start')
    expect(firstCall[0]).toMatchObject({ cwd: 'C:\\Projects\\Example', sessionId: 'session', labels: ['A'] })
    expect(firstCall[0].operationId).toMatch(/^[0-9a-f-]{36}$/iu)
    expect(view.queryByRole('img')).toBeNull()
    view.unmount()
    expect(view.endAnnotation).toHaveBeenCalledWith(firstCall[0].operationId)
  })

  it('shows capture errors and enables retry after the transaction closes', async () => {
    const view = mountWorkspace({ beginAnnotation: async () => { throw new Error('capture failed') } })
    fireEvent.click(view.getByRole('button', { name: '在游戏画面上标注' }))
    expect(await view.findByText('capture failed')).toBeTruthy()
    expect((view.getByRole('button', { name: '在游戏画面上标注' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
