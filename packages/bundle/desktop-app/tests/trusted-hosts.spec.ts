import { describe, expect, it } from 'vitest'
import { desktopRuntimeValues } from '../src/index.ts'

describe('desktopRuntimeValues', () => {
  it('does not grant non-loopback authorities', () => {
    expect(desktopRuntimeValues()).toEqual({ trustedHosts: [] })
  })
})
