/* The overlay owns only unsaved drafts. Persistence is acknowledged by the bound conversation. */
const bridge = window.gameAnnotation
const element = id => document.getElementById(id)
const surface = element('surface'), snapshot = element('snapshot'), editor = element('editor')
const description = element('description'), discard = element('discard'), error = element('error')
let operationId
let drafts = [], labels = [], editing, pending, start, saving = false

function messageOf(value) { return value instanceof Error ? value.message : String(value || '操作失败') }
function report(value) { error.textContent = value || ''; error.hidden = !value }
function labelAt(index) {
  let result = ''
  do { result = String.fromCharCode(65 + index % 26) + result; index = Math.floor(index / 26) - 1 } while (index >= 0)
  return result
}
function nextLabel() {
  const used = new Set([...labels, ...drafts.map(draft => draft.label)])
  let index = 0
  while (used.has(labelAt(index))) index++
  return labelAt(index)
}
function position(node, geometry) {
  Object.assign(node.style, { left: `${geometry.x * 100}%`, top: `${geometry.y * 100}%`, width: `${(geometry.width || 0) * 100}%`, height: `${(geometry.height || 0) * 100}%` })
}
function render() {
  element('marks').replaceChildren()
  for (const draft of drafts) {
    const mark = document.createElement('div')
    mark.className = `mark ${draft.shape.type === 'point' ? 'point' : ''} ${draft.shape.geometry.y < .06 ? 'at-top' : ''}`
    position(mark, draft.shape.geometry)
    if (draft.shape.type === 'point') { mark.style.width = '12px'; mark.style.height = '12px' }
    const button = document.createElement('button')
    button.textContent = draft.label
    button.setAttribute('aria-label', `编辑标注 ${draft.label}`)
    button.title = draft.description
    button.disabled = saving
    button.onpointerdown = event => event.stopPropagation()
    button.onclick = () => openEditor(draft)
    mark.append(button); element('marks').append(mark)
  }
  element('count').textContent = `${drafts.length} 条标注`
  element('finish').textContent = saving ? '正在保存…' : '完成'
  element('finish').disabled = saving
  element('cancel').disabled = saving
}
function openEditor(draft) {
  editing = draft
  description.value = draft?.description || ''
  element('delete').hidden = !draft
  editor.showModal()
  const geometry = (draft?.shape || pending)?.geometry
  const rect = editor.getBoundingClientRect()
  const left = (geometry?.x || 0) * innerWidth
  const top = ((geometry?.y || 0) + (geometry?.height || 0)) * innerHeight + 8
  editor.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`
  editor.style.top = `${Math.max(52, Math.min(top, innerHeight - rect.height - 8))}px`
  description.focus()
}
function closeEditor() { editor.close(); editing = undefined; pending = undefined; element('selection').hidden = true }
function cancel() {
  if (saving) return
  if (drafts.length) discard.showModal()
  else void bridge.cancel(operationId).catch(failure => report(messageOf(failure)))
}
function point(event) {
  const rect = surface.getBoundingClientRect()
  const width = rect.width || 1, height = rect.height || 1
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / height)) }
}
function rectangle(end) { return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) } }
surface.onpointerdown = event => {
  if (saving || editor.open || discard.open || event.button !== 0) return
  if (drafts.length >= 100) { report('每轮最多添加 100 条标注。'); return }
  start = point(event); surface.setPointerCapture(event.pointerId)
}
surface.onpointermove = event => {
  if (!start) return
  const selection = element('selection'); selection.hidden = false; position(selection, rectangle(point(event)))
}
surface.onpointerup = event => {
  if (!start) return
  const end = point(event), geometry = rectangle(end), rect = surface.getBoundingClientRect()
  pending = geometry.width * rect.width < 5 && geometry.height * rect.height < 5
    ? { type: 'point', geometry: end } : { type: 'rect', geometry }
  start = undefined
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
  openEditor()
}
surface.onpointercancel = event => {
  start = undefined; element('selection').hidden = true
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
}
element('edit-form').onsubmit = event => {
  event.preventDefault()
  const text = description.value.trim()
  if (!text) { description.focus(); return }
  if (editing) editing.description = text
  else if (pending) drafts.push({ id: crypto.randomUUID(), label: nextLabel(), createdAt: Date.now(), shape: pending, description: text })
  closeEditor(); report(''); render()
}
description.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); element('edit-form').requestSubmit() } }
element('edit-cancel').onclick = closeEditor
editor.oncancel = event => { event.preventDefault(); closeEditor() }
element('delete').onclick = () => { drafts = drafts.filter(draft => draft.id !== editing.id); closeEditor(); render() }
element('cancel').onclick = cancel
element('keep').onclick = () => discard.close()
element('discard-confirm').onclick = () => { void bridge.cancel(operationId).catch(failure => report(messageOf(failure))) }
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !editor.open && !discard.open) { event.preventDefault(); cancel() }
})
element('finish').onclick = async () => {
  if (saving) return
  if (!drafts.length) {
    try { await bridge.cancel(operationId) } catch (failure) { report(messageOf(failure)) }
    return
  }
  const id = operationId
  saving = true; report(''); render()
  try { const result = await bridge.submit(id, drafts); if (operationId === id && result?.error) report(result.error) }
  catch (failure) { if (operationId === id) report(messageOf(failure)) }
  finally { if (operationId === id) { saving = false; render() } }
}
function reset() {
  operationId = undefined
  drafts = []; labels = []; editing = undefined; pending = undefined; start = undefined; saving = false
  if (editor.open) editor.close()
  if (discard.open) discard.close()
  snapshot.removeAttribute('src')
  element('selection').hidden = true
  report(''); render()
}
bridge.onReset(id => { if (id === operationId) reset() })
bridge.onBegin(id => { void (async () => {
  reset(); operationId = id
  const data = await bridge.load(id)
  if (operationId !== id) return
  labels = data.labels
  snapshot.src = data.snapshot.dataUrl
  await snapshot.decode()
  if (operationId !== id) return
  if (!snapshot.naturalWidth || !snapshot.naturalHeight) throw new Error('标注截图为空，请重试。')
  render()
  await new Promise(resolve => requestAnimationFrame(resolve))
  if (operationId !== id) return
  await bridge.ready(id)
  surface.focus({ preventScroll: true })
})().catch(failure => { if (operationId === id) { report(messageOf(failure)); void bridge.cancel(id).catch(() => {}) } }) })
