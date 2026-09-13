import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GameAnnotation } from '@deepseek-ai/dsh-session/types'
import css from './AnnotationContext.module.css'

type Props = PropsRuntime<'conversation.input.annotations'> & {
  save: (annotations: GameAnnotation[]) => Promise<void>
  resolveImage: (reference: string) => Promise<string>
}

function Screenshot({ reference, resolveImage, compact = false }: { reference: string; resolveImage: Props['resolveImage']; compact?: boolean }) {
  const preview = useRef<HTMLDialogElement>(null)
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setUrl(undefined); setFailed(false)
    void resolveImage(reference).then((value) => { if (active) setUrl(value) }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [reference, resolveImage])
  if (compact) return url ? <img src={url} alt="" /> : <span aria-hidden="true">…</span>
  return url ? <>
    <button type="button" aria-label="查看标注截图" onClick={() => { preview.current?.showModal() }}><img src={url} alt="Minecraft 标注截图" /></button>
    <dialog ref={preview} className={css.preview} aria-label="标注截图预览">
      <button type="button" onClick={() => { preview.current?.close() }}>关闭截图</button>
      <img src={url} alt="Minecraft 标注截图原图" />
    </dialog>
  </> : <span>{failed ? '截图不可用' : '加载截图…'}</span>
}

/** Session-owned annotations remain attached to the composer across game disconnects. */
export function AnnotationContext({ useSession, sessionId, locked, save, resolveImage }: Props) {
  const annotations = useSession(snapshot => snapshot.annotations) ?? []
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => { setOpen(false); setEditing(undefined); setError(undefined) }, [sessionId])
  const persist = async (next: GameAnnotation[]) => {
    if (busy || locked) return
    setBusy(true); setError(undefined)
    try { await save(next); setEditing(undefined) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  if (annotations.length === 0) return null
  const refs = [...new Set(annotations.flatMap(annotation => annotation.screenshotRef ? [annotation.screenshotRef] : []))]
  return <section className={css.context} aria-label="游戏标注上下文" onMouseEnter={() => { setOpen(true) }} onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement) && !editing) setOpen(false) }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !editing) setOpen(false) }} onKeyDown={(event) => { if (event.key === 'Escape') { setEditing(undefined); setOpen(false); event.stopPropagation() } }}>
    <div className={css.rail}>
      <button className={css.chip} type="button" aria-expanded={open} onFocus={() => { setOpen(true) }} onClick={() => { setOpen(true) }}>
        {refs[0] && <Screenshot reference={refs[0]} resolveImage={resolveImage} compact />}
        <span>{annotations.length} 条标注</span>
      </button>
    </div>
    {open && <div className={css.details} data-annotation-items>
      {refs.length > 0 && <div className={css.images}>
        {refs.map(reference => <Screenshot key={reference} reference={reference} resolveImage={resolveImage} />)}
      </div>}
      {annotations.map(annotation => <article key={annotation.id}>
        <strong>{annotation.label}</strong><p>{annotation.description || '未填写说明'}</p>
        <button type="button" disabled={locked || busy} onClick={() => { setEditing(annotation.id); setDescription(annotation.description); setError(undefined) }}>编辑</button>
        <button type="button" disabled={locked || busy} aria-label={`删除标注 ${annotation.label}`} onClick={() => { void persist(annotations.filter(item => item.id !== annotation.id)) }}>删除</button>
      </article>)}
      {editing && <form role="dialog" aria-label="编辑游戏标注" onSubmit={(event) => { event.preventDefault(); void persist(annotations.map(item => item.id === editing ? { ...item, description: description.trim() } : item)) }}>
        <textarea autoFocus aria-label="标注说明" value={description} onChange={(event) => { setDescription(event.target.value) }} rows={2} disabled={busy} />
        <button type="button" disabled={busy} onClick={() => { setEditing(undefined) }}>取消</button><button type="submit" disabled={busy || !description.trim()}>保存标注</button>
      </form>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>
}
