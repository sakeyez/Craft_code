const PNG_DATA_URI_PREFIX = 'data:image/png;base64,'

/** Decode the single PNG image embedded in the Web favicon SVG. */
export function decodeEmbeddedPng(svg: string): Buffer {
  const href = /<image\b[^>]*\bhref=(['"])(data:image\/png;base64,[A-Za-z0-9+/=]+)\1/u.exec(svg)?.[2]
  if (href === undefined) throw new Error('Web favicon does not contain an embedded PNG image')

  const png = Buffer.from(href.slice(PNG_DATA_URI_PREFIX.length), 'base64')
  const signature = png.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('Web favicon contains an invalid PNG image')
  return png
}
