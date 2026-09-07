/* oxlint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GameAnnotation, NormalizedPoint } from '@deepseek-ai/dsh-session/types'
import {
  annotationBounds, annotationLabel, normalizePoint, type GameSurfaceSnapshot,
  type GameSurfaceState,
} from './game.ts'
import css from './GameWorkspace.module.css'

export type GameWorkspaceProps = PropsRuntime<'game'> & {
  annotate: ((annotations: GameAnnotation[]) => Promise<unknown>) | undefined
  reconnect: (cwd: string) => Promise<GameSurfaceState>
  beginAnnotation: (cwd: string) => Promise<GameSurfaceSnapshot>
  endAnnotation: (cwd: string) => Promise<void>
  reposition: (cwd: string) => Promise<void>
}

function AnnotationLayer(props: {
  annotations: readonly GameAnnotation[]
  activeId?: string | undefined
  onCreate: (draft: { shape: GameAnnotation['shape'] }) => void
  onFocus: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState<NormalizedPoint | null>(null)
  const [current, setCurrent] = useState<NormalizedPoint | null>(null)
  const pointFromEvent = (event: React.PointerEvent): NormalizedPoint => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
    return normalizePoint({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
  }
  const finish = (event: React.PointerEvent): void => {
    if (start === null) return
    const end = pointFromEvent(event)
    const width = Math.abs(end.x - start.x)
    const height = Math.abs(end.y - start.y)
    const shape: GameAnnotation['shape'] = width < 0.015 && height < 0.015
      ? { type: 'point', geometry: end }
      : { type: 'rect', geometry: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width, height } }
    props.onCreate({ shape })
    setStart(null)
    setCurrent(null)
  }
  return <div ref={ref} className={css.annotationLayer} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); const p = pointFromEvent(event); setStart(p); setCurrent(p) }} onPointerMove={event => { if (start) setCurrent(pointFromEvent(event)) }} onPointerUp={finish} onPointerCancel={() => { setStart(null); setCurrent(null) }}>
    {start && current && <div className={css.draftRect} style={{ left: `${Math.min(start.x, current.x) * 100}%`, top: `${Math.min(start.y, current.y) * 100}%`, width: `${Math.abs(current.x - start.x) * 100}%`, height: `${Math.abs(current.y - start.y) * 100}%` }} />}
    {props.annotations.map(annotation => {
      const bounds = annotationBounds(annotation)
      return <button key={annotation.id} type="button" className={`${css.marker} ${props.activeId === annotation.id ? css.markerActive : ''}`} style={{ left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%` }} onPointerDown={event => event.stopPropagation()} onClick={() => props.onFocus(annotation.id)} aria-label={`定位标注 ${annotation.label}`}>{annotation.label}</button>
    })}
  </div>
}

function AnnotationPopover(props: { initialValue: string | undefined; onSave: (description: string) => void; onCancel: () => void }) {
  const [description, setDescription] = useState(props.initialValue ?? '')
  return <div className={css.popover} role="dialog" aria-label="编辑游戏标注">
    <label htmlFor="game-annotation-description">请描述这里需要修改什么</label>
    <textarea id="game-annotation-description" autoFocus value={description} onChange={event => setDescription(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') props.onCancel(); if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) props.onSave(description.trim()) }} rows={3} />
    <div className={css.popoverActions}><button type="button" onClick={() => props.onCancel()}>取消</button><button type="button" disabled={!description.trim()} onClick={() => props.onSave(description.trim())}>保存标注</button></div>
  </div>
}

function AnnotationContextList(props: { annotations: readonly GameAnnotation[]; onFocus: (id: string) => void; onEdit: (annotation: GameAnnotation) => void; onDelete: (id: string) => void }) {
  return <section className={css.contextList} aria-label="游戏标注上下文"><h3>标注上下文</h3>{props.annotations.length === 0 ? <p className={css.muted}>还没有标注</p> : props.annotations.map(annotation => { const bounds = annotationBounds(annotation); return <div key={annotation.id} className={css.contextItem}><button type="button" onClick={() => props.onFocus(annotation.id)}><strong>[标注 {annotation.label}]</strong><span>{annotation.description || '未填写说明'}</span><small>x {bounds.x.toFixed(2)} · y {bounds.y.toFixed(2)} · w {bounds.width.toFixed(2)} · h {bounds.height.toFixed(2)}</small></button><button type="button" onClick={() => props.onEdit(annotation)}>编辑</button><button type="button" className={css.deleteButton} onClick={() => props.onDelete(annotation.id)} aria-label={`删除标注 ${annotation.label}`}>删除</button></div> })}</section>
}

export function GameWorkspace({ useSession, sessionId, cwd, state: game, annotate, reconnect, beginAnnotation, endAnnotation, reposition }: GameWorkspaceProps) {
  const annotationCwd = useRef<string>()
  const captureGeneration = useRef(0)
  const [snapshot, setSnapshot] = useState<GameSurfaceSnapshot>()
  const [captureError, setCaptureError] = useState<string>()
  const [pendingShape, setPendingShape] = useState<GameAnnotation['shape'] | null>(null)
  const [editing, setEditing] = useState<GameAnnotation | null>(null)
  const [activeId, setActiveId] = useState<string>()
  const annotations = useSession(snapshot => snapshot?.annotations ?? []) ?? []
  useEffect(() => () => {
    captureGeneration.current += 1
    const active = annotationCwd.current
    annotationCwd.current = undefined
    if (active !== undefined) void endAnnotation(active)
  }, [cwd, endAnnotation])

  const finishAnnotation = useCallback(async (): Promise<void> => {
    captureGeneration.current += 1
    const active = annotationCwd.current
    annotationCwd.current = undefined
    setSnapshot(undefined)
    setPendingShape(null)
    if (active !== undefined) await endAnnotation(active)
  }, [endAnnotation])

  const toggleAnnotation = useCallback(async (): Promise<void> => {
    if (snapshot !== undefined) { await finishAnnotation(); return }
    if (cwd === undefined || game.status !== 'connected') return
    const generation = ++captureGeneration.current
    setCaptureError(undefined)
    try {
      const captured = await beginAnnotation(cwd)
      if (captureGeneration.current !== generation) { await endAnnotation(cwd); return }
      annotationCwd.current = cwd
      setSnapshot(captured)
    } catch (error) {
      await endAnnotation(cwd).catch(() => {})
      setCaptureError(error instanceof Error ? error.message : String(error))
    }
  }, [beginAnnotation, cwd, endAnnotation, finishAnnotation, game.status, snapshot])

  const persist = useCallback(async (next: GameAnnotation[]) => { if (!annotate || sessionId === undefined) return; await annotate(next) }, [annotate, sessionId])
  const create = useCallback((draft: { shape: GameAnnotation['shape'] }) => { setPendingShape(draft.shape) }, [])
  const save = useCallback(async (description: string): Promise<void> => {
    if (editing !== null) {
      await persist(annotations.map(annotation => annotation.id === editing.id ? { ...annotation, description } : annotation))
      setEditing(null)
      if (snapshot !== undefined) await finishAnnotation()
      return
    }
    if (!pendingShape || !sessionId) return
    const labels = new Set(annotations.map(annotation => annotation.label))
    let index = 0
    while (labels.has(annotationLabel(index))) index += 1
    const annotation: GameAnnotation = { sessionId, id: crypto.randomUUID(), label: annotationLabel(index), shape: pendingShape, description, createdAt: Date.now() }
    try { await persist([...annotations, annotation]) } finally { await finishAnnotation() }
  }, [annotations, editing, finishAnnotation, pendingShape, persist, sessionId, snapshot])
  const remove = useCallback((id: string) => { void persist(annotations.filter(annotation => annotation.id !== id)) }, [annotations, persist])
  const focus = useCallback((id: string) => { setActiveId(id); window.setTimeout(() => setActiveId(current => current === id ? undefined : current), 1200) }, [])
  const statusLabel = useMemo(() => ({ idle: '未启动', starting: '启动中', connected: '已连接', failed: '启动失败', disconnected: '已断开', reconnecting: '正在重连', unsupported: '当前平台不支持' }[game.status]), [game.status])
  return <div className={css.workspace} data-game-status={game.status}>
    <header className={css.toolbar}><div><strong>{('gameName' in game ? game.gameName : undefined) ?? cwd?.split(/[\\/]/).pop() ?? 'Minecraft'}</strong><span className={css.status} data-status={game.status}>{statusLabel}</span></div><div className={css.toolbarActions}><button type="button" className={css.annotateButton} onClick={() => { void toggleAnnotation() }} disabled={game.status !== 'connected'} aria-label={snapshot === undefined ? '标注 Minecraft 窗口' : '退出标注'} title={snapshot === undefined ? '标注 Minecraft 窗口' : '退出标注'}>{snapshot === undefined ? '⌖ 标注窗口' : '退出标注'}</button><button type="button" onClick={() => { if (cwd !== undefined) void reposition(cwd).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) }) }} disabled={cwd === undefined || game.status !== 'connected'}>重新定位面板</button><button type="button" onClick={() => { if (cwd !== undefined) void reconnect(cwd).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) }) }} disabled={cwd === undefined || (game.status !== 'disconnected' && game.status !== 'failed')}>重连</button></div></header>
    <div className={css.companionStatus}>{captureError ?? (game.status === 'unsupported' ? 'Minecraft 将在独立窗口中运行。' : game.status === 'connected' ? 'Minecraft 正在独立窗口运行，CraftCode 陪伴面板已跟随。' : ('error' in game ? game.error : '启动游戏后会自动定位陪伴面板。'))}</div>
    {snapshot !== undefined && <div className={css.annotationPreview}><img className={css.snapshot} src={snapshot.dataUrl} alt="Minecraft 标注截图" /><AnnotationLayer annotations={annotations} activeId={activeId} onCreate={create} onFocus={focus} />{(pendingShape || editing) && <AnnotationPopover initialValue={editing?.description} onSave={description => { void save(description) }} onCancel={() => { setEditing(null); void finishAnnotation() }} />}</div>}
    <AnnotationContextList annotations={annotations} onFocus={focus} onEdit={annotation => setEditing(annotation)} onDelete={remove} />
  </div>
}
