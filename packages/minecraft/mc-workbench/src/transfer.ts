/** Verified resumable files in application-owned storage; consumers share one in-flight transfer. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { networkTransfer } from './network.ts'

/** Publisher identity and destination for one immutable artifact. */
export interface ArtifactDownload {
  url: string
  destination: string
  digest: { algorithm: 'sha1' | 'sha256' | 'sha512'; value: string }
  maxBytes: number
  signal?: AbortSignal
  progress?: (received: number, total?: number) => void
}
interface Transfer {
  controller: AbortController
  consumers: Set<(received: number, total?: number) => void>
  done: Promise<string>
  identity: string
}
const active = new Map<string, Transfer>()

/**
 * Hash a file without retaining it in memory.
 * @param path - File path to hash.
 * @param algorithm - Publisher digest algorithm.
 * @returns Lowercase hexadecimal file digest.
 */
export async function fileDigest(path: string, algorithm: string = 'sha256'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Download, verify and atomically publish a file. Cancellation detaches one consumer;
 * the final consumer cancels the transfer and retains resumable bytes.
 * @param request - Immutable artifact identity, destination and caller cancellation.
 * @returns Verified committed artifact path.
 */
export async function downloadArtifact(request: ArtifactDownload): Promise<string> {
  request.signal?.throwIfAborted()
  const { algorithm, value } = request.digest
  const length = { sha1: 40, sha256: 64, sha512: 128 }[algorithm]
  if (
    !new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(value) ||
    !Number.isSafeInteger(request.maxBytes) ||
    request.maxBytes < 1
  )
    throw new Error('下载文件缺少有效的发布方校验信息。')
  const destination = resolve(request.destination)
  const identity = `${algorithm}:${value.toLowerCase()}`
  const key = destination
  let transfer = active.get(key)
  if (transfer?.controller.signal.aborted) {
    await transfer.done.catch(() => {})
    transfer = undefined
  }
  if (transfer && transfer.identity !== identity) throw new Error('缓存文件身份冲突。')
  if (!transfer) {
    const controller = new AbortController()
    const consumers = new Set<(received: number, total?: number) => void>()
    transfer = { controller, consumers, done: Promise.resolve(''), identity }
    const owned = transfer
    transfer.done = transferFile(
      { ...request, destination, signal: controller.signal },
      identity,
      (received, total) => {
        for (const notify of consumers) notify(received, total)
      },
    ).finally(() => {
      if (active.get(key) === owned) active.delete(key)
    })
    active.set(key, transfer)
  }
  const owned = transfer
  const notify = (received: number, total?: number): void => {
    try {
      request.progress?.(received, total)
    } catch {
      /* UI progress cannot abort other consumers. */
    }
  }
  owned.consumers.add(notify)
  return new Promise<string>((accept, reject) => {
    const finish = (): void => {
      request.signal?.removeEventListener('abort', abort)
      owned.consumers.delete(notify)
      if (!owned.consumers.size) owned.controller.abort()
    }
    const abort = (): void => {
      finish()
      reject(request.signal?.reason instanceof Error ? request.signal.reason : new Error('下载已取消。'))
    }
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) {
      abort()
      return
    }
    void owned.done
      .then(async (file) => {
        // A caller cannot reuse a concurrent request with a different publisher identity.
        if ((await fileDigest(file, algorithm)) !== value.toLowerCase()) throw new Error('缓存文件身份冲突。')
        if ((await stat(file)).size > request.maxBytes) throw new Error('下载超过大小限制。')
        return file
      })
      .then(
        (file) => {
          finish()
          accept(file)
        },
        (error: unknown) => {
          finish()
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
  })
}

async function transferFile(
  request: ArtifactDownload,
  identity: string,
  progress: (received: number, total?: number) => void,
): Promise<string> {
  const { destination, digest, maxBytes, signal } = request
  if ((await fileDigest(destination, digest.algorithm).catch(() => '')) === digest.value.toLowerCase()) {
    if ((await stat(destination)).size <= maxBytes) return destination
  }
  await mkdir(dirname(destination), { recursive: true })
  const partial = `${destination}.part`
  const marker = `${partial}.json`
  let offset = 0
  if ((await readFile(marker, 'utf8').catch(() => '')) === identity)
    offset = await stat(partial)
      .then(info => info.size)
      .catch(() => 0)
  if (offset > maxBytes) offset = 0
  if (!offset) await writeFile(partial, Buffer.alloc(0))
  await writeFile(marker, identity)
  const reset = async (): Promise<void> => {
    offset = 0
    await writeFile(partial, Buffer.alloc(0))
  }
  await networkTransfer(
    request.url,
    { ...(signal ? { signal } : {}), headers: { 'User-Agent': 'CraftCode' } },
    maxBytes,
    async (response) => {
      if (response.status === 416) {
        await response.body?.cancel()
        await reset()
        throw new Error('服务器要求重新下载。')
      }
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
      if (
        response.status === 206 &&
        (!range ||
          Number(range[1]) !== offset ||
          !range.slice(1).every(value => Number.isSafeInteger(Number(value))) ||
          Number(range[2]) < offset ||
          Number(range[2]) >= Number(range[3]) ||
          (response.headers.has('content-length') &&
            Number(response.headers.get('content-length')) !== Number(range[2]) - offset + 1))
      ) {
        await response.body?.cancel()
        await reset()
        throw new Error('下载分段与缓存不匹配。')
      }
      if (response.status !== 206) await reset()
      const total =
        response.status === 206 && range
          ? Number(range[3])
          : Number(response.headers.get('content-length')) || undefined
      if (total !== undefined && total > maxBytes) {
        await response.body?.cancel()
        throw Object.assign(new Error('下载超过大小限制。'), { code: 'LIMIT' })
      }
      const hasher = createHash(digest.algorithm)
      if (offset) for await (const chunk of createReadStream(partial)) hasher.update(chunk as Buffer)
      const output = await open(partial, 'a')
      const reader = response.body?.getReader()
      if (!reader) {
        await output.close()
        throw new Error('下载响应为空。')
      }
      try {
        for (;;) {
          signal?.throwIfAborted()
          const chunk = await reader.read()
          if (chunk.done) break
          if (offset + chunk.value.length > maxBytes)
            throw Object.assign(new Error('下载超过大小限制。'), { code: 'LIMIT' })
          let written = 0
          while (written < chunk.value.length) {
            const result = await output.write(chunk.value.subarray(written))
            if (!result.bytesWritten) throw new Error('下载文件写入失败。')
            written += result.bytesWritten
            offset += result.bytesWritten
          }
          hasher.update(chunk.value)
          progress(offset, total)
        }
        await output.sync()
      } finally {
        await reader.cancel().catch(() => {})
        await output.close()
      }
      if (total !== undefined && offset !== total) throw new Error('下载尚未完成。')
      if (hasher.digest('hex') !== digest.value.toLowerCase()) {
        await reset()
        throw Object.assign(new Error('文件校验失败。'), { code: 'CHECKSUM' })
      }
    },
    () => ({
      'User-Agent': 'CraftCode',
      'Accept-Encoding': 'identity',
      ...(offset ? { Range: `bytes=${offset}-` } : {}),
    }),
  )
  signal?.throwIfAborted()
  await rename(partial, destination)
  await unlink(marker).catch(() => {})
  return destination
}
