import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadArtifact } from '../src/transfer.ts'
import { NetworkOperation } from '../src/network.ts'
import { classifyFailure } from '../src/failures.ts'

const roots: string[] = []
const bytes = Buffer.from('verified Minecraft artifact 测试')
const sha = createHash('sha256').update(bytes).digest('hex')
async function request() {
  const root = await mkdtemp(join(tmpdir(), 'craftcode-transfer-'))
  roots.push(root)
  return {
    url: 'https://example.com/artifact',
    destination: join(root, sha),
    digest: { algorithm: 'sha256' as const, value: sha },
    maxBytes: 1024,
  }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('verified artifact transfers', () => {
  it('repairs corrupt cache and reuses only verified bytes', async () => {
    const input = await request()
    await writeFile(input.destination, 'bad')
    const fetcher = vi.fn(async () => new Response(bytes))
    vi.stubGlobal('fetch', fetcher)
    await downloadArtifact(input)
    expect(await readFile(input.destination)).toEqual(bytes)
    await downloadArtifact(input)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('resumes a publisher-identified partial and validates the complete digest', async () => {
    const input = await request()
    await writeFile(`${input.destination}.part`, bytes.subarray(0, 5))
    await writeFile(`${input.destination}.part.json`, `sha256:${sha}`)
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('range')).toBe('bytes=5-')
      return new Response(bytes.subarray(5), {
        status: 206,
        headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` },
      })
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await downloadArtifact(input)).toBe(input.destination)
    expect(await readFile(input.destination)).toEqual(bytes)
  })
  it('restarts when a source ignores Range', async () => {
    const input = await request()
    await writeFile(`${input.destination}.part`, bytes.subarray(0, 5))
    await writeFile(`${input.destination}.part.json`, `sha256:${sha}`)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    )
    await downloadArtifact(input)
    expect(await readFile(input.destination)).toEqual(bytes)
  })
  it('does not publish wrong hashes or oversized downloads', async () => {
    const input = await request()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('wrong')),
    )
    await expect(downloadArtifact(input)).rejects.toThrow('校验失败')
    await expect(readFile(input.destination)).rejects.toThrow()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes)),
    )
    await expect(downloadArtifact({ ...input, maxBytes: 4 })).rejects.toThrow('大小限制')
  })
  it('shares work without propagating one consumer cancellation', async () => {
    const input = await request()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const fetcher = vi.fn(async () => {
      await gate
      return new Response(bytes)
    })
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const first = downloadArtifact({ ...input, signal: controller.signal })
    const cancelled = expect(first).rejects.toThrow('cancelled')
    const second = downloadArtifact(input)
    controller.abort(new Error('cancelled'))
    release()
    await cancelled
    await expect(second).resolves.toBe(input.destination)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retains bytes on a broken stream and resumes the next attempt', async () => {
    const input = await request()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (++calls === 1) {
          let pulled = false
          return new Response(
            new ReadableStream({
              pull(controller) {
                if (pulled) controller.error(new Error('connection reset'))
                else {
                  pulled = true
                  controller.enqueue(bytes.subarray(0, 5))
                }
              },
            }),
          )
        }
        expect(new Headers(init.headers).get('range')).toBe('bytes=5-')
        return new Response(bytes.subarray(5), {
          status: 206,
          headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` },
        })
      }),
    )
    await downloadArtifact(input)
    expect(calls).toBe(2)
    expect(await readFile(input.destination)).toEqual(bytes)
  })
  it.each([416, 206])('resets rejected or inconsistent Range responses (%s)', async (status) => {
    const input = await request()
    await writeFile(`${input.destination}.part`, bytes.subarray(0, 5))
    await writeFile(`${input.destination}.part.json`, `sha256:${sha}`)
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        if (++calls === 1) return new Response('', { status, headers: { 'content-range': 'bytes 5-3/2' } })
        expect(new Headers(init.headers).get('range')).toBeNull()
        return new Response(bytes)
      }),
    )
    await downloadArtifact(input)
    expect(await readFile(input.destination)).toEqual(bytes)
  })
  it('does not reuse bytes from an older publication identity', async () => {
    const input = await request()
    await writeFile(`${input.destination}.part`, 'old')
    await writeFile(`${input.destination}.part.json`, 'sha256:' + 'a'.repeat(64))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(new Headers(init.headers).get('range')).toBeNull()
        return new Response(bytes)
      }),
    )
    await downloadArtifact(input)
  })
  it('reports a long rate limit without sleeping or obscuring its failure kind', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '3600' } }))
    vi.stubGlobal('fetch', fetcher)
    const error: unknown = await downloadArtifact(await request()).catch((error: unknown) => error)
    expect(classifyFailure(error)).toEqual({ kind: 'rate-limit', retryable: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['ENOSPC', 'EACCES'])('does not retry network routes after disk error %s', async (code) => {
    const fetcher = vi.fn(async () => new Response(bytes))
    vi.stubGlobal('fetch', fetcher)
    const error = Object.assign(new Error('disk failure'), { code })
    await expect(
      new NetworkOperation({ mode: 'direct', proxyUrl: '' }).fetch(
        'https://example.com/file',
        {},
        1024,
        undefined,
        async (response) => {
          await response.body?.cancel()
          throw error
        },
      ),
    ).rejects.toBe(error)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(classifyFailure(error).retryable).toBe(true)
  })
})
