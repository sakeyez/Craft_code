import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
  IconSearchOutline16,
  Input,
  Modal,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  DesktopAction,
  DesktopCommandRequest,
  DesktopCommandResult,
  DesktopMenuInjected,
  DesktopSettings,
} from './contract.ts'
import css from './DesktopMenuSurface.module.css'

type DesktopMenuSurfaceProps = PropsRuntime<'shell.overlay'> & InjectFace<DesktopMenuInjected>

type TextPurpose = 'find-current' | 'find-project' | 'commit'
type BranchMode = 'list' | 'switch' | 'create'
type DialogState =
  | { kind: 'settings'; value: DesktopSettings }
  | { kind: 'text'; purpose: TextPurpose; value: string }
  | { kind: 'confirm'; command: 'git-push' | 'git-pull' }
  | { kind: 'branch'; mode: BranchMode; value: string }
  | { kind: 'dirty-switch'; branch: string }

interface Notice {
  id: number
  phase: 'running' | 'complete'
  result: DesktopCommandResult
}

interface RunOptions {
  title: string
  pending?: boolean
  showResult?: boolean
}

const AUTO_DISMISS_MS = 4_000

function errorResult(title: string, message: string): DesktopCommandResult {
  return { ok: false, title, message }
}

function isCancellation(result: DesktopCommandResult): boolean {
  return !result.ok && result.message.startsWith('已取消')
}

function hasDetails(result: DesktopCommandResult): boolean {
  return result.stdout?.trim() !== '' && result.stdout !== undefined
    || result.stderr?.trim() !== '' && result.stderr !== undefined
}

/** Ignore Git's branch header; any other short-status line is a worktree change. */
export function hasUncommittedChanges(stdout: string | undefined): boolean {
  return stdout?.split(/\r?\n/u).some(line => line.trim() !== '' && !line.startsWith('##')) ?? false
}

function CommandNotice({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const details = hasDetails(notice.result)
  const state = notice.phase === 'running'
    ? 'ongoing'
    : notice.result.ok
      ? 'done'
      : isCancellation(notice.result) ? 'warning' : 'error'
  const role = notice.phase === 'complete' && !notice.result.ok && !isCancellation(notice.result)
    ? 'alert'
    : 'status'

  return (
    <aside className={css.notice} role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
      <div className={css.noticeHeader}>
        <StateDot state={state} size={10} />
        <strong className={css.noticeTitle}>{notice.result.title}</strong>
        <button type="button" className={css.iconButton} aria-label="关闭提示" onClick={onClose}>
          <IconCloseOutline16 />
        </button>
      </div>
      <p className={css.noticeMessage}>{notice.result.message}</p>
      {details && (
        <>
          <button
            type="button"
            className={css.detailsToggle}
            aria-expanded={expanded}
            onClick={() => { setExpanded(value => !value) }}
          >
            {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
            {expanded ? '收起详情' : '查看详情'}
          </button>
          {expanded && (
            <div className={css.output}>
              {notice.result.stdout?.trim() !== '' && notice.result.stdout !== undefined && (
                <section>
                  <h3>标准输出</h3>
                  <pre>{notice.result.stdout}</pre>
                </section>
              )}
              {notice.result.stderr?.trim() !== '' && notice.result.stderr !== undefined && (
                <section>
                  <h3>错误输出</h3>
                  <pre>{notice.result.stderr}</pre>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}

const textDialogCopy: Record<TextPurpose, {
  title: string
  label: string
  placeholder: string
  action: string
}> = {
  'find-current': {
    title: '查找当前对话', label: '查找内容', placeholder: '输入要查找的文字', action: '查找',
  },
  'find-project': {
    title: '查找项目对话', label: '查找内容', placeholder: '搜索当前项目中的历史对话', action: '搜索',
  },
  'commit': {
    title: '提交更改', label: 'Commit message', placeholder: '说明本次更改', action: '提交',
  },
}

/** Desktop menu dialogs and feedback; all external capabilities arrive through slot props. */
export function DesktopMenuSurface({
  useSessions,
  useDesktopMenu,
  invoke,
  createProject,
  searchProject,
}: DesktopMenuSurfaceProps) {
  const menuEvent = useDesktopMenu(value => value)
  const sessions = useSessions(value => value)
  const cwd = sessions.current === undefined ? undefined : sessions.byId[sessions.current]?.cwd
  const [dialog, setDialog] = useState<DialogState>()
  const [notice, setNotice] = useState<Notice>()
  const [busyCount, setBusyCount] = useState(0)
  const [lastQuery, setLastQuery] = useState('')
  const noticeSequence = useRef(0)
  const handledMenuSequence = useRef(0)
  const busy = busyCount > 0

  const publish = useCallback((phase: Notice['phase'], result: DesktopCommandResult): number => {
    const id = ++noticeSequence.current
    setNotice({ id, phase, result })
    return id
  }, [])

  const execute = useCallback(async (
    request: Omit<DesktopCommandRequest, 'cwd'>,
    options: RunOptions,
  ): Promise<DesktopCommandResult> => {
    if (cwd === undefined) {
      const missing = errorResult(options.title, '请先打开一个项目工作区。')
      publish('complete', missing)
      return missing
    }
    const pendingId = options.pending === true
      ? publish('running', { ok: true, title: options.title, message: '正在执行，请稍候…' })
      : undefined
    setBusyCount(value => value + 1)
    try {
      const value = await invoke({ ...request, cwd })
      const presented = { ...value, title: options.title }
      if (options.showResult !== false || !presented.ok) {
        publish('complete', presented)
      } else if (pendingId !== undefined) {
        setNotice(current => current?.id === pendingId ? undefined : current)
      }
      return presented
    } catch (error) {
      const failed = errorResult(options.title, error instanceof Error ? error.message : String(error))
      publish('complete', failed)
      return failed
    } finally {
      setBusyCount(value => Math.max(0, value - 1))
    }
  }, [cwd, invoke, publish])

  const createNewProject = useCallback(async (): Promise<void> => {
    const pendingId = publish('running', { ok: true, title: '新建项目', message: '正在选择项目目录…' })
    setBusyCount(value => value + 1)
    try {
      const path = await createProject()
      if (path === null) {
        publish('complete', errorResult('新建项目', '已取消目录选择。'))
      } else {
        publish('complete', { ok: true, title: '新建项目', message: `已打开项目：${path}` })
      }
    } catch (error) {
      publish('complete', errorResult('新建项目', error instanceof Error ? error.message : String(error)))
    } finally {
      setNotice(current => current?.id === pendingId ? undefined : current)
      setBusyCount(value => Math.max(0, value - 1))
    }
  }, [createProject, publish])

  const handleAction = useCallback((action: DesktopAction): void => {
    switch (action) {
      case 'project:new':
        void createNewProject()
        return
      case 'project:settings':
        void execute(
          { kind: 'project-settings-read' },
          { title: '项目设置', pending: true, showResult: false },
        ).then((value) => {
          if (value.ok && value.settings !== undefined) setDialog({ kind: 'settings', value: value.settings })
        })
        return
      case 'editor:find-current':
        setDialog({ kind: 'text', purpose: 'find-current', value: lastQuery })
        return
      case 'editor:find-project':
        setDialog({ kind: 'text', purpose: 'find-project', value: '' })
        return
      case 'git:commit':
        setDialog({ kind: 'text', purpose: 'commit', value: '' })
        return
      case 'git:push':
      case 'git:pull':
        setDialog({ kind: 'confirm', command: action === 'git:push' ? 'git-push' : 'git-pull' })
        return
      case 'git:branch':
        setDialog({ kind: 'branch', mode: 'list', value: '' })
        return
      case 'project:export-jar':
        void execute({ kind: 'export-jar' }, { title: '导出 JAR', pending: true })
        return
      case 'git:status':
        void execute({ kind: 'git-status' }, { title: 'Git 状态', pending: true })
        return
      case 'git:diff':
        void execute({ kind: 'git-diff' }, { title: 'Git 差异', pending: true })
        return
      case 'git:log':
        void execute({ kind: 'git-log' }, { title: 'Git 日志', pending: true })
        return
      case 'help:docs':
      case 'help:sponsor':
        return
    }
  }, [createNewProject, execute, lastQuery])

  useEffect(() => {
    if (menuEvent.action === undefined || menuEvent.sequence === handledMenuSequence.current) return
    handledMenuSequence.current = menuEvent.sequence
    handleAction(menuEvent.action)
  }, [handleAction, menuEvent])

  useEffect(() => {
    if (notice?.phase !== 'complete' || hasDetails(notice.result)
      || (!notice.result.ok && !isCancellation(notice.result))) return
    const id = notice.id
    const timer = setTimeout(() => {
      setNotice(current => current?.id === id ? undefined : current)
    }, AUTO_DISMISS_MS)
    return () => { clearTimeout(timer) }
  }, [notice])

  const submitTextDialog = async (state: Extract<DialogState, { kind: 'text' }>): Promise<void> => {
    const value = state.value.trim()
    if (value === '') return
    setDialog(undefined)
    if (state.purpose === 'find-current') {
      setLastQuery(value)
      const found = window.find?.(value) ?? false
      publish('complete', {
        ok: found,
        title: '查找当前对话',
        message: found ? '已定位匹配内容。' : '当前对话没有匹配内容。',
      })
      return
    }
    if (state.purpose === 'commit') {
      await execute({ kind: 'git-commit', message: value }, { title: '提交更改', pending: true })
      return
    }
    if (cwd === undefined) {
      publish('complete', errorResult('查找项目对话', '请先打开一个项目工作区。'))
      return
    }
    const controller = new AbortController()
    const pendingId = publish('running', { ok: true, title: '查找项目对话', message: '正在搜索，请稍候…' })
    setBusyCount(count => count + 1)
    try {
      const items = await searchProject(value, cwd, controller.signal)
      publish('complete', {
        ok: true,
        title: '查找项目对话',
        message: items.length === 0 ? '项目对话没有匹配内容。' : `找到 ${String(items.length)} 条匹配内容。`,
        ...(items.length === 0 ? {} : { stdout: items.map(item => `${item.sessionId}: ${item.snippet}`).join('\n') }),
      })
    } catch (error) {
      publish('complete', errorResult('查找项目对话', error instanceof Error ? error.message : String(error)))
    } finally {
      setNotice(current => current?.id === pendingId ? undefined : current)
      setBusyCount(count => Math.max(0, count - 1))
    }
  }

  const submitBranch = async (state: Extract<DialogState, { kind: 'branch' }>): Promise<void> => {
    const branch = state.value.trim()
    if (state.mode !== 'list' && branch === '') return
    setDialog(undefined)
    if (state.mode === 'list') {
      await execute({ kind: 'git-branch' }, { title: 'Git 分支', pending: true })
      return
    }
    if (state.mode === 'create') {
      await execute(
        { kind: 'git-branch', branch, createBranch: true },
        { title: '新建并切换分支', pending: true },
      )
      return
    }
    const status = await execute(
      { kind: 'git-status' },
      { title: '检查工作区', showResult: false },
    )
    if (!status.ok) return
    if (hasUncommittedChanges(status.stdout)) {
      setDialog({ kind: 'dirty-switch', branch })
      return
    }
    await execute(
      { kind: 'git-branch', branch, switchBranch: true },
      { title: '切换分支', pending: true },
    )
  }

  const textCopy = dialog?.kind === 'text' ? textDialogCopy[dialog.purpose] : undefined
  const branchAction = dialog?.kind === 'branch'
    ? dialog.mode === 'list' ? '查看分支' : dialog.mode === 'switch' ? '切换分支' : '新建并切换'
    : ''
  const settingsText = useMemo(() => dialog?.kind === 'settings'
    ? dialog.value.prerequisites.map(item => `${item.name} | ${item.path}`).join('\n')
    : '', [dialog])

  return (
    <>
      {dialog?.kind === 'settings' && (
        <Modal
          open
          onClose={() => { if (!busy) setDialog(undefined) }}
          title="项目设置"
          closeLabel="关闭项目设置"
          description="这些设置仅作用于当前项目。"
          className={css.settingsDialog ?? ''}
          contentClassName={css.modalContent ?? ''}
          footer={(
            <>
              <Button variant="outline" className={css.actionButton} disabled={busy} onClick={() => { setDialog(undefined) }}>
                取消
              </Button>
              <Button
                variant="primary"
                className={css.actionButton}
                disabled={busy}
                onClick={() => {
                  void execute(
                    { kind: 'project-settings-write', settings: dialog.value },
                    { title: '项目设置', pending: true },
                  ).then((value) => { if (value.ok) setDialog(undefined) })
                }}
              >
                {busy ? '保存中…' : '保存设置'}
              </Button>
            </>
          )}
        >
          <div className={css.formStack}>
            <label className={css.field}>
              <span>系统提示词</span>
              <textarea
                className={`${css.textarea} ${css.promptArea}`}
                value={dialog.value.systemPrompt}
                disabled={busy}
                onChange={(event) => {
                  setDialog({ kind: 'settings', value: { ...dialog.value, systemPrompt: event.currentTarget.value } })
                }}
              />
            </label>
            <label className={css.field}>
              <span>前置模组</span>
              <small>每行填写“显示名称 | 绝对路径”</small>
              <textarea
                className={css.textarea}
                value={settingsText}
                disabled={busy}
                onChange={(event) => {
                  const prerequisites = event.currentTarget.value.split('\n').filter(Boolean).map((line) => {
                    const [name, ...path] = line.split('|')
                    return { name: (name ?? '').trim(), path: path.join('|').trim() }
                  })
                  setDialog({ kind: 'settings', value: { ...dialog.value, prerequisites } })
                }}
              />
            </label>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'text' && textCopy !== undefined && (
        <Modal
          open
          onClose={() => { if (!busy) setDialog(undefined) }}
          title={textCopy.title}
          closeLabel={`关闭${textCopy.title}`}
          className={css.compactDialog ?? ''}
          footer={(
            <>
              <Button variant="outline" className={css.actionButton} disabled={busy} onClick={() => { setDialog(undefined) }}>
                取消
              </Button>
              <Button
                variant="primary"
                className={css.actionButton}
                disabled={busy || dialog.value.trim() === ''}
                type="submit"
                form="desktop-text-dialog"
              >
                {textCopy.action}
              </Button>
            </>
          )}
        >
          <form
            id="desktop-text-dialog"
            className={css.formStack}
            onSubmit={(event: FormEvent) => { event.preventDefault(); void submitTextDialog(dialog) }}
          >
            <label className={css.field}>
              <span>{textCopy.label}</span>
              <Input
                className={css.textInput ?? ''}
                {...dialog.purpose.startsWith('find') ? { icon: <IconSearchOutline16 /> } : {}}
                autoFocus
                value={dialog.value}
                placeholder={textCopy.placeholder}
                disabled={busy}
                onChange={(event) => { setDialog({ ...dialog, value: event.currentTarget.value }) }}
              />
            </label>
          </form>
        </Modal>
      )}

      {dialog?.kind === 'confirm' && (
        <Modal
          open
          onClose={() => { if (!busy) setDialog(undefined) }}
          title={dialog.command === 'git-push' ? '推送当前项目' : '拉取当前项目'}
          closeLabel="关闭确认窗口"
          description={dialog.command === 'git-push'
            ? '将当前分支的提交推送到已配置的远程仓库。'
            : '从已配置的远程仓库拉取并合并当前分支。'}
          className={css.compactDialog ?? ''}
          footer={(
            <>
              <Button variant="outline" className={css.actionButton} disabled={busy} onClick={() => { setDialog(undefined) }}>
                取消
              </Button>
              <Button
                variant="primary"
                className={css.actionButton}
                disabled={busy}
                onClick={() => {
                  const command = dialog.command
                  setDialog(undefined)
                  void execute({ kind: command }, {
                    title: command === 'git-push' ? 'Git Push' : 'Git Pull',
                    pending: true,
                  })
                }}
              >
                {dialog.command === 'git-push' ? '确认推送' : '确认拉取'}
              </Button>
            </>
          )}
        />
      )}

      {dialog?.kind === 'branch' && (
        <Modal
          open
          onClose={() => { if (!busy) setDialog(undefined) }}
          title="Git 分支"
          closeLabel="关闭分支窗口"
          className={css.compactDialog ?? ''}
          footer={(
            <>
              <Button variant="outline" className={css.actionButton} disabled={busy} onClick={() => { setDialog(undefined) }}>
                取消
              </Button>
              <Button
                variant="primary"
                className={css.actionButton}
                disabled={busy || (dialog.mode !== 'list' && dialog.value.trim() === '')}
                type="submit"
                form="desktop-branch-dialog"
              >
                {branchAction}
              </Button>
            </>
          )}
        >
          <form
            id="desktop-branch-dialog"
            className={css.formStack}
            onSubmit={(event: FormEvent) => { event.preventDefault(); void submitBranch(dialog) }}
          >
            <div className={css.segmented} role="tablist" aria-label="分支操作">
              {([
                ['list', '查看'], ['switch', '切换'], ['create', '新建'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={dialog.mode === mode}
                  className={css.segment}
                  onClick={() => { setDialog({ ...dialog, mode }) }}
                >
                  {label}
                </button>
              ))}
            </div>
            {dialog.mode === 'list'
              ? <p className={css.helper}>显示本地与远程分支列表。</p>
              : (
                <label className={css.field}>
                  <span>分支名称</span>
                  <Input
                    className={css.textInput ?? ''}
                    icon={<IconBranchOutline16 />}
                    autoFocus
                    value={dialog.value}
                    placeholder={dialog.mode === 'switch' ? '输入现有分支名称' : '输入新分支名称'}
                    disabled={busy}
                    onChange={(event) => { setDialog({ ...dialog, value: event.currentTarget.value }) }}
                  />
                </label>
              )}
          </form>
        </Modal>
      )}

      {dialog?.kind === 'dirty-switch' && (
        <Modal
          open
          onClose={() => { if (!busy) setDialog(undefined) }}
          title="工作区有未提交修改"
          closeLabel="关闭分支切换确认"
          description={`仍要切换到“${dialog.branch}”吗？未提交修改可能阻止切换。`}
          className={css.compactDialog ?? ''}
          footer={(
            <>
              <Button variant="outline" className={css.actionButton} disabled={busy} onClick={() => { setDialog(undefined) }}>
                取消
              </Button>
              <Button
                variant="primary"
                className={css.actionButton}
                disabled={busy}
                onClick={() => {
                  const branch = dialog.branch
                  setDialog(undefined)
                  void execute(
                    { kind: 'git-branch', branch, switchBranch: true },
                    { title: '切换分支', pending: true },
                  )
                }}
              >
                继续切换
              </Button>
            </>
          )}
        />
      )}

      {notice !== undefined && (
        <CommandNotice notice={notice} onClose={() => { setNotice(undefined) }} />
      )}
    </>
  )
}
