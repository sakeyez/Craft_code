/* oxlint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GameAnnotation, NormalizedPoint } from '@deepseek-ai/dsh-session/types'
import { annotationBounds, annotationLabel, normalizePoint, type GameSurfaceState } from './game.ts'
import css from './GameWorkspace.module.css'

export type GameWorkspaceProps = PropsRuntime<'game'>

function initialGameState(): GameSurfaceState {
  if (typeof window === 'undefined') return { status: 'idle' }
  return (window as Window & { __craftCodeGameState?: GameSurfaceState }).__craftCodeGameState ?? { status: 'idle' }
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

export function GameWorkspace({ useSession, sessionId, useSessions, state, annotate }: GameWorkspaceProps & { state: GameSurfaceState; annotate: ((annotations: GameAnnotation[]) => Promise<unknown>) | undefined }) {
  const [game, setGame] = useState<GameSurfaceState>(state ?? initialGameState)
  const [annotating, setAnnotating] = useState(false)
  const [pendingShape, setPendingShape] = useState<GameAnnotation['shape'] | null>(null)
  const [editing, setEditing] = useState<GameAnnotation | null>(null)
  const [activeId, setActiveId] = useState<string>()
  useEffect(() => setGame(state), [state])
  const annotations = useSession(snapshot => snapshot?.annotations ?? []) ?? []
  const currentCwd = useSessions(state => state.current ? state.byId[state.current]?.cwd : undefined)
  useEffect(() => {
    const listener = (event: Event): void => setGame((event as CustomEvent<GameSurfaceState>).detail)
    window.addEventListener('craftcode:game-state', listener)
    return () => window.removeEventListener('craftcode:game-state', listener)
  }, [])
  const persist = useCallback(async (next: GameAnnotation[]) => { if (!annotate || sessionId === undefined) return; await annotate(next) }, [annotate, sessionId])
  const create = useCallback((draft: { shape: GameAnnotation['shape'] }) => { setPendingShape(draft.shape); setAnnotating(false) }, [])
  const save = useCallback((description: string) => {
    if (editing !== null) {
      void persist(annotations.map(annotation => annotation.id === editing.id ? { ...annotation, description } : annotation))
      setEditing(null)
      return
    }
    if (!pendingShape || !sessionId) return
    const labels = new Set(annotations.map(annotation => annotation.label))
    let index = 0
    while (labels.has(annotationLabel(index))) index += 1
    const annotation: GameAnnotation = { sessionId, id: crypto.randomUUID(), label: annotationLabel(index), shape: pendingShape, description, createdAt: Date.now() }
    void persist([...annotations, annotation])
    setPendingShape(null)
  }, [annotations, editing, pendingShape, persist, sessionId])
  const remove = useCallback((id: string) => { void persist(annotations.filter(annotation => annotation.id !== id)) }, [annotations, persist])
  const focus = useCallback((id: string) => { setActiveId(id); window.setTimeout(() => setActiveId(current => current === id ? undefined : current), 1200) }, [])
  const statusLabel = useMemo(() => ({ idle: '未启动', starting: '启动中', connected: '已连接', failed: '启动失败', disconnected: '已断开', reconnecting: '正在重连', unsupported: '当前平台不支持' }[game.status]), [game.status])
  return <div className={css.workspace} data-game-status={game.status}>
    <header className={css.toolbar}><div><strong>{game.gameName ?? currentCwd?.split(/[\\/]/).pop() ?? 'Minecraft'}</strong><span className={css.status} data-status={game.status}>{statusLabel}</span></div><div className={css.toolbarActions}><button type="button" className={css.annotateButton} onClick={() => setAnnotating(value => !value)} disabled={game.status !== 'connected'} aria-label="标注游戏区域" title="标注游戏区域">⌖ 标注游戏区域</button><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('craftcode:game-reconnect'))} disabled={game.status !== 'disconnected' && game.status !== 'failed'}>重连</button></div></header>
    <div className={css.surfaceFrame} style={{ aspectRatio: game.aspectRatio ?? 16 / 9 }}><div className={css.surfaceContent}>{game.status === 'connected' && game.surfaceUrl ? <video src={game.surfaceUrl} autoPlay muted playsInline /> : <div className={css.surfaceState}><strong>{statusLabel}</strong><span>{game.error ?? (game.status === 'unsupported' ? '暂无可用的游戏画面 provider' : '启动游戏后将在这里显示真实画面')}</span></div>}{(annotating || pendingShape) && game.status === 'connected' && <AnnotationLayer annotations={annotations} activeId={activeId} onCreate={create} onFocus={focus} />}{(pendingShape || editing) && <AnnotationPopover initialValue={editing?.description} onSave={save} onCancel={() => { setPendingShape(null); setEditing(null) }} />}</div></div>
    <AnnotationContextList annotations={annotations} onFocus={focus} onEdit={annotation => setEditing(annotation)} onDelete={remove} />
  </div>
}
