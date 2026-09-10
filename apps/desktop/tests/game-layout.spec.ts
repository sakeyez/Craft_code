import { describe, expect, it } from 'vitest'
import { followGameBounds, initialGameLayout } from '../src/game-layout.ts'

describe('independent game layout', () => {
  it.each([
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1536, y: -200, width: 1536, height: 832 },
    { x: 100, y: 300, width: 1024, height: 496 },
  ])('keeps both windows inside $width x $height at ($x, $y)', (workArea) => {
    const layout = initialGameLayout(workArea)!
    expect(layout.game.x).toBe(workArea.x + 8)
    expect(layout.game.y).toBe(workArea.y + 8)
    expect(layout.game.width).toBeGreaterThanOrEqual(640)
    expect(layout.game.height).toBeGreaterThanOrEqual(480)
    expect(layout.panel.x).toBe(layout.game.x + layout.game.width + 8)
    expect(layout.panel.x + layout.panel.width).toBe(workArea.x + workArea.width - 8)
    expect(layout.panel.height).toBe(layout.game.height)
    expect(layout.panel.y).toBe(layout.game.y)
    expect(layout.panel.width).toBeGreaterThanOrEqual(360)
    expect(layout.panel.width).toBeLessThanOrEqual(520)
  })

  it('declines insufficient work areas instead of overlapping or reducing game minimums', () => {
    expect(initialGameLayout({ x: 0, y: 0, width: 1023, height: 900 })).toBeUndefined()
    expect(initialGameLayout({ x: 0, y: 0, width: 1600, height: 495 })).toBeUndefined()
  })

  it('preserves the requested panel width and refuses left/overlay fallbacks', () => {
    const area = { x: 0, y: 0, width: 1600, height: 900 }
    const game = { x: 8, y: 8, width: 1000, height: 700 }
    expect(followGameBounds(game, area, 380)).toEqual({ x: 1016, y: 8, width: 380, height: 700 })
    expect(followGameBounds({ ...game, x: 600 }, area, 380)).toBeUndefined()
    expect(followGameBounds({ ...game, y: 300 }, area, 380)).toBeUndefined()
  })
})
