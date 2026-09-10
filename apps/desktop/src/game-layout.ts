/** DIP geometry for two independent, non-overlapping desktop windows. */
import type { Rectangle } from 'electron'

const MARGIN = 8
const GAP = 8
export const MIN_PANEL_WIDTH = 360
export const MAX_PANEL_WIDTH = 520
const PANEL_RATIO = 0.26

/** Return no layout when the work area cannot accommodate both minimum sizes. */
export function initialGameLayout(workArea: Rectangle): { game: Rectangle; panel: Rectangle } | undefined {
  const available = workArea.width - MARGIN * 2 - GAP
  const height = workArea.height - MARGIN * 2
  if (available < 640 + MIN_PANEL_WIDTH || height < 480) return undefined
  const panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(available * PANEL_RATIO)), available - 640)
  const game = { x: workArea.x + MARGIN, y: workArea.y + MARGIN, width: available - panelWidth, height }
  return { game, panel: { x: game.x + game.width + GAP, y: game.y, width: panelWidth, height } }
}

/** Follow only on the right and only while the complete panel fits the work area. */
export function followGameBounds(game: Rectangle, workArea: Rectangle, width: number): Rectangle | undefined {
  const panel = { x: game.x + game.width + GAP, y: game.y, width: Math.max(MIN_PANEL_WIDTH, width), height: game.height }
  if (panel.x < workArea.x || panel.y < workArea.y || panel.height < 1
    || panel.x + panel.width > workArea.x + workArea.width
    || panel.y + panel.height > workArea.y + workArea.height) return undefined
  return panel
}

/** Allow physical-pixel rounding without repeatedly repositioning a stable window. */
export function rectanglesMatch(left: Rectangle, right: Rectangle, tolerance = 2): boolean {
  return Math.abs(left.x - right.x) <= tolerance && Math.abs(left.y - right.y) <= tolerance
    && Math.abs(left.width - right.width) <= tolerance && Math.abs(left.height - right.height) <= tolerance
}
