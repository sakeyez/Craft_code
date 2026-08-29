import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256])
const FAVICON_PATH = fileURLToPath(new URL('../../web/public/favicon.svg', import.meta.url))
const OUTPUT_PATH = fileURLToPath(new URL('../src/CraftCode.ico', import.meta.url))

function encodeIco(images) {
  const headerSize = 6
  const entrySize = 16
  const directorySize = headerSize + entrySize * images.length
  const header = Buffer.alloc(directorySize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let dataOffset = directorySize
  for (const [index, image] of images.entries()) {
    const entryOffset = headerSize + entrySize * index
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset)
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1)
    header.writeUInt8(0, entryOffset + 2)
    header.writeUInt8(0, entryOffset + 3)
    header.writeUInt16LE(1, entryOffset + 4)
    header.writeUInt16LE(32, entryOffset + 6)
    header.writeUInt32LE(image.png.length, entryOffset + 8)
    header.writeUInt32LE(dataOffset, entryOffset + 12)
    dataOffset += image.png.length
  }

  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

const images = await Promise.all(ICON_SIZES.map(async (size) => ({
  size,
  png: await sharp(FAVICON_PATH)
    .resize(size, size, { fit: 'fill' })
    .ensureAlpha()
    .png({ compressionLevel: 9, palette: false })
    .toBuffer(),
})))

await writeFile(OUTPUT_PATH, encodeIco(images))
console.log(`Generated ${OUTPUT_PATH} with sizes ${ICON_SIZES.join(', ')}`)
