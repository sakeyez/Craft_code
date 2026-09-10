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
  beginAnnotation?: GameWorkspaceProps['beginAnnotation']
  endAnnotation?: GameWorkspaceProps['endAnnotation']
  reposition?: GameWorkspaceProps['reposition']
  annotations?: GameAnnotation[]
  annotate?: GameWorkspaceProps['annotate']
} = {}) {
  const beginAnnotation = vi.fn<GameWorkspaceProps['beginAnnotation']>(options.beginAnnotation ?? (() => new Promise<void>(() => {})))
  const endAnnotation = vi.fn<GameWorkspaceProps['endAnnotation']>(options.endAnnotation ?? (async () => {}))
  const reposition = vi.fn<GameWorkspaceProps['reposition']>(options.reposition ?? (async () => {}))
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
    reconnect: vi.fn(async () => ({ status: 'reconnecting' as const })),
    beginAnnotation,
    endAnnotation,
    reposition,
  } satisfies GameWorkspaceProps
  return { ...render(<GameWorkspace {...props} />), beginAnnotation, endAnnotation, reposition, annotate }
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
  const annotation: GameAnnotation = {
    id: 'annotation-a', sessionId: 'session' as never, label: 'A',
    shape: { type: 'point', geometry: { x: 0.5, y: 0.5 } }, description: 'Original description', createdAt: 1,
  }

  it('edits and saves an existing description without capturing the game', async () => {
    const view = mountWorkspace({ annotations: [annotation] })
    fireEvent.click(view.getByRole('button', { name: '编辑' }))
    const input = view.getByRole('textbox', { name: '请描述这里需要修改什么' }) as HTMLTextAreaElement
    expect(input.value).toBe('Original description')
    fireEvent.change(input, { target: { value: 'Updated description' } })
    fireEvent.click(view.getByRole('button', { name: '保存标注' }))
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    expect(view.annotate).toHaveBeenCalledWith([{ ...annotation, description: 'Updated description' }])
    expect(view.beginAnnotation).not.toHaveBeenCalled()
  })

  it('keeps an edited description after a failed save and allows retry', async () => {
    let attempt = 0
    const view = mountWorkspace({ annotations: [annotation], annotate: async () => { if (attempt++ === 0) throw new Error('save failed') } })
    fireEvent.click(view.getByRole('button', { name: '编辑' }))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Retry description' } })
    fireEvent.click(view.getByRole('button', { name: '保存标注' }))
    expect(await view.findByText('save failed')).toBeTruthy()
    expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Retry description')
    fireEvent.click(view.getByRole('button', { name: '保存标注' }))
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    expect(view.queryByText('save failed')).toBeNull()
  })

  it('cancels an existing description edit without persisting it', () => {
    const view = mountWorkspace({ annotations: [annotation] })
    fireEvent.click(view.getByRole('button', { name: '编辑' }))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Discard me' } })
    fireEvent.click(view.getByRole('button', { name: '取消' }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.annotate).not.toHaveBeenCalled()
  })

  it('reports a refused deletion and keeps the annotation available', async () => {
    const view = mountWorkspace({ annotations: [annotation], annotate: async () => { throw new Error('delete failed') } })
    fireEvent.click(view.getByRole('button', { name: '删除标注 A' }))
    expect(await view.findByText('delete failed')).toBeTruthy()
    expect(view.getByText('Original description')).toBeTruthy()
    expect(view.annotate).toHaveBeenCalledWith([])
  })

  it('renders an external-window companion status without a black game surface', async () => {
    const view = mountWorkspace()
    expect(view.getByText('已连接')).toBeTruthy()
    expect(view.getByRole('button', { name: '重新定位面板' })).toBeTruthy()
  })

  it('repositions the selected project and clears a failed attempt on retry', async () => {
    let attempt = 0
    const view = mountWorkspace({ reposition: async () => { if (attempt++ === 0) throw new Error('position failed') } })
    fireEvent.click(view.getByRole('button', { name: '重新定位面板' }))
    expect(await view.findByText('position failed')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '重新定位面板' }))
    await waitFor(() => { expect(view.queryByText('position failed')).toBeNull() })
    expect(view.reposition).toHaveBeenCalledWith('C:\\Projects\\Example')
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
    expect((view.getByRole('button', { name: '编辑' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: '删除标注 A' }) as HTMLButtonElement).disabled).toBe(true)
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
