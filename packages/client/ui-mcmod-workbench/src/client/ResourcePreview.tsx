/** Lazy canvas preview for generated items and axis-aligned vanilla model faces. */
import { useEffect, useRef } from 'react'
import type { ResourcePreview as Preview } from '@deepseek-ai/dsh-mc-workbench/types'

export default function ResourcePreview({
  value,
  open,
}: {
  value: Preview
  open: (path: string, line?: number) => Promise<void>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let disposed = false
    const draw = async (): Promise<void> => {
      const images = new Map<string, HTMLImageElement>()
      await Promise.all(
        Object.entries(value.images).map(async ([name, url]) => {
          const image = new Image()
          image.src = url
          await image.decode()
          images.set(name, image)
        }),
      )
      if (disposed) return
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, 400, 320)
      ctx.imageSmoothingEnabled = false
      if (value.kind === 'png' || value.kind === 'generated') {
        for (const [name, image] of [...images].sort(([a], [b]) => a.localeCompare(b)))
          if (value.kind === 'png' || /^layer\d+$/u.test(name)) ctx.drawImage(image, 80, 40, 240, 240)
        return
      }
      if (value.kind !== 'model') return
      const project = ([x, y, z]: number[]) =>
        [200 + ((x ?? 0) - (z ?? 0)) * 7, 235 + ((x ?? 0) + (z ?? 0)) * 3.5 - (y ?? 0) * 9] as const
      const elements = [...value.elements].sort(
        (a, b) => a.from[0] + a.from[2] + a.from[1] - (b.from[0] + b.from[2] + b.from[1]),
      )
      for (const element of elements) {
        const [x, y, z] = element.from
        const [X, Y, Z] = element.to
        const faces = [
          {
            name: 'south',
            points: [
              [x, Y, Z],
              [X, Y, Z],
              [X, y, Z],
              [x, y, Z],
            ],
            uv: [x, 16 - Y, X, 16 - y],
          },
          {
            name: 'east',
            points: [
              [X, Y, Z],
              [X, Y, z],
              [X, y, z],
              [X, y, Z],
            ],
            uv: [16 - Z, 16 - Y, 16 - z, 16 - y],
          },
          {
            name: 'up',
            points: [
              [x, Y, z],
              [X, Y, z],
              [X, Y, Z],
              [x, Y, Z],
            ],
            uv: [x, z, X, Z],
          },
        ]
        for (const item of faces) {
          const face = element.faces[item.name]
          if (!face) continue
          const image = images.get(face.texture.slice(1))
          if (!image) continue
          const [a, b, c, d] = item.points.map(project)
          if (!a || !b || !c || !d) continue
          const [u = 0, v = 0, U = 16, V = 16] = face.uv ?? item.uv
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(...a)
          ctx.lineTo(...b)
          ctx.lineTo(...c)
          ctx.lineTo(...d)
          ctx.closePath()
          ctx.clip()
          ctx.transform((b[0] - a[0]) / 16, (b[1] - a[1]) / 16, (d[0] - a[0]) / 16, (d[1] - a[1]) / 16, a[0], a[1])
          ctx.drawImage(
            image,
            (u / 16) * image.width,
            (v / 16) * image.height,
            ((U - u) / 16) * image.width,
            ((V - v) / 16) * image.height,
            0,
            0,
            16,
            16,
          )
          ctx.restore()
        }
      }
    }
    void draw().catch(() => {})
    return () => {
      disposed = true
    }
  }, [value])
  return (
    <section aria-label="资源预览">
      {value.draft && <span>未保存</span>}
      {value.kind !== 'unsupported' && (
        <canvas ref={canvas} width={400} height={320} role="img" aria-label={value.path} style={{ maxWidth: '100%' }} />
      )}
      {[...value.unsupported, ...value.missing.map(path => `缺少：${path}`)].map(text => (
        <p key={text}>{text}</p>
      ))}
      {value.generatedSources.map(path => (
        <button key={path} onClick={() => void open(path)}>
          生成源候选：{path}
        </button>
      ))}
      {value.issues.map((issue, index) => (
        <button key={index} onClick={() => void open(issue.path)}>
          {issue.message}
        </button>
      ))}
      {!!value.references.length && (
        <details>
          <summary>引用</summary>
          {value.references.map((ref, index) => (
            <div key={index}>
              <button onClick={() => void open(ref.path, ref.line)}>
                {ref.path}:{ref.line}
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  )
}
