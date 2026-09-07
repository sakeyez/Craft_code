import type { GameAnnotation, AnnotationShape, NormalizedPoint } from '@deepseek-ai/dsh-session/types'

/** Lifecycle status reported by the desktop external-window provider. */
export type GameSurfaceStatus = 'idle' | 'starting' | 'connected' | 'failed' | 'disconnected' | 'reconnecting' | 'unsupported'
/** Strict state carried by a project-scoped external-game event. */
export type GameSurfaceState =
  | { status: 'idle' }
  | { status: 'starting' | 'reconnecting'; gameName?: string }
  | { status: 'connected'; gameName?: string; surfaceKind: 'external-window' }
  | { status: 'failed' | 'disconnected' | 'unsupported'; gameName?: string; error: string }
/** Project-scoped external-game update from the desktop host. */
export interface GameSurfaceEvent { cwd: string; state: GameSurfaceState }
/** JPEG snapshot returned for the current annotation interaction. */
export interface GameSurfaceSnapshot { dataUrl: string; width: number; height: number }
/** Renderer operations backed by the desktop game capture provider. */
export interface GameSurfaceBridge {
  reconnect(cwd: string): Promise<GameSurfaceState>
  beginAnnotation(cwd: string): Promise<GameSurfaceSnapshot>
  endAnnotation(cwd: string): Promise<void>
  reposition(cwd: string): Promise<void>
}

/** Normalize Windows project aliases while preserving case-sensitive POSIX paths.
 * @param cwd Project path received from the host.
 * @returns Canonical lookup key for the project.
 */
export function gameProjectKey(cwd: string): string {
  return /^[A-Za-z]:[\\/]/u.test(cwd) ? cwd.replaceAll('\\', '/').toLowerCase() : cwd
}
/** Unsaved annotation data collected by the game workspace. */
export interface GameAnnotationDraft {
  shape: AnnotationShape
  description: string
  screenshotRef?: string
}
/** Clamp a coordinate or dimension to the normalized captured-game range.
 * @param value Coordinate or dimension to clamp.
 * @returns A finite value in the inclusive 0..1 range.
 */
export function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

/** Normalize both coordinates of a point.
 * @param point Point in normalized game-surface coordinates.
 * @returns A point with both coordinates clamped.
 */
export function normalizePoint(point: NormalizedPoint): NormalizedPoint {
  return { x: clampNormalized(point.x), y: clampNormalized(point.y) }
}

/** Return the stable spreadsheet-style label for an annotation index.
 * @param index Zero-based annotation index.
 * @returns Stable alphabetic label.
 */
export function annotationLabel(index: number): string {
  let n = Math.max(0, Math.floor(index))
  let result = ''
  do {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

/** Compute the normalized bounding rectangle used to place an annotation label.
 * @param annotation Annotation whose geometry should be measured.
 * @returns Bounding rectangle in normalized coordinates.
 */
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
