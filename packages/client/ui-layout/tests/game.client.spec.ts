import { describe, expect, it } from 'vitest'
import { annotationBounds, annotationLabel, clampNormalized, normalizePoint } from '../src/client/game.ts'

describe('game annotation geometry', () => {
  it('clamps normalized coordinates and keeps stable labels', () => {
    expect(normalizePoint({ x: -1, y: 1.5 })).toEqual({ x: 0, y: 1 })
    expect(clampNormalized(Number.NaN)).toBe(0)
    expect([0, 1, 25, 26, 27].map(annotationLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })

  it('derives freehand bounds in normalized space', () => {
    const bounds = annotationBounds({ sessionId: 's' as never, id: 'a', label: 'A', shape: { type: 'freehand', geometry: { points: [{ x: .8, y: .7 }, { x: .2, y: .1 }] } }, description: '', createdAt: 0 })
    expect(bounds.x).toBeCloseTo(.2)
    expect(bounds.y).toBeCloseTo(.1)
    expect(bounds.width).toBeCloseTo(.6)
    expect(bounds.height).toBeCloseTo(.6)
  })
})
