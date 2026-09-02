import type { GameAnnotation, AnnotationShape, NormalizedPoint } from '@deepseek-ai/dsh-session/types'

export type GameSurfaceStatus = 'idle' | 'starting' | 'connected' | 'failed' | 'disconnected' | 'reconnecting' | 'unsupported'
export interface GameSurfaceState {
  status: GameSurfaceStatus
  gameName?: string
  surfaceUrl?: string
  aspectRatio?: number
  error?: string
}
export interface GameAnnotationDraft {
  shape: AnnotationShape
  description: string
  screenshotRef?: string
}
export function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

export function normalizePoint(point: NormalizedPoint): NormalizedPoint {
  return { x: clampNormalized(point.x), y: clampNormalized(point.y) }
}

export function annotationLabel(index: number): string {
  let n = Math.max(0, Math.floor(index))
  let result = ''
  do {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

export function annotationBounds(annotation: GameAnnotation): { x: number; y: number; width: number; height: number } {
  if (annotation.shape.type === 'point') return { x: annotation.shape.geometry.x, y: annotation.shape.geometry.y, width: 0, height: 0 }
  if (annotation.shape.type === 'rect') return annotation.shape.geometry
  const points = annotation.shape.geometry.points
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
