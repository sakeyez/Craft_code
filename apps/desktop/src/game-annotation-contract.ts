/** Serializable input to one desktop annotation transaction; native handles stay in main. */
export interface AnnotationRequest {
  operationId: string
  cwd: string
  sessionId: string
  labels: string[]
}

/** Stable draft identity makes a retried full-list save idempotent. */
export interface AnnotationDraft {
  id: string
  label: string
  createdAt: number
  description: string
  shape: { type: 'point'; geometry: { x: number; y: number } }
    | { type: 'rect'; geometry: { x: number; y: number; width: number; height: number } }
}

/** Captured frame returned with a successful annotation transaction. */
export interface AnnotationSnapshot {
  dataUrl: string
  width: number
  height: number
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Bound all wire inputs before allocating a window or forwarding a save. */
export function isAnnotationRequest(value: unknown): value is AnnotationRequest {
  return record(value) && Object.keys(value).every(key => ['operationId', 'cwd', 'sessionId', 'labels'].includes(key))
    && typeof value.operationId === 'string' && /^[\da-f-]{36}$/iu.test(value.operationId)
    && typeof value.cwd === 'string' && value.cwd.length <= 32768
    && typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 256
    && Array.isArray(value.labels) && value.labels.length <= 1000
    && value.labels.every(label => typeof label === 'string' && /^[A-Z]{1,8}$/u.test(label))
}

/** Accept only finite, bounded point/rectangle drafts produced by the overlay. */
export function isAnnotationDrafts(value: unknown): value is AnnotationDraft[] {
  if (!Array.isArray(value) || value.length > 100) return false
  const ids = new Set<string>(); const labels = new Set<string>()
  return value.every((item) => {
    if (!record(item) || Object.keys(item).some(key => !['id', 'label', 'createdAt', 'description', 'shape'].includes(key))
      || typeof item.id !== 'string' || !/^[\da-f-]{36}$/iu.test(item.id) || ids.has(item.id)
      || typeof item.label !== 'string' || !/^[A-Z]{1,8}$/u.test(item.label) || labels.has(item.label)
      || typeof item.createdAt !== 'number' || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0
      || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 10000
      || !record(item.shape) || Object.keys(item.shape).some(key => !['type', 'geometry'].includes(key))
      || !record(item.shape.geometry)) return false
    const shape = item.shape; const geometry = shape.geometry as Record<string, unknown>
    const keys = shape.type === 'point' ? ['x', 'y'] : shape.type === 'rect' ? ['x', 'y', 'width', 'height'] : []
    if (!keys.length || Object.keys(geometry).length !== keys.length
      || !keys.every(key => typeof geometry[key] === 'number' && Number.isFinite(geometry[key]) && geometry[key] >= 0 && geometry[key] <= 1)) return false
    if (shape.type === 'rect' && ((geometry.x as number) + (geometry.width as number) > 1.000001
      || (geometry.y as number) + (geometry.height as number) > 1.000001)) return false
    ids.add(item.id); labels.add(item.label)
    return true
  })
}
