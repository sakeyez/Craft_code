// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { DesktopMenuSurface, hasUncommittedChanges } from '../src/client/DesktopMenuSurface.tsx'
import type {
  DesktopAction, DesktopCommandRequest, DesktopCommandResult, DesktopMenuEvent,
} from '../src/client/contract.ts'

class Source<T> {
  private listeners = new Set<() => void>()
  constructor(private snapshot: T) {}
  getSnapshot = (): T => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  set(value: T): void {
    this.snapshot = value
    for (const listener of this.listeners) listener()
  }
}

function bench(options: {
  invoke?: (request: DesktopCommandRequest) => Promise<DesktopCommandResult>
  searchProject?: (query: string, cwd: string, signal: AbortSignal) => Promise<{ sessionId: string; snippet: string }[]>
} = {}) {
  const source = new Source<DesktopMenuEvent>({ sequence: 0 })
  let sequence = 0
  const invoke = vi.fn(options.invoke ?? (async () => ({ ok: true, title: 'command', message: '完成' })))
  const createProject = vi.fn(async () => '/projects/new')
  const searchProject = vi.fn(options.searchProject ?? (async () => []))
  const useDesktopMenu = <S,>(selector: (value: DesktopMenuEvent) => S): S =>
    useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()))
  const sessionState = {
    current: 'session',
    byId: { session: { cwd: '/projects/example' } },
  }
  const useSessions = <S,>(selector: (value: typeof sessionState) => S): S => selector(sessionState)
  const view = render(
    <DesktopMenuSurface
      useDesktopMenu={useDesktopMenu as never}
      useSessions={useSessions as never}
      useWorkspaces={(() => undefined) as never}
      invoke={invoke}
      createProject={createProject}
      searchProject={searchProject}
    />,
  )
  return {
    ...view,
    invoke,
    createProject,
    searchProject,
    emit(action: DesktopAction) {
      act(() => { source.set({ sequence: ++sequence, action }) })
    },
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DesktopMenuSurface', () => {
  it('runs export with the current session cwd and presents completion', async () => {
    const b = bench()
    b.emit('project:export-jar')
    await waitFor(() => {
      expect(b.invoke).toHaveBeenCalledWith({ kind: 'export-jar', cwd: '/projects/example' })
    })
    expect(await b.findByText('导出 JAR')).toBeTruthy()
    expect(b.getByText('完成')).toBeTruthy()
  })

  it('creates a project through the injected workspace flow', async () => {
    const b = bench()
    b.emit('project:new')
    await waitFor(() => { expect(b.createProject).toHaveBeenCalledOnce() })
    expect(await b.findByText('已打开项目：/projects/new')).toBeTruthy()
  })

  it('loads and saves project settings through the themed dialog', async () => {
    const b = bench({
      invoke: async request => request.kind === 'project-settings-read'
        ? {
          ok: true,
          title: '项目设置',
          message: '已读取',
          settings: {
            systemPrompt: '原提示词',
            prerequisites: [{ name: 'JEI', path: 'C:\\mods\\jei.jar' }],
          },
        }
        : { ok: true, title: '项目设置', message: '项目设置已保存。' },
    })
    b.emit('project:settings')
    expect(await b.findByRole('dialog', { name: '项目设置' })).toBeTruthy()
    fireEvent.change(b.getByLabelText('系统提示词'), { target: { value: '新提示词' } })
    fireEvent.change(b.getByLabelText(/^前置模组/u), { target: { value: 'Sodium | C:\\mods\\sodium.jar' } })
    fireEvent.click(b.getByRole('button', { name: '保存设置' }))
    await waitFor(() => {
      expect(b.invoke).toHaveBeenLastCalledWith({
        kind: 'project-settings-write',
        cwd: '/projects/example',
        settings: {
          systemPrompt: '新提示词',
          prerequisites: [{ name: 'Sodium', path: 'C:\\mods\\sodium.jar' }],
        },
      })
    })
    await waitFor(() => { expect(b.queryByRole('dialog', { name: '项目设置' })).toBeNull() })
  })

  it('uses controlled search and commit dialogs instead of browser prompts', async () => {
    const find = vi.fn(() => true)
    window.find = find
    const b = bench()
    b.emit('editor:find-current')
    const search = await b.findByLabelText('查找内容')
    fireEvent.change(search, { target: { value: '方块注册' } })
    fireEvent.submit(search.closest('form')!)
    expect(find).toHaveBeenCalledWith('方块注册')
    expect(await b.findByText('已定位匹配内容。')).toBeTruthy()

    b.emit('git:commit')
    const message = await b.findByLabelText('Commit message')
    fireEvent.change(message, { target: { value: 'fix: export jar' } })
    fireEvent.submit(message.closest('form')!)
    await waitFor(() => {
      expect(b.invoke).toHaveBeenLastCalledWith({
        kind: 'git-commit', message: 'fix: export jar', cwd: '/projects/example',
      })
    })
  })

  it('renders project search matches as expandable command output', async () => {
    const b = bench({
      searchProject: async () => [{ sessionId: 's-1', snippet: '匹配的注册代码' }],
    })
    b.emit('editor:find-project')
    const input = await b.findByLabelText('查找内容')
    fireEvent.change(input, { target: { value: 'register' } })
    fireEvent.submit(input.closest('form')!)
    expect(await b.findByText('找到 1 条匹配内容。')).toBeTruthy()
    fireEvent.click(b.getByRole('button', { name: '查看详情' }))
    expect(b.getByText(/s-1: 匹配的注册代码/u)).toBeTruthy()
    expect(b.searchProject).toHaveBeenCalledWith('register', '/projects/example', expect.any(AbortSignal))
  })

  it('offers explicit branch modes and confirms a dirty switch', async () => {
    const b = bench({
      invoke: async request => request.kind === 'git-status'
        ? { ok: true, title: 'git', message: '完成', stdout: '## main\n M src/Main.java\n' }
        : { ok: true, title: 'git', message: '完成' },
    })
    b.emit('git:branch')
    expect(await b.findByRole('dialog', { name: 'Git 分支' })).toBeTruthy()
    fireEvent.click(b.getByRole('tab', { name: '切换' }))
    fireEvent.change(b.getByLabelText('分支名称'), { target: { value: 'feature/block' } })
    fireEvent.click(b.getByRole('button', { name: '切换分支' }))
    expect(await b.findByRole('dialog', { name: '工作区有未提交修改' })).toBeTruthy()
    fireEvent.click(b.getByRole('button', { name: '继续切换' }))
    await waitFor(() => {
      expect(b.invoke).toHaveBeenLastCalledWith({
        kind: 'git-branch', branch: 'feature/block', switchBranch: true, cwd: '/projects/example',
      })
    })
  })

  it('maps branch list and create modes to their existing command requests', async () => {
    const b = bench()
    b.emit('git:branch')
    fireEvent.click(await b.findByRole('button', { name: '查看分支' }))
    await waitFor(() => {
      expect(b.invoke).toHaveBeenLastCalledWith({ kind: 'git-branch', cwd: '/projects/example' })
    })

    b.emit('git:branch')
    fireEvent.click(await b.findByRole('tab', { name: '新建' }))
    fireEvent.change(b.getByLabelText('分支名称'), { target: { value: 'feature/items' } })
    fireEvent.click(b.getByRole('button', { name: '新建并切换' }))
    await waitFor(() => {
      expect(b.invoke).toHaveBeenLastCalledWith({
        kind: 'git-branch', branch: 'feature/items', createBranch: true, cwd: '/projects/example',
      })
    })
  })

  it('confirms push and supports Escape dismissal without invoking', async () => {
    const b = bench()
    b.emit('git:push')
    expect(await b.findByRole('dialog', { name: '推送当前项目' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(b.queryByRole('dialog', { name: '推送当前项目' })).toBeNull() })
    expect(b.invoke).not.toHaveBeenCalled()

    b.emit('git:push')
    fireEvent.click(await b.findByRole('button', { name: '确认推送' }))
    await waitFor(() => {
      expect(b.invoke).toHaveBeenCalledWith({ kind: 'git-push', cwd: '/projects/example' })
    })
  })

  it('keeps failures and output visible while auto-dismissing short success', async () => {
    vi.useFakeTimers()
    const b = bench()
    b.emit('git:status')
    await act(async () => { await Promise.resolve() })
    expect(b.getByText('Git 状态')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(b.queryByText('Git 状态')).toBeNull()

    b.invoke.mockResolvedValueOnce({ ok: false, title: 'git', message: '命令失败' })
    b.emit('git:diff')
    await act(async () => { await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(8_000) })
    expect(b.getByText('命令失败')).toBeTruthy()
  })

  it('recognizes worktree changes without treating the branch header as dirty', () => {
    expect(hasUncommittedChanges('## main\n')).toBe(false)
    expect(hasUncommittedChanges('## main\n?? new-file.txt\n')).toBe(true)
  })
})
