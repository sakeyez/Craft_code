/* oxlint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GameAnnotation } from '@deepseek-ai/dsh-session/types'
import {
  annotationBounds, type GameAnnotationRequest,
  type GameSurfaceState,
} from './game.ts'
import css from './GameWorkspace.module.css'

export type GameWorkspaceProps = PropsRuntime<'game'> & {
  annotate: ((annotations: GameAnnotation[]) => Promise<unknown>) | undefined
  reconnect: (cwd: string) => Promise<GameSurfaceState>
  beginAnnotation: (request: GameAnnotationRequest) => Promise<void>
  endAnnotation: (operationId: string) => Promise<void>
  reposition: (cwd: string) => Promise<void>
}

function AnnotationPopover(props: { initialValue: string | undefined; inline: boolean; onSave: (description: string) => void; onCancel: () => void }) {
  const [description, setDescription] = useState(props.initialValue ?? '')
  return <div className={`${css.popover} ${props.inline ? css.inlinePopover : ''}`} role="dialog" aria-label="编辑游戏标注">
    <label htmlFor="game-annotation-description">请描述这里需要修改什么</label>
    <textarea id="game-annotation-description" autoFocus value={description} onChange={event => setDescription(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') props.onCancel(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) props.onSave(description.trim()) }} rows={3} />
    <div className={css.popoverActions}><button type="button" onClick={() => props.onCancel()}>取消</button><button type="button" disabled={!description.trim()} onClick={() => props.onSave(description.trim())}>保存标注</button></div>
  </div>
}

function AnnotationContextList(props: { disabled: boolean; annotations: readonly GameAnnotation[]; onFocus: (id: string) => void; onEdit: (annotation: GameAnnotation) => void; onDelete: (id: string) => void }) {
  return <section className={css.contextList} aria-label="游戏标注上下文"><h3>标注上下文</h3>{props.annotations.length === 0 ? <p className={css.muted}>还没有标注</p> : props.annotations.map(annotation => { const bounds = annotationBounds(annotation); return <div key={annotation.id} className={css.contextItem}><button type="button" onClick={() => props.onFocus(annotation.id)}><strong>[标注 {annotation.label}]</strong><span>{annotation.description || '未填写说明'}</span><small>x {bounds.x.toFixed(2)} · y {bounds.y.toFixed(2)} · w {bounds.width.toFixed(2)} · h {bounds.height.toFixed(2)}</small></button><button type="button" disabled={props.disabled} onClick={() => props.onEdit(annotation)}>编辑</button><button type="button" disabled={props.disabled} className={css.deleteButton} onClick={() => props.onDelete(annotation.id)} aria-label={`删除标注 ${annotation.label}`}>删除</button></div> })}</section>
}

export function GameWorkspace({ useSession, sessionId, cwd, state: game, annotate, reconnect, beginAnnotation, endAnnotation, reposition }: GameWorkspaceProps) {
  const operation = useRef<string>()
  const [annotating, setAnnotating] = useState(false)
  const [captureError, setCaptureError] = useState<string>()
  const [editing, setEditing] = useState<GameAnnotation | null>(null)
  const annotations = useSession(snapshot => snapshot?.annotations ?? []) ?? []
  useEffect(() => {
    setAnnotating(false)
    setEditing(null)
    setCaptureError(undefined)
    return () => {
      const active = operation.current
      operation.current = undefined
      if (active !== undefined) void endAnnotation(active).catch(() => {})
    }
  }, [cwd, sessionId, game.status])

  const startAnnotation = async (): Promise<void> => {
    if (operation.current || cwd === undefined || sessionId === undefined || !annotate || game.status !== 'connected') return
    const operationId = crypto.randomUUID()
    operation.current = operationId
    setAnnotating(true)
    setCaptureError(undefined)
    try {
      await beginAnnotation({ operationId, cwd, sessionId, labels: annotations.map(annotation => annotation.label) })
    } catch (error) {
      if (operation.current === operationId) setCaptureError(error instanceof Error ? error.message : String(error))
    } finally {
      if (operation.current === operationId) { operation.current = undefined; setAnnotating(false) }
    }
  }
  const persist = useCallback(async (next: GameAnnotation[]) => {
    if (!annotate || sessionId === undefined) throw new Error('当前会话无法保存游戏标注。')
    await annotate(next)
  }, [annotate, sessionId])
  const save = useCallback(async (description: string): Promise<void> => {
    if (editing === null) return
    await persist(annotations.map(annotation => annotation.id === editing.id ? { ...annotation, description } : annotation))
    setEditing(null)
  }, [annotations, editing, persist])
  const remove = useCallback((id: string) => {
    setCaptureError(undefined)
    void persist(annotations.filter(annotation => annotation.id !== id))
      .catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) })
  }, [annotations, persist])
  const statusLabel = useMemo(() => ({ idle: '未启动', starting: '启动中', connected: '已连接', failed: '启动失败', disconnected: '已断开', reconnecting: '正在重连', unsupported: '当前平台不支持' }[game.status]), [game.status])
  const editor = editing && <AnnotationPopover key={editing.id} initialValue={editing.description} inline onSave={description => {
    setCaptureError(undefined)
    void save(description).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) })
  }} onCancel={() => { setEditing(null); setCaptureError(undefined) }} />
  return <div className={css.workspace} data-game-status={game.status}>
    <header className={css.toolbar}>
      <div><strong>{('gameName' in game ? game.gameName : undefined) ?? cwd?.split(/[\\/]/).pop() ?? 'Minecraft'}</strong><span className={css.status} data-status={game.status}>{statusLabel}</span></div>
      <div className={css.toolbarActions}>
        <button type="button" className={css.annotateButton} onClick={() => { void startAnnotation() }} disabled={annotating || editing !== null || !annotate || sessionId === undefined || game.status !== 'connected'} aria-label="在游戏画面上标注" title="在 Minecraft 画面上添加标注">{annotating ? '画面定格中…' : '在游戏上标注'}</button>
        <button type="button" aria-label="重新定位面板" title="重新定位面板" onClick={() => {
          if (cwd === undefined) return
          setCaptureError(undefined)
          void reposition(cwd).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) })
        }} disabled={annotating || cwd === undefined || game.status !== 'connected'}>重新定位</button>
        <button type="button" onClick={() => { if (cwd !== undefined) void reconnect(cwd).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) }) }} disabled={cwd === undefined || (game.status !== 'disconnected' && game.status !== 'failed')}>重连</button>
      </div>
    </header>
    {(captureError !== undefined || game.status !== 'connected') && <div className={css.companionStatus}>{captureError ?? (game.status === 'unsupported' ? 'Minecraft 将在独立窗口中运行。' : ('error' in game ? game.error : '等待 Minecraft 窗口。'))}</div>}
    {annotating && <p className={css.muted}>Minecraft 画面已定格，标注完成后恢复并排布局。</p>}
    {editor}
    <AnnotationContextList disabled={annotating} annotations={annotations} onFocus={() => {}} onEdit={annotation => setEditing(annotation)} onDelete={remove} />
  </div>
}
