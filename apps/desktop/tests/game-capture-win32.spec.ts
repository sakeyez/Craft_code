import { describe, expect, it } from 'vitest'
import {
  companionBounds, descendantPids,
  selectWindowCandidate, windowCandidateScore,
} from '../src/game-capture-win32.ts'

describe('Windows game capture decisions', () => {
  it('walks the complete process tree and terminates parent cycles', () => {
    expect([...descendantPids([
      { pid: 10, parentPid: 30 },
      { pid: 20, parentPid: 10 },
      { pid: 30, parentPid: 20 },
      { pid: 40, parentPid: 20 },
    ], 10)].sort((a, b) => a - b)).toEqual([10, 20, 30, 40])
  })

  it('prefers a GLFW window and rejects stale PID identities', () => {
    const generic = { hwnd: 1n, pid: 10, className: 'SunAwtFrame', title: 'Minecraft', width: 1600, height: 900 }
    const glfw = { hwnd: 2n, pid: 20, className: 'GLFW30', title: 'Minecraft 1.21', width: 800, height: 600 }
    expect(windowCandidateScore(glfw)).toBeGreaterThan(windowCandidateScore(generic))
    expect(selectWindowCandidate([generic, glfw], new Map([[10, 'old'], [20, 'current']]), pid => (
      pid === 10 ? 'reused' : 'current'
    ))).toEqual(glfw)
  })

  it('places the companion beside the game and clips to the work area', () => {
    expect(companionBounds({ x: 1200, y: 100, width: 600, height: 900 }, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual({
      mode: 'side', bounds: { x: 712, y: 100, width: 480, height: 900 },
    })
    expect(companionBounds({ x: 100, y: 100, width: 1700, height: 900 }, { x: 0, y: 0, width: 1920, height: 1080 }).mode).toBe('compact')
  })
})
