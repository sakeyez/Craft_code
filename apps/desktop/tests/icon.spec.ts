import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { decodeEmbeddedPng } from '../src/icon.ts'

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
const EXPECTED_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

describe('desktop brand icon', () => {
  it('decodes the PNG embedded in the Web favicon', () => {
    const png = decodeEmbeddedPng(`<svg><image href="data:image/png;base64,${ONE_PIXEL_PNG}"/></svg>`)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })

  it('rejects missing or invalid embedded images', () => {
    expect(() => decodeEmbeddedPng('<svg/>')).toThrow('does not contain an embedded PNG')
    expect(() => decodeEmbeddedPng('<svg><image href="data:image/png;base64,YmFk"/></svg>'))
      .toThrow('contains an invalid PNG')
  })

  it('ships a multi-size ICO resource for desktop packaging', () => {
    const path = fileURLToPath(new URL('../src/CraftCode.ico', import.meta.url))
    expect(existsSync(path)).toBe(true)
    const ico = readFileSync(path)
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(EXPECTED_ICON_SIZES.length)

    const entries = EXPECTED_ICON_SIZES.map((_expectedSize, index) => {
      const entryOffset = 6 + index * 16
      const dataLength = ico.readUInt32LE(entryOffset + 8)
      const dataOffset = ico.readUInt32LE(entryOffset + 12)
      const dimension = (value: number): number => value === 0 ? 256 : value
      expect(dataOffset + dataLength).toBeLessThanOrEqual(ico.length)
      return {
        declaredWidth: dimension(ico.readUInt8(entryOffset)),
        declaredHeight: dimension(ico.readUInt8(entryOffset + 1)),
        planes: ico.readUInt16LE(entryOffset + 4),
        bitsPerPixel: ico.readUInt16LE(entryOffset + 6),
        signature: ico.subarray(dataOffset, dataOffset + 8).toString('hex'),
        pngWidth: ico.readUInt32BE(dataOffset + 16),
        pngHeight: ico.readUInt32BE(dataOffset + 20),
        pngBitDepth: ico.readUInt8(dataOffset + 24),
        pngColorType: ico.readUInt8(dataOffset + 25),
      }
    })

    expect(entries).toEqual(EXPECTED_ICON_SIZES.map(size => ({
      declaredWidth: size,
      declaredHeight: size,
      planes: 1,
      bitsPerPixel: 32,
      signature: '89504e470d0a1a0a',
      pngWidth: size,
      pngHeight: size,
      pngBitDepth: 8,
      pngColorType: 6,
    })))
  })
})
