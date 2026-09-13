/* oxlint-disable */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GameAnnotation } from '@deepseek-ai/dsh-session/types'
import {
  type GameAnnotationRequest,
  type GameSurfaceState,
} from './game.ts'
import css from './GameWorkspace.module.css'

export type GameWorkspaceProps = PropsRuntime<'game'> & {
  annotate: ((annotations: GameAnnotation[]) => Promise<unknown>) | undefined
  reconnect: (cwd: string) => Promise<GameSurfaceState>
  bindAnnotationShortcut?: (request: GameAnnotationRequest, listener: (error?: string) => void) => () => void
  beginAnnotation: (request: GameAnnotationRequest) => Promise<void>
  endAnnotation: (operationId: string) => Promise<void>
  reposition: (cwd: string) => Promise<void>
}

export function GameWorkspace({ useSession, sessionId, cwd, state: game, annotate, reconnect, bindAnnotationShortcut, beginAnnotation, endAnnotation, reposition }: GameWorkspaceProps) {
  const operation = useRef<string>()
  const [annotating, setAnnotating] = useState(false)
  const [captureError, setCaptureError] = useState<string>()
  const annotations = useSession(snapshot => snapshot?.annotations ?? []) ?? []
  useEffect(() => {
    setAnnotating(false)
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
  const startRef = useRef(startAnnotation)
  startRef.current = startAnnotation
  useEffect(() => {
    if (!cwd || !sessionId || !annotate || game.status !== 'connected' || !bindAnnotationShortcut) return
    return bindAnnotationShortcut({ cwd, sessionId, operationId: crypto.randomUUID(), labels: [] }, error => {
      if (error) setCaptureError(error)
      else void startRef.current()
    })
  }, [cwd, sessionId, !!annotate, game.status, bindAnnotationShortcut])
  const statusLabel = useMemo(() => ({ idle: '未启动', starting: '启动中', connected: '已连接', failed: '启动失败', disconnected: '已断开', reconnecting: '正在重连', unsupported: '当前平台不支持' }[game.status]), [game.status])
  return <div className={css.workspace} data-game-status={game.status}>
    <header className={css.toolbar}>
      <div><strong>{('gameName' in game ? game.gameName : undefined) ?? cwd?.split(/[\\/]/).pop() ?? 'Minecraft'}</strong><span className={css.status} data-status={game.status}>{statusLabel}</span></div>
      <div className={css.toolbarActions}>
        <button type="button" className={css.annotateButton} onClick={() => { void startAnnotation() }} disabled={annotating || !annotate || sessionId === undefined || game.status !== 'connected'} aria-label="在游戏画面上标注" title="在 Minecraft 画面上添加标注（Ctrl+Shift+P）"><span>{annotating ? '画面定格中…' : '在游戏上标注'}</span><kbd>Ctrl+Shift+P</kbd></button>
        <button type="button" aria-label="重新定位面板" title="重新定位面板" onClick={() => {
          if (cwd === undefined) return
          setCaptureError(undefined)
          void reposition(cwd).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) })
        }} disabled={annotating || cwd === undefined || game.status !== 'connected'}>重新定位</button>
        {(game.status === 'disconnected' || game.status === 'failed') && <button type="button" onClick={() => { if (cwd !== undefined) void reconnect(cwd).catch(error => { setCaptureError(error instanceof Error ? error.message : String(error)) }) }} disabled={cwd === undefined || (game.status !== 'disconnected' && game.status !== 'failed')}>重连</button>}
      </div>
    </header>
    {(captureError !== undefined || game.status !== 'connected') && <div className={css.companionStatus}>{captureError ?? (game.status === 'unsupported' ? 'Minecraft 将在独立窗口中运行。' : ('error' in game ? game.error : '等待 Minecraft 窗口。'))}</div>}
  </div>
}
