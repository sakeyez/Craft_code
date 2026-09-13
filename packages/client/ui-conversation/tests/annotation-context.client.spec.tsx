// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnnotationContext } from '../src/client/skeleton/AnnotationContext.tsx'
import type { GameAnnotation } from '@deepseek-ai/dsh-session/types'
const annotation: GameAnnotation = {
  id: 'annotation-a', sessionId: 'session' as never, label: 'A',
  shape: { type: 'point', geometry: { x: .5, y: .5 } }, description: 'Original description', createdAt: 1,
}
function mountContext(options: { annotations?: GameAnnotation[]; annotate?: (items: GameAnnotation[]) => Promise<void> } = {}) {
  const annotate = vi.fn(options.annotate ?? (async () => {}))
  const beginAnnotation = vi.fn()
  const props = { sessionId: 'session' as never, locked: false,
    useSession: ((selector: (value: unknown) => unknown) => selector({ annotations: options.annotations ?? [] })) as never,
    useSessions: (() => undefined) as never, useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never, useInput: (() => undefined) as never, inputActions: {} as never,
    save: annotate, resolveImage: async () => 'data:image/jpeg;base64,eA==',
  }
  const view = render(<AnnotationContext {...props} />)
  if (options.annotations?.length) fireEvent.focus(view.getByRole('button', { name: /条标注/ }))
  return { ...view, annotate, beginAnnotation }
}
afterEach(cleanup)
describe('composer game annotations', () => {
  it('renders nothing without annotations', () => { expect(mountContext().container.textContent).toBe('') })
  it('shows details on hover and dismisses with Escape', () => {
    const view = mountContext({ annotations: [annotation] })
    fireEvent.keyDown(view.getByRole('button', { name: /条标注/ }), { key: 'Escape' })
    expect(view.queryByText('Original description')).toBeNull()
    fireEvent.mouseEnter(view.getByRole('region', { name: '游戏标注上下文' }))
    expect(view.getByText('Original description')).toBeTruthy()
    fireEvent.mouseLeave(view.getByRole('region', { name: '游戏标注上下文' }))
    expect(view.queryByText('Original description')).toBeNull()
  })
  it('edits and saves an existing description without capturing the game', async () => {
    const view = mountContext({ annotations: [annotation] })
    fireEvent.click(view.getByRole('button', { name: '编辑' }))
    const input = view.getByRole('textbox', { name: '标注说明' }) as HTMLTextAreaElement
    expect(input.value).toBe('Original description')
    fireEvent.change(input, { target: { value: 'Updated description' } })
    fireEvent.click(view.getByRole('button', { name: '保存标注' }))
    await waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })
    expect(view.annotate).toHaveBeenCalledWith([{ ...annotation, description: 'Updated description' }])
    expect(view.beginAnnotation).not.toHaveBeenCalled()
  })

  it('keeps an edited description after a failed save and allows retry', async () => {
    let attempt = 0
    const view = mountContext({ annotations: [annotation], annotate: async () => { if (attempt++ === 0) throw new Error('save failed') } })
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
    const view = mountContext({ annotations: [annotation] })
    fireEvent.click(view.getByRole('button', { name: '编辑' }))
    fireEvent.change(view.getByRole('textbox'), { target: { value: 'Discard me' } })
    fireEvent.click(view.getByRole('button', { name: '取消' }))
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.annotate).not.toHaveBeenCalled()
  })

  it('reports a refused deletion and keeps the annotation available', async () => {
    const view = mountContext({ annotations: [annotation], annotate: async () => { throw new Error('delete failed') } })
    fireEvent.click(view.getByRole('button', { name: '删除标注 A' }))
    expect(await view.findByText('delete failed')).toBeTruthy()
    expect(view.getByText('Original description')).toBeTruthy()
    expect(view.annotate).toHaveBeenCalledWith([])
  })

})
